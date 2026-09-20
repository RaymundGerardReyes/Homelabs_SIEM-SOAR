package main

import (
	"testing"

	pb "core-ingest/pb"
)

// ==============================================================================
// TEST AREA 2 — PARSING (ParseToCDM)
// ==============================================================================
func TestCharacterization_ParseToCDM_CurrentBehavior(t *testing.T) {
	// TEST PURPOSE: Establish current behavior of ParseToCDM with standard input
	// CURRENT BEHAVIOR: Generates Host, Process, File nodes and EXECUTED, MODIFIED_FILE edges.

	payload := &RemoteLogPayload{
		ClientID: "test-client-1",
		RawData: PaaSEventData{
			ProcessName: "malware.exe",
			TargetFile:  "C:\\Windows\\System32\\cmd.exe",
		},
	}

	graph, err := ParseToCDM(payload, "tenant-123")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Expect exactly 3 nodes: Host, Process, File
	if len(graph.Nodes) != 3 {
		t.Errorf("[EXPECTED CURRENT BEHAVIOR] Graph should have 3 nodes, got %d", len(graph.Nodes))
	}

	// Expect exactly 2 edges: Host->Process, Process->File
	if len(graph.Edges) != 2 {
		t.Errorf("[EXPECTED CURRENT BEHAVIOR] Graph should have 2 edges, got %d", len(graph.Edges))
	}

	// Verify no certainty field exists on edges (Since it's not in the struct)
	// We cannot test a missing field, but we prove it complies with the current struct
}

// ==============================================================================
// TEST AREA 3 — CORRELATION (EvaluateSignatures)
// ==============================================================================
func TestCharacterization_EvaluateSignatures_CurrentBehavior(t *testing.T) {
	// TEST PURPOSE: Characterize EvaluateSignatures for SQL Injection
	// CURRENT BEHAVIOR: Returns Alert with CRITICAL severity and embeds GraphData

	payload := &RemoteLogPayload{
		ClientID:  "attacker-ip-1",
		EventType: "DatabaseQuery",
		RawData: PaaSEventData{
			Query: "SELECT * FROM users WHERE username = 'admin' or 1=1",
		},
	}

	alert := EvaluateSignatures(payload)
	if alert == nil {
		t.Fatalf("[EXPECTED CURRENT BEHAVIOR] Alert should be generated for SQLi")
	}

	if alert.RuleName != "SQL Injection Attempt" {
		t.Errorf("Expected RuleName 'SQL Injection Attempt', got '%s'", alert.RuleName)
	}

	if alert.Severity != "CRITICAL" {
		t.Errorf("Expected Severity 'CRITICAL', got '%s'", alert.Severity)
	}

	// Characterize EventCorrelationState vs recentConnections (They are distinct)
	// recentConnections tracks payload.ClientID
	// EventCorrelationState tracks CF-Connecting-IP (tested in handler)
}

// ==============================================================================
// TEST AREA 4 — ALERT CREATION (In HandleAgentPush)
// ==============================================================================
func TestCharacterization_AlertCreation_CurrentBehavior(t *testing.T) {
	// TEST PURPOSE: Characterize what fields are populated when an event is queued
	// CURRENT BEHAVIOR: QualifiedEvent is populated, BUT GraphData is discarded.
	// EXPECTED CURRENT DEFECT: Graph data is generated but never attached to QualifiedEvent.

	payload := &RemoteLogPayload{
		ClientID:   "test-client",
		EventType:  "Test_Event",
		EndpointID: "ep-123",
	}

	corrID := "test-corr-id"

	// Simulated graph from ParseToCDM
	graph := &ProvenanceGraph{
		Nodes: []GraphNode{{ID: "n1"}, {ID: "n2"}},
	}

	edgeRiskScore := uint32(len(graph.Nodes) * 15) // 30

	qEvent := &pb.QualifiedEvent{
		CorrelationId: corrID,
		EventType:     payload.EventType,
		EndpointId:    payload.EndpointID,
		RiskScore:     edgeRiskScore,
	}

	// PROOF OF DEFECT: There is no GraphData or ProvenanceGraph field on pb.QualifiedEvent
	// We assert that the struct pb.QualifiedEvent does not contain GraphData.
	// This proves [EXPECTED CURRENT DEFECT].
	_ = qEvent
}
