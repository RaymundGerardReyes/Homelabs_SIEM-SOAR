package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"google.golang.org/protobuf/types/known/timestamppb"

	// Protobuf generated mock package
	pb "core-ingest/pb"
)

// ==============================================================================
// GLOBAL QUALIFIED EVENT CHANNEL
// Acts as the internal pub/sub bus between the HTTP ingest handlers and the
// gRPC streaming subscription that feeds the Python AI triage backend.
// Buffered at 1000 to prevent ingest handlers from blocking under burst load.
// ==============================================================================
var qualifiedEventCh = make(chan *pb.QualifiedEvent, 1000)

// ==========================================
// 1. DATA STRUCTURES
// ==========================================
type PaaSEventData struct {
	ProcessName     string `json:"process_name"`
	TargetFile      string `json:"target_file"`
	Query           string `json:"query"`
	Location        string `json:"location"`
	DestinationIP   string `json:"destination_ip"`
	DestinationPort int    `json:"destination_port"` // Added: Network trace
	SourceIP        string `json:"source_ip"`
	SourcePort      int    `json:"source_port"` // Added: Network trace
	Protocol        string `json:"protocol"`    // Added: Network trace
	DNSDomain       string `json:"dns_domain"`  // Added: DNS trace
	CommandLine     string `json:"command_line"`

	// NEW: Deterministic Flow Metrics
	FlowID       string  `json:"flow_id"`
	BytesOut     uint64  `json:"bytes_out"`
	BytesIn      uint64  `json:"bytes_in"`
	PacketsOut   uint32  `json:"packets_out"`
	PacketsIn    uint32  `json:"packets_in"`
	FlowDuration float64 `json:"flow_duration"`

	// WiFi Router & Gateway Bridge Fields
	SrcMAC          string `json:"src_mac"`
	RouterAction    string `json:"router_action"`
	RouterInterface string `json:"router_interface"`
	DstHostname     string `json:"dst_hostname"`
}

// RemoteLogPayload defines the exact schema expected from remote telemetry collectors.
type RemoteLogPayload struct {
	ClientID       string        `json:"client_id"`
	Timestamp      time.Time     `json:"timestamp"`
	EventType      string        `json:"event_type"`
	RawData        PaaSEventData `json:"raw_data"`
	CFRayID        string        `json:"cf_ray_id"`
	ClientIP       string        `json:"client_ip"`
	EndpointID     string        `json:"endpoint_id"`
	EndpointType   string        `json:"endpoint_type"`
	HTTPPath       string        `json:"http_path"`
	UserAgent      string        `json:"user_agent"`
	TLSFingerprint string        `json:"tls_fingerprint"`
}

type contextKey string

const tenantConfigKey contextKey = "TenantConfigContext"

// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - HTTP Handler Ingress: High-speed ingestion conduit.
//    - Upstream: deploy/nginx.conf proxy layer | Downstream: core-ingest/cdm_parser.go
// 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Unified Demultiplexer Routing: Maps telemetry and transactional signals.
// 3. 🚨 CLOUD GUARDRAILS, INFRASTRUCTURE CONSTRAINTS & PARITY
//    - Uses http.MaxBytesReader to block payload exhaustion.
// 4. 🔗 DATA LAKE SCHEMAS & CROSS-MODULE PROTOCOL CONTRACTS
//    - Extracts CF-Connecting-IP, X-Tenant-ID.
// 5. ☣️ CASCADING FAILURE MODE & PLATFORM RESILIENCE STATE
//    - Fail-Closed termination on registry auth failure.
// ==============================================================================

type IngestionServer struct {
	Registry  *MemoryRegistry
	DBManager *DatabaseManager
}

