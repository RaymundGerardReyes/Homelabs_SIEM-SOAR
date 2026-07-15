package main

import (
	"log"
	"strings"
	"sync"
	"time"
)

// ==========================================
// REAL-TIME CORRELATION ENGINE (STREAMING)
// ==========================================

// ==========================================
// COMMON DATA MODEL: PROVENANCE GRAPH (GNN)
// ==========================================
type GraphNode struct {
	ID         string `json:"id"`
	Type       string `json:"type"`       // e.g., "process", "file", "ip", "user"
	Properties string `json:"properties"` // e.g., "powershell.exe" or "10.0.0.5"
}

type GraphEdge struct {
	SourceID string `json:"source_id"`
	TargetID string `json:"target_id"`
	Relation string `json:"relation"` // e.g., "SPAWNED", "CONNECTED_TO", "READ_FILE"
}

// ProvenanceGraph forms the exact structure required for Graph Neural Network (GNN) ingestion.
type ProvenanceGraph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// Alert represents a triggered security rule, now enriched with GNN topology
type Alert struct {
	ID          string          `json:"id"`
	RuleName    string          `json:"rule_name"`
	Severity    string          `json:"severity"`
	TargetIP    string          `json:"target_ip"`
	TriggerTime time.Time       `json:"trigger_time"`
	Context     string          `json:"context"`
	GraphData   ProvenanceGraph `json:"graph_data"`
}

var (
	recentConnections = make(map[string]int)
	connMutex         sync.Mutex
)

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//    - Step 2 of 5 in Ingestion Pipeline: Fired immediately after webhook reception
//      and before ClickHouse batch database serialization.
//    - Upstream: HTTP Webhook Receiver | Downstream: Database Manager / Alert Queue
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Provides ultra-low latency, deterministic rule-based threat detection
//      over the streaming ingestion pipeline. Generates Graph topologies inline.
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - Warning: Uses a single global mutex (connMutex.Lock) which creates severe
//      lock contention under high multi-tenant EPS, essentially serializing traffic.
//    - Warning: recentConnections map grows unboundedly. High risk of OOM panics.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Reads from internal RemoteLogPayload schema. Returns Alert enriched with
//      ProvenanceGraph structures.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: Extreme traffic from spoofed IPs will exhaust heap memory
//      (OOM panic) crashing the entire ingestion container.
//    - Resilience Posture: Fail-Closed on memory exhaustion.
// ==============================================================================
func EvaluateSignatures(payload *RemoteLogPayload) *Alert {
	
	// 1. DYNAMIC GRAPH CONSTRUCTION (AST/GNN Preparations)
	// We extract structural entities to build the Provenance Graph
	var graph ProvenanceGraph
	
	// Default Host Node
	hostNode := GraphNode{ID: payload.ClientID, Type: "ip", Properties: "Endpoint IP"}
	graph.Nodes = append(graph.Nodes, hostNode)

	// If we have process execution data, map the parent/child topology
	if proc := payload.RawData.ProcessName; proc != "" {
		procNode := GraphNode{ID: "proc_" + proc, Type: "process", Properties: proc}
		graph.Nodes = append(graph.Nodes, procNode)
		
		// Map the edge: IP executed Process
		graph.Edges = append(graph.Edges, GraphEdge{SourceID: hostNode.ID, TargetID: procNode.ID, Relation: "EXECUTED"})
		
		if target := payload.RawData.TargetFile; target != "" {
			fileNode := GraphNode{ID: "file_" + target, Type: "file", Properties: target}
			graph.Nodes = append(graph.Nodes, fileNode)
			graph.Edges = append(graph.Edges, GraphEdge{SourceID: procNode.ID, TargetID: fileNode.ID, Relation: "MODIFIED_FILE"})
		}
	}

	// Safely extract query string if it exists
	queryStr := strings.ToLower(payload.RawData.Query)

	// Rule 1: SQL Injection Detection (Regex/Pattern Check)
	if queryStr != "" && (strings.Contains(queryStr, "drop table") || strings.Contains(queryStr, "' or 1=1") || strings.Contains(queryStr, "union select")) {
		log.Printf("🚨 [ALERT] SQL Injection signature detected from IP: %s", payload.ClientID)
		return &Alert{
			RuleName:    "SQL Injection Attempt",
			Severity:    "CRITICAL",
			TargetIP:    payload.ClientID,
			TriggerTime: time.Now(),
			Context:     "Malicious SQL sequence found in payload.",
			GraphData:   graph,
		}
	}

	// Rule 2: Multi-IP Data Exfiltration (Velocity/Threshold Check)
	if payload.EventType == "Large_Data_Transfer" {
		connMutex.Lock()
		recentConnections[payload.ClientID]++
		count := recentConnections[payload.ClientID]
		connMutex.Unlock()

		// If an IP triggers massive transfers 5 times rapidly, flag it
		if count > 5 {
			log.Printf("🚨 [ALERT] Potential Data Exfiltration from IP: %s", payload.ClientID)
			return &Alert{
				RuleName:    "Multi-IP Data Exfiltration",
				Severity:    "HIGH",
				TargetIP:    payload.ClientID,
				TriggerTime: time.Now(),
				Context:     "High velocity data transfers exceeding threshold.",
				GraphData:   graph,
			}
		}
	}

	// Rule 3: Access Deviations (Geographic or Time checks)
	if payload.EventType == "Login_Attempt" {
		if loc := payload.RawData.Location; loc == "Unknown_Region" {
			log.Printf("⚠️ [ALERT] Access Deviation from IP: %s", payload.ClientID)
			return &Alert{
				RuleName:    "Access Deviation (Anomalous Region)",
				Severity:    "MEDIUM",
				TargetIP:    payload.ClientID,
				TriggerTime: time.Now(),
				Context:     "Authentication attempt originated from an unauthorized/unknown region.",
				GraphData:   graph,
			}
		}
	}

	return nil
}
