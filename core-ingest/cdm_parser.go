package main

import (
	"fmt"
	"strings"
	"time"
)

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//    - Mid-Pipeline Transformation: Executed after initial ingestion, prior to
//      dispatching the payload to the Python ML Inference Engine.
//    - Upstream: Stream Correlation Engine | Downstream: GNN Inference Service
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Converts unstructured flat JSON security telemetry into mathematically
//      structured graph topologies (Nodes and Edges).
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - 100% Stateless. Safe for high-concurrency Fan-Out worker pools.
//    - Warning: Relies on map[string]interface{} unmarshaling which induces
//      heavy heap allocations and GC pressure.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Consumes arbitrary JSON. Outputs internal ProvenanceGraph structure.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: Missing fields silently skip edge creation, leading to
//      disconnected "Ghost Graphs" that may pollute downstream ML training.
//    - Resilience Posture: Fail-Open. Returns partial graphs without panicking.
// ==============================================================================
// ParseToCDM transforms unstructured flat JSON security telemetry into mathematically
// structured graph topologies (Nodes and Edges), fully scoped to a Tenant ID.
func ParseToCDM(payload *RemoteLogPayload, tenantID string) (*ProvenanceGraph, error) {
	graph := &ProvenanceGraph{
		Nodes: make([]GraphNode, 0),
		Edges: make([]GraphEdge, 0),
	}

	// 1. Identify the Primary Host/Subject Node
	hostIP := "unknown_host"
	if payload.RawData.SourceIP != "" {
		hostIP = payload.RawData.SourceIP
	} else if payload.ClientID != "" {
		hostIP = payload.ClientID
	}

	hostNode := GraphNode{
		ID:         fmt.Sprintf("%s_%s", tenantID, hostIP),
		Type:       "Host",
		Properties: fmt.Sprintf("Tenant=%s, IP=%s", tenantID, hostIP),
	}
	graph.Nodes = append(graph.Nodes, hostNode)

	// 2. Map Process Execution (Process Trees)
	if procName := payload.RawData.ProcessName; procName != "" {
		procID := fmt.Sprintf("%s_proc_%s_%d", tenantID, procName, time.Now().UnixNano())
		procNode := GraphNode{
			ID:         procID,
			Type:       "Process",
			Properties: fmt.Sprintf("Tenant=%s, Name=%s", tenantID, procName),
		}
		graph.Nodes = append(graph.Nodes, procNode)

		// Edge: Host -> EXECUTED -> Process
		graph.Edges = append(graph.Edges, GraphEdge{
			SourceID: hostNode.ID,
			TargetID: procID,
			Relation: "EXECUTED",
		})

		// 3. Map File Modifications
		if targetFile := payload.RawData.TargetFile; targetFile != "" {
			fileID := fmt.Sprintf("%s_file_%x", tenantID, targetFile)
			fileNode := GraphNode{
				ID:         fileID,
				Type:       "File",
				Properties: fmt.Sprintf("Tenant=%s, Path=%s", tenantID, targetFile),
			}
			graph.Nodes = append(graph.Nodes, fileNode)

			// Edge: Process -> MODIFIED -> File
			graph.Edges = append(graph.Edges, GraphEdge{
				SourceID: procID,
				TargetID: fileID,
				Relation: "MODIFIED_FILE",
			})
		}
		
		// 4. Map Network Connections
		if targetIP := payload.RawData.DestinationIP; targetIP != "" {
			destNode := GraphNode{
				ID:         fmt.Sprintf("%s_%s", tenantID, targetIP),
				Type:       "Network",
				Properties: fmt.Sprintf("Tenant=%s, RemoteIP=%s", tenantID, targetIP),
			}
			graph.Nodes = append(graph.Nodes, destNode)

			// Edge: Process -> CONNECTED_TO -> Network Node
			graph.Edges = append(graph.Edges, GraphEdge{
				SourceID: procID,
				TargetID: destNode.ID,
				Relation: "CONNECTED_TO",
			})
		}
	}

	// 5. Handle raw script executions for AST analysis
	if scriptArgs := payload.RawData.CommandLine; scriptArgs != "" && strings.Contains(strings.ToLower(scriptArgs), "powershell") {
		scriptNode := GraphNode{
			ID:         fmt.Sprintf("%s_script_%d", tenantID, time.Now().UnixNano()),
			Type:       "Script",
			Properties: fmt.Sprintf("Tenant=%s, Command=%s", tenantID, scriptArgs),
		}
		graph.Nodes = append(graph.Nodes, scriptNode)
		
		graph.Edges = append(graph.Edges, GraphEdge{
			SourceID: hostNode.ID,
			TargetID: scriptNode.ID,
			Relation: "EVALUATED_SCRIPT",
		})
	}

	return graph, nil
}

// ==============================================================================
// SUPABASE TRANSACTIONAL GRAPH CONVERSION
// ==============================================================================
// DatabaseRowStruct defines explicit primitives, avoiding reflection and heap scaling crashes
type DatabaseRowStruct struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	OrganizationID string `json:"organization_id"`
	Name           string `json:"name"`
}

type SupabaseWebhookPayload struct {
	Type      string            `json:"type"`
	Table     string            `json:"table"`
	Schema    string            `json:"schema"`
	Record    DatabaseRowStruct `json:"record"`
	OldRecord DatabaseRowStruct `json:"old_record"`
}

// ParseSupabaseToCDM dynamically converts relational database mutations into
// discrete graph entities compatible with downstream Provenance Graph AI models.
func ParseSupabaseToCDM(payload *SupabaseWebhookPayload, tenantID string) (*ProvenanceGraph, error) {
	graph := &ProvenanceGraph{
		Nodes: make([]GraphNode, 0),
		Edges: make([]GraphEdge, 0),
	}

	if payload.Record.ID == "" {
		return graph, nil // Skip empty mutations
	}

	nodeID := fmt.Sprintf("%s_%s_%s", tenantID, payload.Table, payload.Record.ID)
	
	// 1. Create central vertex (Node) for the mutated database row, bound to Tenant
	rowNode := GraphNode{
		ID:         nodeID,
		Type:       fmt.Sprintf("DB_%s", strings.ToUpper(payload.Table)),
		Properties: fmt.Sprintf("Tenant=%s, Action=%s, Schema=%s", tenantID, payload.Type, payload.Schema),
	}
	graph.Nodes = append(graph.Nodes, rowNode)

	// 2. Map structural mutations directly using the un-reflected static struct fields
	if payload.Record.UserID != "" {
		targetID := fmt.Sprintf("%s_user_%s", tenantID, payload.Record.UserID)
		graph.Edges = append(graph.Edges, GraphEdge{
			SourceID: nodeID,
			TargetID: targetID,
			Relation: "REFERENCES_USER",
		})
	}

	if payload.Record.OrganizationID != "" {
		targetID := fmt.Sprintf("%s_organization_%s", tenantID, payload.Record.OrganizationID)
		graph.Edges = append(graph.Edges, GraphEdge{
			SourceID: nodeID,
			TargetID: targetID,
			Relation: "REFERENCES_ORGANIZATION",
		})
	}

	return graph, nil
}