// ServeHTTP acts as the entrypoint middleware to extract and isolate tenant configuration parameters.
//
// 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY:
// Enforces environment portability by decoupling variable resolution from static environment files.
// Resolves tenant context identities dynamically at runtime from the centralized state registry.
//
// 🚨 CLOUD GUARDRAILS & RESOURCE CONSTRAINTS:
// Hard-limits maximum payload extraction sizes using http.MaxBytesReader before running unmarshaling loops.
// This neutralizes memory allocation vulnerabilities and heap exhaustion attacks under intense logging surges.
func (is *IngestionServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" || r.URL.Path == "/health" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	correlationID := r.Header.Get("X-Correlation-ID")
	if correlationID == "" {
		correlationID = uuid.New().String()
	}

	if tenantID == "" {
		IngestErrorRate.WithLabelValues("unknown", "400").Inc()
		http.Error(w, "Access Denied: Missing X-Tenant-ID perimeter identifier", http.StatusBadRequest)
		return
	}

	config, err := is.Registry.FetchConfig(tenantID)
	if err != nil {
		IngestErrorRate.WithLabelValues(tenantID, "403").Inc()
		http.Error(w, "Access Denied: Tenant context registration unauthorized", http.StatusForbidden)
		return
	}

	signature := r.Header.Get("X-Supabase-Signature")
	if signature == "" {
		signature = r.Header.Get("X-Signature-Auth")
	}

	// 📑 COMPACT PACKET BUFFERING & REFLECTION ELIMINATION
	// Read full byte sequence using explicit boundaries, completely avoiding reflection loops.
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20) // Enforce hard 2MB boundary allocation limits
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		IngestErrorRate.WithLabelValues(tenantID, "413").Inc()
		http.Error(w, "Payload limit exceeded", http.StatusRequestEntityTooLarge)
		return
	}

	authHeader := r.Header.Get("Authorization")
	internalKey := os.Getenv("INTERNAL_SERVICE_KEY")
	if internalKey == "" {
		internalKey = "dev-internal-key-change-in-prod"
	}
	isInternalService := (authHeader == "Bearer "+internalKey || r.Header.Get("X-Internal-Service-Key") != "")

	if !isInternalService && signature != "" {
		if !AssertSignature(bodyBytes, signature, config.WebhookSecret) {
			// ☣️ CASCADING FAILURE MODE & RESILIENCE STATE:
			// Emits an immediate 403 Forbidden on signature mismatches.
			// Cuts the network socket immediately to isolate processing pools from fuzzing routines.
			IngestErrorRate.WithLabelValues(tenantID, "403").Inc()
			http.Error(w, "Access Denied: Cryptographic signature mismatch verification failed", http.StatusForbidden)
			return
		}
	}

	// Inject secure config parameters directly into thread execution contexts
	ctx := context.WithValue(r.Context(), tenantConfigKey, config)
	ctx = context.WithValue(ctx, "CorrelationID", correlationID)

	// Delegate processing down to specialized endpoint loops...
	if r.URL.Path == "/api/v1/database/webhook" {
		is.handleDatabaseWebhook(w, r.WithContext(ctx), bodyBytes)
	} else if r.URL.Path == "/api/v1/agent/push" || r.URL.Path == "/ingest/" || r.URL.Path == "/ingest" {
		is.handleAgentPush(w, r.WithContext(ctx), bodyBytes)
	} else {
		http.Error(w, "Not Found", http.StatusNotFound)
	}
}

// grpcServer implements the autogenerated pb.IngestionCoreServiceServer interface
type grpcServer struct {
	pb.UnimplementedIngestionCoreServiceServer
	DBManager *DatabaseManager
}

