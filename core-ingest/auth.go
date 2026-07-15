package main

import (
	"crypto/rsa"
	"fmt"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// ==========================================
// ASYMMETRIC JWT VERIFICATION ENGINE (RSA-256)
// ==========================================

// Global loaded public key
var verifyKey *rsa.PublicKey

func InitJWTEngine() error {
	pubKeyStr := os.Getenv("JWT_PUBLIC_KEY")
	if pubKeyStr == "" {
		return fmt.Errorf("JWT_PUBLIC_KEY environment variable is missing in core-ingest")
	}

	// Unescape the newline characters and remove docker .env quotes
	pubKeyStr = strings.ReplaceAll(pubKeyStr, "\\n", "\n")
	pubKeyStr = strings.Trim(pubKeyStr, "\"'")

	key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(pubKeyStr))
	if err != nil {
		return fmt.Errorf("failed to parse RSA public key from environment: %w", err)
	}

	verifyKey = key
	return nil
}

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//    - Step 1 of gRPC Inbound Request: Fired prior to executing containment or
//      block directives from the AI Orchestrator.
//    - Upstream: Python AI ML Agent | Downstream: gRPC Containment Executors
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Provides cryptographic proof of identity and Role-Based Access Control
//      (RBAC) for high-privileged gRPC containment commands.
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - 100% Lock-Free and Thread-Safe. Safely executes in parallel gRPC streams.
//    - Warning: verifyKey is loaded once at startup. No hot-reloading mechanism
//      exists, meaning certificate rotation requires a container restart.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Consumes standard JWT strings. Expects Issuer 'soc-backend-identity' and
//      Role 'agent_orchestrator'.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: Token signature mismatches or "alg: none" bypass attempts
//      are instantly hard-rejected.
//    - Resilience Posture: Fail-Closed. Untrusted identities cannot manipulate state.
// ==============================================================================
func VerifyAgentJWT(tokenString string) (*jwt.MapClaims, error) {
	// 1. Parse and mathematically verify the asymmetric signature using RS256
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Enforce strict algorithmic validation (Prevent "None" algorithm exploits)
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		// Return the pre-loaded public key
		return verifyKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("cryptographic signature verification failed: %w", err)
	}

	// 2. Extract and validate structural claims (Expiration, Issuer)
	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		// Validate Issuer (Ensure the token came from the soc-backend Identity Provider)
		if iss, ok := claims["iss"].(string); !ok || iss != "soc-backend-identity" {
			return nil, fmt.Errorf("invalid or missing token issuer")
		}

		// Enforce explicit RBAC Roles for high-risk actions
		if role, ok := claims["role"].(string); !ok || role != "agent_orchestrator" {
			return nil, fmt.Errorf("insufficient RBAC permissions to execute containment directives")
		}

		return &claims, nil
	}

	return nil, fmt.Errorf("invalid structural token format")
}

// ==============================================================================
// 1. WORKFLOW PATHWAY & LIFECYCLE PINPOINT
//    - Edge Telemetry Validation: Authorizes raw webhook JSON payloads.
//    - Upstream: Public PaaS Nginx Gateway | Downstream: Go `handleAgentPush`
// 2. LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Ensures external cloud services have cryptographically verified access
//      to push mass telemetry data without exposing the internal DB layer.
// 3. HARD ARCHITECTURAL CONSTRAINTS & THREAD SAFETY WARNINGS
//    - Thread-safe RSA verifications without locking.
// 4. PROTOCOL & SCHEMA BOUNDARIES
//    - Expects `remote-paas-agent` issuer.
// 5. FAILURE DOMAIN & RESILIENCE RUNBOOK
//    - Failure Mode: Stolen or expired tokens.
//    - Resilience Posture: Instantly hard-rejects (Fail-Closed).
// ==============================================================================
func VerifyTelemetryJWT(tokenString string) (*jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return verifyKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("cryptographic signature verification failed: %w", err)
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		if iss, ok := claims["iss"].(string); !ok || iss != "remote-paas-agent" {
			return nil, fmt.Errorf("invalid telemetry token issuer")
		}
		return &claims, nil
	}
	return nil, fmt.Errorf("invalid structural token format")
}
