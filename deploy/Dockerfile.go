# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Stage 1: High-Performance Multi-Stage Ingestion Compilation Layer.
#    - Upstream: Docker Hub Official Image Registry | Downstream: Stage 2 Scratch Distroless Runtime
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Establishes a hardened, isolated static compiler environment required to resolve 
#      third-party dependency chains and cross-compile the monolithic Go binary.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Toolchain Boundary: Must lock precisely to a Go >= 1.25 tracking image. Lower compiler 
#      architectures will trigger module boundary verification crashes during parsing.
#    - Cache Optimization: Copies dependency files (`go.mod`) into individual layers before 
#      mounting the source array, cutting rebuild compilation overhead via layer caching.
# ==============================================================================

# CRITICAL FIX: Upgraded from 1.24 to 1.25 to satisfy core-ingest/go.mod engine engine requirements
FROM golang:1.25-alpine AS builder

# Install CA certificates and git for fetching dependencies securely
RUN apk update && apk add --no-cache git ca-certificates tzdata && update-ca-certificates

# Create an unprivileged user early to be copied to the final stage
ENV USER=appuser
ENV UID=10001
RUN adduser --disabled-password --gecos "" --home "/nonexistent" --shell "/sbin/nologin" --no-create-home --uid "${UID}" "${USER}"

# Pre-create the Dead-Letter Queue (DLQ) logging directory with correct ownership
RUN mkdir -p /var/log/soc_core && chown -R ${USER}:${USER} /var/log/soc_core

WORKDIR /app

# Leverage Docker caching for Go modules
COPY core-ingest/go.mod ./
# COPY core-ingest/go.sum ./
RUN go mod download
RUN go mod verify

# Copy application source code
COPY core-ingest/ .

# Build a statically linked, stripped binary for absolute minimal size and security
# BEFORE: 
# RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... -o /app/soc_ingest_core main.go

# AFTER:
# CRITICAL FIX: Direct the Go compiler to build the entire directory context (.) 
# instead of isolating main.go. This links database.go, auth.go, and correlation.go.


# CRITICAL FIX: Restored the accidentally cut-off compilation string and pointed it to the root directory (.)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s -extldflags '-static'" -a -installsuffix cgo -o /app/soc_ingest_core .



# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Container Blueprint: Go Ingestion Core Runtime Container (Stage 2).
#    - Upstream: Stage 1 Builder Compilation Layer | Downstream: Active Ingress Pod / Mesh Fleet
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Drops the heavy compiler footprint and references a completely empty root 
#      filesystem (`FROM scratch`) to serve the compiled ingest worker.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Security: The `scratch` target contains zero operating system footprints, shells, or 
#      package daemons. This completely neutralizes Remote Code Execution (RCE) escape paths.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Maps runtime endpoints directly to Port 9090 as declared in `soc_service.proto`. 
#      Imports system trust stores (`ca-certificates.crt`) to allow outbound secure lookups.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Missing root certificates breaks outbound HTTPS telemetry loops.
#    - Fallback State: Statically inherits tzdata and verification roots from the Stage 1 layer.
# ==============================================================================
FROM scratch

# Import the timezone, ca-certificates, and unprivileged user from builder
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Create and copy the writable logging directory for bbolt DLQ
COPY --from=builder --chown=appuser:appuser /var/log/soc_core /var/log/soc_core

# Copy the static Go binary
COPY --from=builder /app/soc_ingest_core /soc_ingest_core

# Enforce execution as the non-root user
USER appuser:appuser

# Expose the gRPC port mapped in soc_service.proto
EXPOSE 9090

# Entrypoint
ENTRYPOINT ["/soc_ingest_core"]