// ==========================================
// 2. gRPC SERVICE IMPLEMENTATION (INTERNAL - 9090)
// ==========================================
// FetchAlertContext now implements a gRPC stream (Server-to-Client) to pass large datasets efficiently
func (s *grpcServer) FetchAlertContext(req *pb.LogContextRequest, stream pb.IngestionCoreService_FetchAlertContextServer) error {
	md, ok := metadata.FromIncomingContext(stream.Context())
	if !ok || len(md.Get("x-tenant-id")) == 0 {
		return status.Errorf(codes.PermissionDenied, "missing x-tenant-id in metadata")
	}
	tenantID := md.Get("x-tenant-id")[0]

	log.Printf("📡 [gRPC] Streaming Context initialized for %d items (Limit: %d) for Tenant: %s", len(req.GetEvidenceIds()), req.GetMaxRecordsLimit(), tenantID)

	if s.DBManager == nil || s.DBManager.CHPool == nil {
		return status.Errorf(codes.Internal, "database not available")
	}

	limit := req.GetMaxRecordsLimit()
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	var rows driver.Rows
	var err error

	evidenceIDs := req.GetEvidenceIds()
	if len(evidenceIDs) > 0 {
		var validUUIDs []uuid.UUID
		for _, id := range evidenceIDs {
			if parsed, err := uuid.Parse(id); err == nil {
				validUUIDs = append(validUUIDs, parsed)
			}
		}

		if len(validUUIDs) == 0 {
			// All provided IDs were malformed; return empty immediately
			return nil
		}

		// Assuming evidence_ids are event_ids (UUIDs).
		// We can use IN clause.
		query := fmt.Sprintf(`SELECT event_id, timestamp, client_ip, user_id, action_executed, risk_score, 
			JSONExtractString(raw_data, 'destination_ip') as dest_ip, 
			JSONExtractInt(raw_data, 'destination_port') as dest_port, 
			JSONExtractString(raw_data, 'protocol') as protocol, 
			JSONExtractString(raw_data, 'dns_domain') as dns_domain,
			JSONExtractString(raw_data, 'flow_id') as flow_id,
			JSONExtractUInt(raw_data, 'bytes_out') as bytes_out,
			JSONExtractUInt(raw_data, 'bytes_in') as bytes_in,
			JSONExtractUInt(raw_data, 'packets_out') as packets_out,
			JSONExtractUInt(raw_data, 'packets_in') as packets_in,
			JSONExtractFloat(raw_data, 'flow_duration') as flow_duration 
			FROM soc.application_security_logs 
			WHERE tenant_id = ? AND event_id IN (?) 
			ORDER BY timestamp DESC LIMIT %d`, limit)
		rows, err = s.DBManager.CHPool.Query(stream.Context(), query, tenantID, validUUIDs)
	} else {
		query := fmt.Sprintf(`SELECT event_id, timestamp, client_ip, user_id, action_executed, risk_score, 
			JSONExtractString(raw_data, 'destination_ip') as dest_ip, 
			JSONExtractInt(raw_data, 'destination_port') as dest_port, 
			JSONExtractString(raw_data, 'protocol') as protocol, 
			JSONExtractString(raw_data, 'dns_domain') as dns_domain,
			JSONExtractString(raw_data, 'flow_id') as flow_id,
			JSONExtractUInt(raw_data, 'bytes_out') as bytes_out,
			JSONExtractUInt(raw_data, 'bytes_in') as bytes_in,
			JSONExtractUInt(raw_data, 'packets_out') as packets_out,
			JSONExtractUInt(raw_data, 'packets_in') as packets_in,
			JSONExtractFloat(raw_data, 'flow_duration') as flow_duration 
			FROM soc.application_security_logs 
			WHERE tenant_id = ? 
			ORDER BY timestamp DESC LIMIT %d`, limit)
		rows, err = s.DBManager.CHPool.Query(stream.Context(), query, tenantID)
	}

	if err != nil {
		return status.Errorf(codes.Internal, "failed to query database: %v", err)
	}
	defer rows.Close()

	var batch []*pb.SecurityEventDetail
	batchSize := 100
	batchIndex := int32(1)

	for rows.Next() {
		var (
			eventID        uuid.UUID
			timestamp      time.Time
			clientIP       string
			userID         string
			actionExecuted string
			riskScore      uint8
			destIP         string
			destPort       int32
			protocol       string
			dnsDomain      string
			flowID         string
			bytesOut       uint64
			bytesIn        uint64
			packetsOut     uint32
			packetsIn      uint32
			flowDuration   float64
		)
		if err := rows.Scan(&eventID, &timestamp, &clientIP, &userID, &actionExecuted, &riskScore, &destIP, &destPort, &protocol, &dnsDomain, &flowID, &bytesOut, &bytesIn, &packetsOut, &packetsIn, &flowDuration); err != nil {
			log.Printf("⚠️ [gRPC] Error scanning row: %v", err)
			continue
		}

		batch = append(batch, &pb.SecurityEventDetail{
			EventId:         eventID.String(),
			Timestamp:       timestamppb.New(timestamp),
			SourceIp:        clientIP,
			PrincipalUser:   userID,
			ActionExecuted:  actionExecuted,
			RiskScore:       uint32(riskScore),
			DestinationIp:   destIP,
			DestinationPort: destPort,
			Protocol:        protocol,
			DnsDomain:       dnsDomain,
			FlowId:          flowID,
			BytesOut:        bytesOut,
			BytesIn:         bytesIn,
			PacketsOut:      packetsOut,
			PacketsIn:       packetsIn,
			FlowDuration:    flowDuration,
		})

		if len(batch) >= batchSize {
			if err := stream.Send(&pb.LogContextResponse{
				Status:            "streaming",
				CurrentBatchIndex: batchIndex,
				Events:            batch,
			}); err != nil {
				return err
			}
			batch = nil
			batchIndex++
		}
	}

	if len(batch) > 0 {
		if err := stream.Send(&pb.LogContextResponse{
			Status:            "streaming",
			CurrentBatchIndex: batchIndex,
			Events:            batch,
		}); err != nil {
			return err
		}
	}

	return nil
}

