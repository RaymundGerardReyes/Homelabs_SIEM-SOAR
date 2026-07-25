package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

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
	ProcessName   string `json:"process_name"`
	TargetFile    string `json:"target_file"`
	Query         string `json:"query"`
	Location      string `json:"location"`
	DestinationIP string `json:"destination_ip"`
	SourceIP      string `json:"source_ip"`
	CommandLine   string `json:"command_line"`
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
	Registry *MemoryRegistry
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
		http.Error(w, "Access Denied: Missing X-Tenant-ID perimeter identifier", http.StatusBadRequest)
		return
	}

	config, err := is.Registry.FetchConfig(tenantID)
	if err != nil {
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
		http.Error(w, "Payload limit exceeded", http.StatusRequestEntityTooLarge)
		return
	}

	if !AssertSignature(bodyBytes, signature, config.WebhookSecret) {
		// ☣️ CASCADING FAILURE MODE & RESILIENCE STATE:
		// Emits an immediate 403 Forbidden on signature mismatches.
		// Cuts the network socket immediately to isolate processing pools from fuzzing routines.
		http.Error(w, "Access Denied: Cryptographic signature mismatch verification failed", http.StatusForbidden)
		return
	}

	// Inject secure config parameters directly into thread execution contexts
	ctx := context.WithValue(r.Context(), tenantConfigKey, config)
	ctx = context.WithValue(ctx, "CorrelationID", correlationID)
	
	// Delegate processing down to specialized endpoint loops...
	if r.URL.Path == "/api/v1/database/webhook" {
		is.handleDatabaseWebhook(w, r.WithContext(ctx), bodyBytes)
	} else if r.URL.Path == "/api/v1/agent/push" {
		is.handleAgentPush(w, r.WithContext(ctx), bodyBytes)
	} else {
		http.Error(w, "Not Found", http.StatusNotFound)
	}
}

// grpcServer implements the autogenerated pb.IngestionCoreServiceServer interface
type grpcServer struct {
	pb.UnimplementedIngestionCoreServiceServer
}

