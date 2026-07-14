// This is a temporary manual stub to satisfy the Go compiler and IDE Language Server
// until you compile the actual Protocol Buffer file using the 'protoc' CLI.
// Once you run 'protoc', this file can be deleted.

package pb

import (
	"context"
	"google.golang.org/grpc"
)

type LogContextRequest struct {
	EvidenceIds []string
}

func (x *LogContextRequest) GetEvidenceIds() []string {
	if x != nil {
		return x.EvidenceIds
	}
	return nil
}

type LogContextResponse struct {
	Status         string
	EventsFound    int32
	LogPayloadJson string
}

type BlockDirectiveRequest struct {
	IpAddress     string
	Justification string
}

func (x *BlockDirectiveRequest) GetIpAddress() string {
	if x != nil {
		return x.IpAddress
	}
	return ""
}

func (x *BlockDirectiveRequest) GetJustification() string {
	if x != nil {
		return x.Justification
	}
	return ""
}

type BlockDirectiveResponse struct {
	Success bool
	LogId   string
}

// IngestionCoreServiceServer is the server API for IngestionCoreService service.
type IngestionCoreServiceServer interface {
	FetchAlertContext(context.Context, *LogContextRequest) (*LogContextResponse, error)
	PushBlockDirective(context.Context, *BlockDirectiveRequest) (*BlockDirectiveResponse, error)
}

// UnimplementedIngestionCoreServiceServer must be embedded to have forward compatible implementations.
type UnimplementedIngestionCoreServiceServer struct{}

func (UnimplementedIngestionCoreServiceServer) FetchAlertContext(context.Context, *LogContextRequest) (*LogContextResponse, error) {
	return nil, nil
}
func (UnimplementedIngestionCoreServiceServer) PushBlockDirective(context.Context, *BlockDirectiveRequest) (*BlockDirectiveResponse, error) {
	return nil, nil
}

// RegisterIngestionCoreServiceServer registers the service with the gRPC server.
func RegisterIngestionCoreServiceServer(s grpc.ServiceRegistrar, srv IngestionCoreServiceServer) {
	// Stub implementation
}