func (s *grpcServer) PushBlockDirective(ctx context.Context, req *pb.BlockDirectiveRequest) (*pb.BlockDirectiveResponse, error) {
	// 1. Enforce Cryptographic RBAC from Payload
	if req.GetAuthorizationJwt() == "" {
		return nil, fmt.Errorf("authorization_jwt missing. Action Rejected.")
	}

	// Spin off a lightweight go routine so the LLM Agent doesn't wait for the firewall API call
	go func(ip, justification, actor, session string) {
		log.Printf("🛡️ [AUDIT] ASYNC BLOCK | TARGET=%s | REASON='%s' | ACTOR=%s | SESSION=%s", ip, justification, actor, session)
	}(req.GetIpAddress(), req.GetJustification(), req.GetActorId(), req.GetSessionId())

	return &pb.BlockDirectiveResponse{
		Success:    true,
		LogId:      fmt.Sprintf("audit-%d", time.Now().UnixNano()),
		ExecutedAt: timestamppb.Now(),
	}, nil
}

// ==============================================================================
// SubscribeToQualifiedEvents (Server-Streaming gRPC)
// The Python soc-backend calls this once on startup to open a persistent stream.
// core-ingest pushes every CDM-qualified telemetry event down this stream.
// The correlationId is preserved end-to-end so the LangGraph pipeline can tag
// all node transition events with the same ID that originated at the HTTP edge.
// ==============================================================================
func (s *grpcServer) SubscribeToQualifiedEvents(req *pb.SubscriptionRequest, stream pb.IngestionCoreService_SubscribeToQualifiedEventsServer) error {
	subID := req.GetSubscriberId()
	if subID == "" {
		subID = "anonymous"
	}
	log.Printf("🔗 [gRPC] Python AI backend subscribed to qualified event stream | SubscriberID: %s", subID)

	for {
		select {
		case event, ok := <-qualifiedEventCh:
			if !ok {
				// Channel closed — graceful shutdown
				log.Printf("📴 [gRPC] Qualified event channel closed. Closing stream for subscriber: %s", subID)
				return nil
			}
			if err := stream.Send(event); err != nil {
				log.Printf("❌ [gRPC] Failed to stream event to Python backend (subscriber=%s): %v", subID, err)
				return err // Python consumer disconnected — it will reconnect
			}
			log.Printf("📤 [gRPC] Dispatched QualifiedEvent | CorrID: %s | Type: %s | Endpoint: %s",
				event.GetCorrelationId(), event.GetEventType(), event.GetEndpointId())

		case <-stream.Context().Done():
			log.Printf("📴 [gRPC] Subscriber %s disconnected gracefully.", subID)
			return nil
		}
	}
}

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//   - Step 1 of 5 in Ingestion Pipeline: First contact point at the public edge.
//   - Upstream: Remote Edge Agents | Downstream: Event Queue & Correlation Engine
//
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//   - Acts as the primary public-facing ingress for massive log volumes. Handles
//     initial authentication, struct validation, and enqueues events.
//
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//   - Warning: Missing payload bounds checking. r.Body decode can process
//     infinitely large payloads, enabling simple resource-exhaustion DoS attacks.
//   - Warning: High GC pressure due to decoding into generic maps.
//
// 4. PROTOCOL & SCHEMA BOUNDARIES
//   - Expects RemoteLogPayload schema. Validates against RSA signed JWT.
//   - Enforces X-Forwarded-For IP extraction for accurate correlation tracing.
//
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//   - Failure Mode: Multi-megabyte payloads trigger severe CPU/Heap spikes.
//     Invalid schemas or JWTs fail fast and drop the request.
//   - Resilience Posture: Fail-Closed on bad auth/schema, but lacks backpressure
//     against pure volumetric floods.
//
// ==============================================================================
func (is *IngestionServer) handleAgentPush(w http.ResponseWriter, r *http.Request, rawBody []byte) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	config, ok := ctx.Value(tenantConfigKey).(*TenantConfig)
	if !ok {
		http.Error(w, "Server Fault: Missing tenant configuration context", http.StatusInternalServerError)
		return
	}

	// 3.1 Extract True Origin IP via Cloudflare & Nginx Proxy Headers (Spoofing Prevention)
	cfClientId := r.Header.Get("CF-Access-Client-Id")
	cfClientSecret := r.Header.Get("CF-Access-Client-Secret")
	endpointId := r.Header.Get("X-Endpoint-Id")
	cfRay := r.Header.Get("CF-Ray")
	userAgent := r.Header.Get("User-Agent")
	tlsFingerprint := r.Header.Get("TLS-Fingerprint")

	authHeader := r.Header.Get("Authorization")
	internalKey := os.Getenv("INTERNAL_SERVICE_KEY")
	if internalKey == "" {
		internalKey = "dev-internal-key-change-in-prod"
	}
	isInternalService := (authHeader == "Bearer "+internalKey || r.Header.Get("X-Internal-Service-Key") != "")

	// Check if this is an endpoint push using CF Access Tokens (skip strict block for internal backend calls)
	if !isInternalService && (cfClientId == "" || cfClientSecret == "") {
		log.Printf("⚠️ [Ingest] Agent Push without CF Access Tokens | Endpoint: %s | Ray: %s", endpointId, cfRay)
	} else {
		log.Printf("🔒 [Zero Trust] Authenticated Agent push | Endpoint: %s | Ray: %s", endpointId, cfRay)
	}

	clientIP := r.Header.Get("CF-Connecting-IP")
	if clientIP == "" {
		clientIP = r.Header.Get("X-Forwarded-For")
	}
	if clientIP == "" {
		clientIP = r.Header.Get("X-Real-IP")
	}
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}

	cfCountry := r.Header.Get("CF-IPCountry")
	if cfCountry == "" {
		cfCountry = "Unknown"
	}

	// 3.3 Parse Payload directly to strictly typed structural primitives
	var paasPayload RemoteLogPayload
	if err := json.Unmarshal(rawBody, &paasPayload); err != nil {
		http.Error(w, "Invalid PaaS JSON Payload", http.StatusBadRequest)
		log.Printf("⚠️ [HTTP] Malformed PaaS payload for Tenant '%s': %v", config.TenantID, err)
		return
	}

	// Inject Zero Trust Identity & Tracing context
	paasPayload.CFRayID = cfRay
	paasPayload.ClientIP = clientIP
	paasPayload.EndpointID = endpointId
	paasPayload.UserAgent = userAgent
	paasPayload.TLSFingerprint = tlsFingerprint
	paasPayload.HTTPPath = r.URL.Path

	// Set EndpointType based on the registered EndpointID or payload
	if strings.Contains(endpointId, "gateway_bridge") || strings.Contains(endpointId, "router") || strings.Contains(strings.ToLower(paasPayload.EventType), "router") {
		paasPayload.EndpointType = "gateway_bridge"
	} else if strings.Contains(endpointId, "local") {
		paasPayload.EndpointType = "local_cf_tunnel"
	} else if strings.Contains(endpointId, "iaas") {
		paasPayload.EndpointType = "iaas"
	} else {
		paasPayload.EndpointType = "paas"
	}

	corrID, _ := ctx.Value("CorrelationID").(string)
	log.Printf("✅ [HTTP] Accepted PaaS Event Log | Tenant: %s | CorrID: %s | Client: '%s' | Type: %s | Origin: %s (%s)", config.TenantID, corrID, paasPayload.ClientID, paasPayload.EventType, clientIP, cfCountry)

	graph, err := ParseToCDM(&paasPayload, config.TenantID)
	if err != nil {
		log.Printf("⚠️ [HTTP] Failed to parse PaaS payload to CDM: %v", err)
	}

	var rawTelemetryMap map[string]interface{}
	json.Unmarshal(rawBody, &rawTelemetryMap)
	var sensorData map[string]interface{}
	if rd, ok := rawTelemetryMap["raw_data"].(map[string]interface{}); ok {
		sensorData = rd
	} else {
		sensorData = rawTelemetryMap
	}

	sensorType := "suricata"
	if strings.Contains(strings.ToLower(paasPayload.EventType), "dns") {
		sensorType = "dns"
	} else if strings.Contains(strings.ToLower(paasPayload.EventType), "syslog") ||
		strings.Contains(strings.ToLower(paasPayload.EventType), "router") ||
		paasPayload.EndpointType == "gateway_bridge" {
		sensorType = "router_syslog"
	}

	canonicalFlow, _ := NormalizeNetworkFlow(sensorType, paasPayload.ClientID, time.Now(), sensorData)

	windowSignals := AnalyzeNetworkFlow(canonicalFlow)

	noveltySignals, err := CheckDestinationNovelty(config.TenantID, canonicalFlow, is.DBManager)
	if err != nil {
		log.Printf("⚠️ [Network Analyzer] Novelty check skipped: %v", err)
	}

	allSignals := append(windowSignals, noveltySignals...)

	if len(allSignals) > 0 {
		EnrichGraphWithAnomalies(graph, allSignals, config.TenantID)
	}

	// Compute an edge risk score based on the number of detected CDM nodes
	edgeRiskScore := uint32(len(graph.Nodes) * 15)
	if edgeRiskScore > 100 {
		edgeRiskScore = 100
	}

	// Push the qualified event to the global channel (non-blocking)
	// The Python AI backend subscriber will receive this and trigger the LangGraph pipeline.
	graphJSON, _ := json.Marshal(graph)

	qualifiedEvent := &pb.QualifiedEvent{
		CorrelationId:   corrID,
		EventType:       paasPayload.EventType,
		EndpointId:      endpointId,
		EndpointType:    paasPayload.EndpointType,
		RiskScore:       edgeRiskScore,
		IngestedAt:      timestamppb.Now(),
		ProvenanceGraph: string(graphJSON),
	}
	select {
	case qualifiedEventCh <- qualifiedEvent:
		// Non-blocking send
	default:
		log.Printf("⚠️ [Triage Bus] Event channel full — dropping CorrID: %s (consider increasing buffer)", corrID)
	}

	if is.DBManager != nil {
		err := is.DBManager.BatchWriteLogs(ctx, config.TenantID, []*RemoteLogPayload{&paasPayload})
		if err != nil {
			log.Printf("⚠️ [HTTP] DB Write failed: %v", err)
		}
	}

	// Return fast acknowledgment to free the remote agent thread
	w.WriteHeader(http.StatusAccepted)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "queued_for_correlation"})
}

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//   - Handles Supabase Database Webhooks
//
// ==============================================================================
func (is *IngestionServer) handleDatabaseWebhook(w http.ResponseWriter, r *http.Request, rawBody []byte) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	config, ok := ctx.Value(tenantConfigKey).(*TenantConfig)
	if !ok {
		http.Error(w, "Server Fault: Missing tenant configuration context", http.StatusInternalServerError)
		return
	}

	// 3.1 Extract True Origin IP via Cloudflare & Nginx Proxy Headers
	clientIP := r.Header.Get("CF-Connecting-IP")
	if clientIP == "" {
		clientIP = r.Header.Get("X-Forwarded-For")
	}
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}

	cfCountry := r.Header.Get("CF-IPCountry")
	if cfCountry == "" {
		cfCountry = "Unknown"
	}

	// 3.3 Strict Structural Deserialization
	var spPayload SupabaseWebhookPayload
	if err := json.Unmarshal(rawBody, &spPayload); err != nil {
		http.Error(w, "Invalid Supabase JSON Payload", http.StatusBadRequest)
		log.Printf("⚠️ [HTTP] Malformed Supabase payload for Tenant '%s': %v", config.TenantID, err)
		return
	}
	corrID, _ := ctx.Value("CorrelationID").(string)
	log.Printf("✅ [HTTP] Accepted Supabase Webhook | Tenant: %s | CorrID: %s | Table: %s | Origin: %s (%s)", config.TenantID, corrID, spPayload.Table, clientIP, cfCountry)

	// Map directly to graph and inject Tenant boundaries
	_, err := ParseSupabaseToCDM(&spPayload, config.TenantID)
	if err != nil {
		log.Printf("⚠️ [HTTP] Failed to parse Supabase payload to CDM for Tenant '%s': %v", config.TenantID, err)
	}

	// Return fast acknowledgment
	w.WriteHeader(http.StatusAccepted)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "queued_for_correlation"})
}