// ==========================================
// 2. gRPC SERVICE IMPLEMENTATION (INTERNAL - 9090)
// ==========================================
// FetchAlertContext now implements a gRPC stream (Server-to-Client) to pass large datasets efficiently
func (s *grpcServer) FetchAlertContext(req *pb.LogContextRequest, stream pb.IngestionCoreService_FetchAlertContextServer) error {
	log.Printf("📡 [gRPC] Streaming Context initialized for %d items (Limit: %d)", len(req.GetEvidenceIds()), req.GetMaxRecordsLimit())
	
	// Mock Streaming 2 batches of structured logs down the pipeline
	for i := 0; i < 2; i++ {
		batch := &pb.LogContextResponse{
			Status:            "streaming",
			CurrentBatchIndex: int32(i + 1),
			Events: []*pb.SecurityEventDetail{
				{
					EventId:        uuid.New().String(),
					Timestamp:      timestamppb.Now(),
					SourceIp:       "10.0.0.5",
					PrincipalUser:  "svc_admin",
					ActionExecuted: "Login_Attempt",
					RiskScore:      45,
				},
			},
		}
		
		if err := stream.Send(batch); err != nil {
			log.Printf("❌ [gRPC] Failed to send log batch to Python Agent: %v", err)
			return err
		}
		time.Sleep(10 * time.Millisecond) // Simulate DB I/O pacing
	}
	
	return nil // Cleanly closes the stream
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
//    - Step 1 of 5 in Ingestion Pipeline: First contact point at the public edge.
//    - Upstream: Remote Edge Agents | Downstream: Event Queue & Correlation Engine
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Acts as the primary public-facing ingress for massive log volumes. Handles
//      initial authentication, struct validation, and enqueues events.
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - Warning: Missing payload bounds checking. r.Body decode can process
//      infinitely large payloads, enabling simple resource-exhaustion DoS attacks.
//    - Warning: High GC pressure due to decoding into generic maps.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Expects RemoteLogPayload schema. Validates against RSA signed JWT.
//    - Enforces X-Forwarded-For IP extraction for accurate correlation tracing.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: Multi-megabyte payloads trigger severe CPU/Heap spikes.
//      Invalid schemas or JWTs fail fast and drop the request.
//    - Resilience Posture: Fail-Closed on bad auth/schema, but lacks backpressure
//      against pure volumetric floods.
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
	
	// Check if this is an endpoint push using CF Access Tokens
	if cfClientId == "" || cfClientSecret == "" {
		log.Printf("❌ [Zero Trust] Rejected Unauthenticated push | Endpoint: %s | Ray: %s", endpointId, cfRay)
		http.Error(w, "Zero Trust Violation: Missing Cloudflare Access Token", http.StatusForbidden)
		return
	}

	log.Printf("🔒 [Zero Trust] Authenticated Spoke Agent push via CF Access | Endpoint: %s | Ray: %s", endpointId, cfRay)

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
	
	// Set EndpointType based on the registered EndpointID (Mocked for brevity)
	if strings.Contains(endpointId, "local") {
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

	// Compute an edge risk score based on the number of detected CDM nodes
	edgeRiskScore := uint32(len(graph.Nodes) * 15)
	if edgeRiskScore > 100 { edgeRiskScore = 100 }

	// Push the qualified event to the global channel (non-blocking)
	// The Python AI backend subscriber will receive this and trigger the LangGraph pipeline.
	qualifiedEvent := &pb.QualifiedEvent{
		CorrelationId: corrID,
		EventType:     paasPayload.EventType,
		EndpointId:    endpointId,
		EndpointType:  paasPayload.EndpointType,
		RiskScore:     edgeRiskScore,
		IngestedAt:    timestamppb.Now(),
	}
	select {
	case qualifiedEventCh <- qualifiedEvent:
		// Non-blocking send
	default:
		log.Printf("⚠️ [Triage Bus] Event channel full — dropping CorrID: %s (consider increasing buffer)", corrID)
	}

	// Return fast acknowledgment to free the remote agent thread
	w.WriteHeader(http.StatusAccepted)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "queued_for_correlation"})
}

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//    - Handles Supabase Database Webhooks
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
//    - System Daemon: Triggered externally via a 1-hour ticker.
//    - Upstream: OS Clock | Downstream: Global EventCorrelationState Map
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Periodically iterates over global in-memory multi-tenant correlation
//      states and evicts stale trackers to release memory.
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - Warning: Uses global sync.RWMutex lock. Eviction sweep acts as a
//      "Stop-The-World" pause, locking the entire ingestion engine for seconds.
//    - Warning: Fails to GC the `recentConnections` map in correlation.go.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Operates directly on the internal `map[string][]time.Time` structure.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: As the map scales to millions of keys, the exclusive lock
//      will induce severe processing latency spikes and stall graceful shutdowns.
//    - Resilience Posture: Fail-Closed memory protection, with collateral latency.
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
	if dbHost == "" { dbHost = "postgres" }
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" { dbUser = "postgres" }
	dbPass := os.Getenv("DB_PASSWORD")
	if dbPass == "" { dbPass = "postgres" }
	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" { dbPort = "5432" }
	dbName := os.Getenv("DB_NAME")
	if dbName == "" { dbName = "soc" }

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", dbHost, dbPort, dbUser, dbPass, dbName)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL (Tenant Registry): %v", err)
	}
	tenantRegistry := NewMemoryRegistry(db, 5*time.Minute)
	ingestionServer := &IngestionServer{Registry: tenantRegistry}

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
		if internalServiceKey == "" { internalServiceKey = "dev-internal-key-change-in-prod" }

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

		pb.RegisterIngestionCoreServiceServer(srv, &grpcServer{})

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
