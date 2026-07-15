package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - Registry Core: Foundational abstraction handling cryptographic validation parameter caching.
//    - Upstream: core-ingest/main.go HTTP Router Middleware | Downstream: ClickHouse Sink Layer
// 2. 🛡️ LOGICAL INTENT & COMPONENT ANTI-REDUNDANCY
//    - Provisions a secure lookup registry to manage external tenants, decoupling
//      credentials from environment files and ensuring dynamic onboarding capabilities.
// 3. 🚨 CLOUD GUARDRAILS, INFRASTRUCTURE CONSTRAINTS & PARITY
//    - Uses an optimized sync.RWMutex to prevent resource race locks. Multiple threads can concurrently read.
// 4. 🔗 DATA LAKE SCHEMAS & CROSS-MODULE PROTOCOL CONTRACTS
//    - Maps directly to the tenant_registry schema within PostgreSQL.
// 5. ☣️ CASCADING FAILURE MODE & PLATFORM RESILIENCE STATE
//    - If the database registry is unresponsive or keys are missing, it returns a clear error status.
//    - The caller instantly triggers a fail-closed truncation, blocking unauthenticated connections early.
// ==============================================================================

// TenantConfig defines the immutable parameters governing a tenant microservice perimeter.
type TenantConfig struct {
	TenantID       string
	WebhookSecret  []byte
	ClickHouseDB   string
	LLMProviderKey string
	UpdatedAt      time.Time
}

// MemoryRegistry cache wrapper mitigating high-frequency data access layer exhaustion loops.
type MemoryRegistry struct {
	sync.RWMutex
	cache   map[string]*TenantConfig
	dbPool  *sql.DB
	ttlTime time.Duration
}

// NewMemoryRegistry instantiates an isolated configuration storage controller.
func NewMemoryRegistry(db *sql.DB, ttl time.Duration) *MemoryRegistry {
	return &MemoryRegistry{
		cache:   make(map[string]*TenantConfig),
		dbPool:  db,
		ttlTime: ttl,
	}
}

// FetchConfig resolves tenant configurations via O(1) memory cache or queries underlying storage registries.
func (mr *MemoryRegistry) FetchConfig(tenantID string) (*TenantConfig, error) {
	mr.RLock()
	config, exists := mr.cache[tenantID]
	mr.RUnlock()

	if exists && time.Since(config.UpdatedAt) < mr.ttlTime {
		return config, nil
	}

	mr.Lock()
	defer mr.Unlock()

	// Double-check map condition after acquiring exclusive access lock
	if config, exists = mr.cache[tenantID]; exists && time.Since(config.UpdatedAt) < mr.ttlTime {
		return config, nil
	}

	query := `SELECT tenant_id, webhook_secret, clickhouse_db, llm_key FROM tenant_registry WHERE tenant_id = $1`
	var tID, secretHex, chDB, llmKey string
	err := mr.dbPool.QueryRow(query, tenantID).Scan(&tID, &secretHex, &chDB, &llmKey)
	
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("tenant registration perimeter invalid: %s", tenantID)
		}
		return nil, fmt.Errorf("metadata layer connection error: %w", err)
	}

	secretBytes, err := hex.DecodeString(secretHex)
	if err != nil {
		return nil, fmt.Errorf("malformed cryptographic secret token configuration: %w", err)
	}

	loadedConfig := &TenantConfig{
		TenantID:       tID,
		WebhookSecret:  secretBytes,
		ClickHouseDB:   chDB,
		LLMProviderKey: llmKey,
		UpdatedAt:      time.Now(),
	}

	mr.cache[tenantID] = loadedConfig
	return loadedConfig, nil
}

// AssertSignature validates incoming payload payloads against database-extracted tokens.
func AssertSignature(payload []byte, signatureHex string, secret []byte) bool {
	computedMac := hmac.New(sha256.New, secret)
	computedMac.Write(payload)
	expectedMac := computedMac.Sum(nil)

	actualMac, err := hex.DecodeString(signatureHex)
	if err != nil {
		return false
	}

	return hmac.Equal(actualMac, expectedMac)
}