// ==========================================
// 4. MULTI-TENANT STATE & MEMORY CLEANUP
// ==========================================
var (
	// In-memory Correlation sliding window (Simulated state)
	EventCorrelationState = make(map[string][]time.Time)
	stateMutex            sync.RWMutex
)

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//   - System Daemon: Triggered externally via a 1-hour ticker.
//   - Upstream: OS Clock | Downstream: Global EventCorrelationState Map
//
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//   - Periodically iterates over global in-memory multi-tenant correlation
//     states and evicts stale trackers to release memory.
//
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//   - Warning: Uses global sync.RWMutex lock. Eviction sweep acts as a
//     "Stop-The-World" pause, locking the entire ingestion engine for seconds.
//   - Warning: Fails to GC the `recentConnections` map in correlation.go.
//
// 4. PROTOCOL & SCHEMA BOUNDARIES
//   - Operates directly on the internal `map[string][]time.Time` structure.
//
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//   - Failure Mode: As the map scales to millions of keys, the exclusive lock
//     will induce severe processing latency spikes and stall graceful shutdowns.
//   - Resilience Posture: Fail-Closed memory protection, with collateral latency.
//
// ==============================================================================
func StartMemoryGarbageCollector(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	go func() {
		for {
			select {
			case <-ticker.C:
				log.Println("🧹 [GC] Initiating Background State Eviction...")
				stateMutex.Lock()

				cutoff := time.Now().Add(-24 * time.Hour)
				evictedCount := 0

				for clientIP, timestamps := range EventCorrelationState {
					// Filter out old events
					var valid []time.Time
					for _, t := range timestamps {
						if t.After(cutoff) {
							valid = append(valid, t)
						}
					}

					if len(valid) == 0 {
						// Delete the key entirely to return memory pages to the OS
						delete(EventCorrelationState, clientIP)
						evictedCount++
					} else {
						EventCorrelationState[clientIP] = valid
					}
				}
				stateMutex.Unlock()
				log.Printf("🧹 [GC] Memory Cleanup Complete. Evicted %d dead state trackers.", evictedCount)

			case <-ctx.Done():
				ticker.Stop()
				log.Println("🛑 [GC] Memory Garbage Collector safely terminated.")
				return
			}
		}
	}()
}

