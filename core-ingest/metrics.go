package main

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ==========================================
// GRAFANA/PROMETHEUS METRICS EXPORTER
// ==========================================

var (
	// Track Real-Time Events Per Second (EPS)
	IngestionCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "soc_ingested_events_total",
			Help: "The total number of security logs ingested via the high-speed webhook.",
		},
		[]string{"source_host", "os_type"},
	)

	// Track the speed of the ClickHouse Batch Writer
	ClickHouseWriteLatency = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "soc_clickhouse_write_latency_seconds",
			Help:    "Latency of the asynchronous ClickHouse batch array flushing.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"status"},
	)

	// Track the Dead-Letter Queue (DLQ) Fallback activity
	DLQWriteCounter = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "soc_dlq_fallback_writes_total",
			Help: "The total number of batches routed to the bbolt disk WAL due to ClickHouse failures.",
		},
	)
)

// StartMetricsServer exposes the /metrics endpoint strictly on an internal management port
func StartMetricsServer(port string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	
	go func() {
		// Example: Listens on :2112 for Prometheus Scrapers
		if err := http.ListenAndServe(":"+port, mux); err != nil {
			panic(err)
		}
	}()
}
