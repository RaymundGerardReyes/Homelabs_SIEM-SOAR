// network_analyzer.go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	// KnownDestinations caches source-to-destination pairs to prevent database hammering.
	// Key format: "TenantID:SourceIP:DestinationIP:DestinationPort:Protocol"
	KnownDestinations sync.Map
)

// CheckDestinationNovelty evaluates if this is the first time a host has talked to a specific IP endpoint.
func CheckDestinationNovelty(tenantID string, flow NetworkFlow, dbManager *DatabaseManager) ([]NetworkAnomalySignal, error) {
	var signals []NetworkAnomalySignal

	// Guard clause: Ensure we have valid IP addresses to check
	if flow.SourceIP == "" || flow.DestinationIP == "" {
		return signals, nil
	}

	// 1. Create a highly precise composite key for this communication pair
	cacheKey := fmt.Sprintf("%s:%s:%s:%d:%s", tenantID, flow.SourceIP, flow.DestinationIP, flow.DestinationPort, flow.Protocol)

	// 2. Fast Path: Check In-Memory Cache
	if _, exists := KnownDestinations.Load(cacheKey); exists {
		// We have seen this pair in memory recently; it is not new.
		return signals, nil
	}

	// 3. Slow Path: Check ClickHouse Database (Historical Baseline)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Query ClickHouse to see if this source has ever talked to this destination endpoint before.
	// We query the authoritative canonical network flow table. Assuming it is soc.remote_agent_telemetry or similar.
	// We'll use the canonical format if available.
	query := `
		SELECT count() 
		FROM soc.application_security_logs 
		WHERE tenant_id = ? 
		  AND JSONExtractString(raw_data, 'source_ip') = ? 
		  AND JSONExtractString(raw_data, 'destination_ip') = ?
		  AND JSONExtractInt(raw_data, 'destination_port') = ?
		LIMIT 1
	`
	
	var count uint64
	if dbManager == nil || dbManager.CHPool == nil {
		return signals, fmt.Errorf("database manager uninitialized")
	}

	err := dbManager.CHPool.QueryRow(ctx, query, tenantID, flow.SourceIP, flow.DestinationIP, flow.DestinationPort).Scan(&count)
	
	if err != nil {
		return signals, fmt.Errorf("failed to query historical destinations: %w", err)
	}

	// 4. Evaluate Novelty
	if count == 0 {
		signals = append(signals, NetworkAnomalySignal{
			SignalID:    "A-NOV-" + uuid.New().String(),
			SignalType:  "NEW_DESTINATION",
			Severity:    "MEDIUM",
			Description: fmt.Sprintf("First time connection observed from %s to %s on port %d/%s.", flow.SourceIP, flow.DestinationIP, flow.DestinationPort, flow.Protocol),
			EvidenceIDs: []string{flow.EventID},
		})
	}

	// 5. Update Cache
	// Do not treat cache as authoritative; only update it here because we mathematically checked the DB.
	KnownDestinations.Store(cacheKey, true)

	return signals, nil
}

// NetworkAnomalySignal represents a deterministic finding derived from network telemetry.
type NetworkAnomalySignal struct {
	SignalID    string   `json:"signal_id"`
	SignalType  string   `json:"signal_type"`
	Severity    string   `json:"severity"`
	Description string   `json:"description"`
	Ratio       float64  `json:"ratio,omitempty"`
	
	// PHASE 9.33: Preserve the raw evidence!
	EvidenceIDs []string `json:"evidence_ids"` 
}

// AnalyzeNetworkFlow processes our canonical NetworkFlow to generate objective security signals.
func AnalyzeNetworkFlow(flow NetworkFlow) []NetworkAnomalySignal {
	var signals []NetworkAnomalySignal

	// Guard clause: Ensure we have actual network flow data to analyze
	if flow.BytesOut == 0 && flow.BytesIn == 0 {
		return signals
	}

	// 1. Detect Outbound Byte Asymmetry
	if flow.BytesOut > 0 && flow.BytesIn > 0 {
		asymmetryRatio := float64(flow.BytesOut) / float64(flow.BytesIn)
		
		if asymmetryRatio >= 50.0 {
			signals = append(signals, NetworkAnomalySignal{
				SignalID:    "A-" + uuid.New().String(), // Generate a unique ID for the anomaly itself
				SignalType:  "OUTBOUND_BYTE_ASYMMETRY",
				Severity:    "HIGH",
				Description: fmt.Sprintf("Highly asymmetric flow detected. Sent %d bytes, received %d bytes (Ratio: %.2f:1)", flow.BytesOut, flow.BytesIn, asymmetryRatio),
				Ratio:       asymmetryRatio,
				EvidenceIDs: []string{flow.EventID}, // Link back to the original raw flow!
			})
		}
	}

	// 2. Detect Large Outbound Transfers
	outboundMB := float64(flow.BytesOut) / 1048576.0
	
	if outboundMB >= 100.0 {
		signals = append(signals, NetworkAnomalySignal{
			SignalID:    "A-" + uuid.New().String(),
			SignalType:  "LARGE_OUTBOUND_TRANSFER",
			Severity:    "MEDIUM",
			Description: fmt.Sprintf("Large outbound data transfer observed: %.2f MB to %s:%d", outboundMB, flow.DestinationIP, flow.DestinationPort),
			Ratio:       0.0,
			EvidenceIDs: []string{flow.EventID}, // Link back to the original raw flow!
		})
	}

	return signals
}
