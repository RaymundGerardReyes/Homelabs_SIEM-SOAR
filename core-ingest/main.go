package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"google.golang.org/grpc"
	
	// Assuming protoc generated code is placed here based on go_package option
	// If you run: protoc --go_out=. --go-grpc_out=. shared-proto/soc_service.proto
	// You will need to adjust the import path to match your Go module name.
	// For this blueprint, we represent the namespace as pb.
	pb "core-ingest/pb" 
)

// server is used to implement pb.IngestionCoreServiceServer
type server struct {
	pb.UnimplementedIngestionCoreServiceServer
}

// ==========================================
// RPC: FetchAlertContext
// ==========================================
// Handles fetching contextual logs strictly requested by the Python LLM Agent layer.
func (s *server) FetchAlertContext(ctx context.Context, req *pb.LogContextRequest) (*pb.LogContextResponse, error) {
	evidenceIDs := req.GetEvidenceIds()
	log.Printf("[gRPC] Received FetchAlertContext request for %d evidence IDs", len(evidenceIDs))

	// ==========================================
	// ⚡ INSERT clickhouse-go/v2 BATCH QUERY HERE
	// ==========================================
	// Example implementation structure:
	//
	// conn, err := clickhouse.Open(&clickhouse.Options{
	// 	Addr: []string{"127.0.0.1:9000"},
	// 	Auth: clickhouse.Auth{Database: "soc", Username: "default", Password: ""},
	// })
	// if err != nil { return nil, err }
	// defer conn.Close()
	//
	// // The slice of evidenceIDs prevents SQL injection natively
	// query := "SELECT timestamp, source_ip, raw_log FROM soc_events WHERE event_id IN (?)"
	// rows, err := conn.Query(ctx, query, evidenceIDs)
	// 
	// // ... iterate rows and marshal into JSON bytes ...
	// ==========================================

	// Mocking successful response for blueprint
	mockJson := `{"data": [{"timestamp": "2026-07-14", "event": "brute_force_detected"}]}`

	return &pb.LogContextResponse{
		Status:         "success",
		EventsFound:    1,
		LogPayloadJson: mockJson,
	}, nil
}

// ==========================================
// RPC: PushBlockDirective
// ==========================================
// Handles executing high-risk containment actions proposed by the Python layer.
func (s *server) PushBlockDirective(ctx context.Context, req *pb.BlockDirectiveRequest) (*pb.BlockDirectiveResponse, error) {
	targetIP := req.GetIpAddress()
	justification := req.GetJustification()

	// Emit clean, asynchronous audit log to standard output without blocking the gRPC return thread
	go func(ip, reason string) {
		log.Printf("🛡️ [AUDIT LEDGER] ASYNC BLOCK DIRECTIVE ISSUED | TARGET: %s | REASON: %s | TIME: %v", ip, reason, time.Now().Format(time.RFC3339))
		
		// Insert actual firewall integration code here (e.g., interacting with iptables, Palo Alto, or AWS WAF APIs)
		
	}(targetIP, justification)

	return &pb.BlockDirectiveResponse{
		Success: true,
		LogId:   fmt.Sprintf("audit-grpc-%d", time.Now().UnixNano()),
	}, nil
}

func main() {
	// 1. Listen on local port 9090 specifically for the Python gRPC client
	lis, err := net.Listen("tcp", ":9090")
	if err != nil {
		log.Fatalf("[FATAL] Failed to listen on port 9090: %v", err)
	}

	// 2. Initialize pure Go gRPC server (Zero HTTP/JSON middleware memory overhead)
	grpcServer := grpc.NewServer()
	
	// 3. Register the implementation
	pb.RegisterIngestionCoreServiceServer(grpcServer, &server{})

	fmt.Println("🚀 Go gRPC Ingestion Core listening on :9090")
	
	// 4. Start serving requests
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[FATAL] Failed to serve gRPC: %v", err)
	}
}
