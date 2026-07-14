# ==========================================
# STAGE 1: BUILDER
# ==========================================
FROM golang:1.24-alpine AS builder

# Install CA certificates and git for fetching dependencies securely
RUN apk update && apk add --no-cache git ca-certificates tzdata && update-ca-certificates

# Create an unprivileged user early to be copied to the final stage
ENV USER=appuser
ENV UID=10001
RUN adduser --disabled-password --gecos "" --home "/nonexistent" --shell "/sbin/nologin" --no-create-home --uid "${UID}" "${USER}"

WORKDIR /app

# Leverage Docker caching for Go modules
COPY core-ingest/go.mod ./
# COPY core-ingest/go.sum ./
RUN go mod download
RUN go mod verify

# Copy application source code
COPY core-ingest/ .

# Build a statically linked, stripped binary for absolute minimal size and security
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s -extldflags '-static'" -a -installsuffix cgo -o /app/soc_ingest_core main.go

# ==========================================
# STAGE 2: MINIMAL RUNTIME
# ==========================================
# We use scratch (an empty image) for the smallest possible attack surface.
FROM scratch

# Import the timezone, ca-certificates, and unprivileged user from builder
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Copy the static Go binary
COPY --from=builder /app/soc_ingest_core /soc_ingest_core

# Enforce execution as the non-root user
USER appuser:appuser

# Expose the gRPC port mapped in soc_service.proto
EXPOSE 9090

# Entrypoint
ENTRYPOINT ["/soc_ingest_core"]