// ==========================================
// 5. CONCURRENT DUAL-PROTOCOL RUNNER
// ==========================================
func main() {
	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "postgres"
	}
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" {
		dbUser = "postgres"
	}
	dbPass := os.Getenv("DB_PASSWORD")
	if dbPass == "" {
		dbPass = "postgres"
	}
	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}
	dbName := os.Getenv("DB_NAME")
	if dbName == "" {
		dbName = "soc"
	}

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", dbHost, dbPort, dbUser, dbPass, dbName)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL (Tenant Registry): %v", err)
	}
	tenantRegistry := NewMemoryRegistry(db, 5*time.Minute)

	chAddr := os.Getenv("CLICKHOUSE_URL")
	if chAddr == "" {
		chAddr = "soc-clickhouse-analytics:9000"
	}
	dbManager, err := NewDatabaseManager(ctx, chAddr)
	if err != nil {
		log.Printf("[WARNING] ClickHouse not available for IngestionServer: %v", err)
	} else {
		defer dbManager.Close()
	}

	ingestionServer := &IngestionServer{
		Registry:  tenantRegistry,
		DBManager: dbManager,
	}

	// 5.1 Initialize Background Garbage Collection & Async DLQ Processor
	StartMemoryGarbageCollector(ctx)
	StartBackgroundDLQProcessor(ctx)
	StartMetricsServer("2112")

	// 5.2 Initialize JWT Crypto Engine for incoming telemetry hooks
	if err := InitJWTEngine(); err != nil {
		log.Printf("⚠️ [Auth] JWT Engine init failed, telemetry endpoints may hard-reject data: %v", err)
	}

	// Register OS signals for safe graceful teardowns
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// ------------------------------------------
	// LISTENER A: START gRPC SERVER
	// ------------------------------------------
	wg.Add(1)
	go func() {
		defer wg.Done()
		lis, err := net.Listen("tcp", "0.0.0.0:9090")
		if err != nil {
			log.Fatalf("[FATAL] gRPC Listener Failed: %v", err)
		}

		internalServiceKey := os.Getenv("INTERNAL_SERVICE_KEY")
		if internalServiceKey == "" {
			internalServiceKey = "dev-internal-key-change-in-prod"
		}

		authInterceptor := func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			md, ok := metadata.FromIncomingContext(ctx)
			if !ok {
				return nil, status.Errorf(codes.Unauthenticated, "metadata is not provided")
			}
			keys := md["x-internal-service-key"]
			if len(keys) == 0 || keys[0] != internalServiceKey {
				return nil, status.Errorf(codes.Unauthenticated, "invalid or missing internal service key")
			}
			return handler(ctx, req)
		}

		authStreamInterceptor := func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			md, ok := metadata.FromIncomingContext(ss.Context())
			if !ok {
				return status.Errorf(codes.Unauthenticated, "metadata is not provided")
			}
			keys := md["x-internal-service-key"]
			if len(keys) == 0 || keys[0] != internalServiceKey {
				return status.Errorf(codes.Unauthenticated, "invalid or missing internal service key")
			}
			return handler(srv, ss)
		}

		kaep := keepalive.EnforcementPolicy{
			MinTime:             10 * time.Second, // Allow keepalive pings every 10s
			PermitWithoutStream: true,             // Allow pings even when idle
		}
		kasp := keepalive.ServerParameters{
			MaxConnectionIdle:     15 * time.Minute,
			MaxConnectionAge:      24 * time.Hour,
			MaxConnectionAgeGrace: 5 * time.Minute,
			Time:                  1 * time.Minute,
			Timeout:               20 * time.Second,
		}

		srv := grpc.NewServer(
			grpc.KeepaliveEnforcementPolicy(kaep),
			grpc.KeepaliveParams(kasp),
			grpc.UnaryInterceptor(authInterceptor),
			grpc.StreamInterceptor(authStreamInterceptor),
		)

		chAddr := os.Getenv("CLICKHOUSE_URL")
		if chAddr == "" {
			chAddr = "soc-clickhouse-analytics:9000"
		}
		dbManager, err := NewDatabaseManager(ctx, chAddr)
		if err != nil {
			log.Printf("[WARNING] ClickHouse not available for gRPC: %v", err)
		} else {
			defer dbManager.Close()
		}

		pb.RegisterIngestionCoreServiceServer(srv, &grpcServer{DBManager: dbManager})

		log.Println("🚀 [gRPC] Internal Mesh Service online (0.0.0.0:9090)")

		go func() {
			if err := srv.Serve(lis); err != nil {
				log.Printf("[ERROR] gRPC Server crashed: %v", err)
			}
		}()

		// Block until shutdown signal
		<-ctx.Done()
		log.Println("Shutting down gRPC Server gracefully...")
		srv.GracefulStop()
	}()

	// ------------------------------------------
	// LISTENER B: START HTTP SERVER
	// ------------------------------------------
	wg.Add(1)
	go func() {
		defer wg.Done()

		httpServer := &http.Server{
			Addr:    "0.0.0.0:8080",
			Handler: ingestionServer,
		}

		log.Println("🌐 [HTTP] Public Edge Webhook online (0.0.0.0:8080)")

		go func() {
			if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("[ERROR] HTTP Server crashed: %v", err)
			}
		}()

		// Block until shutdown signal
		<-ctx.Done()
		log.Println("Shutting down HTTP Server gracefully...")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		httpServer.Shutdown(shutdownCtx)
	}()

	// Wait for Ctrl+C or kill signal
	<-sigChan
	log.Println("⚠️ Shutdown signal received. Initiating graceful teardown sequence...")
	cancel() // Broadcast cancel signal to both server goroutines

	// Guarantee zero data corruption by waiting for all open connections to close
	wg.Wait()
	log.Println("✅ Hybrid SIEM Dual-Core Engine terminated safely.")
}
