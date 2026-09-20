import os
import asyncio
from urllib.parse import urlparse
import grpc
from fastapi import FastAPI, Request
from contextlib import asynccontextmanager
from Infrastructure.gRPC.Client import grpc_stub_context
from Interfaces.auth import router as local_auth_router
from Interfaces.auth_google import router as google_auth_router
from Interfaces.api_routes import router as data_router
from Interfaces.agent_routes import router as agent_router
from Domain.Investigations.LargeLanguageModelTriage import simulate_triage_pipeline
from Domain.Investigations.AntigravityTriageAgent import antigravity_triage_coordinator
from Domain.Intelligence.AIIntelligenceEngine import run_intelligence_loop
from pb import soc_service_pb2, soc_service_pb2_grpc
import logging
import contextvars
import time
from fastapi.responses import Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from Infrastructure.Metrics import HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION

from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

correlation_id_ctx = contextvars.ContextVar("correlation_id", default="system")
tenant_id_ctx = contextvars.ContextVar("tenant_id", default="default_fallback_tenant")

import re

class CorrelationIdFilter(logging.Filter):
    def filter(self, record):
        record.correlation_id = correlation_id_ctx.get()
        return True

class AnonymizePIIFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) > 0:
            new_args = list(record.args)
            if isinstance(new_args[0], str):
                # Simply replace the first 3 octets and leave the 4th octet (and optional port) completely intact
                new_args[0] = re.sub(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.', '***.***.***.', new_args[0])
            record.args = tuple(new_args)
            
        if isinstance(record.msg, str):
            # Same strategy for inline IPs
            record.msg = re.sub(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.', '***.***.***.', record.msg)
            # Mask domains without relying on optional path groups that cause 'unmatched group' errors
            record.msg = re.sub(r'(https?://)[a-zA-Z0-9][a-zA-Z0-9-._]+(\.[a-zA-Z0-9-]+)', r'\1*******************\2', record.msg)
            
        return True

# Update root logger to include correlation ID
root_logger = logging.getLogger()
for handler in root_logger.handlers:
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - [corr_id:%(correlation_id)s] - %(message)s'))
    handler.addFilter(CorrelationIdFilter())

logging.getLogger("uvicorn.access").addFilter(AnonymizePIIFilter())
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def _grpc_event_consumer(stub: soc_service_pb2_grpc.IngestionCoreServiceStub, internal_key: str):
    """
    Persistent background task: subscribes to the core-ingest QualifiedEvent stream.
    For every event received, triggers the LangGraph AI triage pipeline and emits
    node-transition events to the ws/agent/stream WebSocket feed.
    Automatically reconnects with exponential back-off on connection loss.
    The internal_key is passed directly as gRPC call metadata (interceptors do not
    fire reliably on server-streaming calls in grpc.aio).
    """
    backoff = 1.0
    max_backoff = 60.0
    subscriber_id = os.environ.get("HOSTNAME", "soc-backend-01")
    # Build the metadata tuple once — reused on every reconnect attempt.
    auth_metadata = (("x-internal-service-key", internal_key),)

    while True:
        try:
            logger.info(f"🔗 [Triage Consumer] Subscribing to core-ingest QualifiedEvent stream (subscriber={subscriber_id})")
            request = soc_service_pb2.SubscriptionRequest(subscriber_id=subscriber_id)
            # Pass the service key as call-level metadata on the server-streaming RPC.
            stream = stub.SubscribeToQualifiedEvents(request, metadata=auth_metadata)

            async for event in stream:
                corr_id = event.correlation_id
                event_type = event.event_type
                endpoint_id = event.endpoint_id
                risk_score = event.risk_score

                logger.info(
                    f"📥 [Triage Consumer] Received QualifiedEvent | CorrID={corr_id} "
                    f"Type={event_type} Endpoint={endpoint_id} RiskScore={risk_score}"
                )

                # Fire-and-forget: spin up autonomous triage pipeline asynchronously so the
                # gRPC stream read-loop is never blocked by AI processing latency.
                asyncio.create_task(
                    antigravity_triage_coordinator.execute_triage(
                        correlation_id=corr_id,
                        investigation_id=f"inv-{corr_id[:8]}",
                        telemetry={
                            "event_type": event_type,
                            "endpoint_id": endpoint_id,
                            "risk_score": risk_score,
                            "application": "router_firewall_drop" if "drop" in event_type.lower() else event_type
                        }
                    )
                )

            # Stream ended gracefully — retry immediately
            logger.warning("⚠️ [Triage Consumer] core-ingest stream ended. Reconnecting...")
            backoff = 1.0

        except grpc.aio.AioRpcError as e:
            logger.error(f"❌ [Triage Consumer] gRPC error: {e.code()} - {e.details()}. Retry in {backoff}s")
        except Exception as e:
            logger.error(f"❌ [Triage Consumer] Unexpected error: {e}. Retry in {backoff}s")

        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, max_backoff)  # Exponential back-off, cap at 60s




@asynccontextmanager
async def lifespan(app: FastAPI):
    from Infrastructure.Http.Deps import init_db_pool, close_db_pool
    try:
        await init_db_pool()
    except Exception as e:
        logger.warning(f"⚠️ [PostgreSQL] Initial pool setup warning: {e}")

    options = [
        ('grpc.keepalive_time_ms', 60000),
        ('grpc.keepalive_timeout_ms', 20000),
        ('grpc.keepalive_permit_without_calls', True),
        ('grpc.http2.min_time_between_pings_ms', 10000),
    ]

    core_url = os.environ.get("GO_CORE_URL", "grpc://core-ingest:9090")
    if core_url.startswith("encrypted:"):
        logger.warning("⚠️ GO_CORE_URL contains an un-decrypted token. Falling back to default grpc://core-ingest:9090")
        core_url = "grpc://core-ingest:9090"
    parsed_url = urlparse(core_url if "://" in core_url else f"grpc://{core_url}")
    try:
        core_target = f"{parsed_url.hostname}:{parsed_url.port}" if parsed_url.port else (parsed_url.hostname or "core-ingest:9090")
    except (ValueError, TypeError):
        core_target = "core-ingest:9090"
    
    internal_key = os.environ.get("INTERNAL_SERVICE_KEY", "dev-internal-key-change-in-prod")
    if internal_key.startswith("encrypted:"):
        internal_key = "dev-internal-key-change-in-prod"

    channel = grpc.aio.insecure_channel(core_target, options=options)
    
    # Use the real generated stub for both existing calls and the new subscription
    real_stub = soc_service_pb2_grpc.IngestionCoreServiceStub(channel)
    token = grpc_stub_context.set(real_stub)
    logger.info(f"⚡ [gRPC] Connected to core-ingest at {core_target}")

    # Launch the persistent background consumer task that closes the
    # Go -> Python -> WebSocket -> UI execution loop.
    consumer_task = asyncio.create_task(_grpc_event_consumer(real_stub, internal_key))
    logger.info("🚀 [Triage Consumer] Background LangGraph event consumer started.")

    # Start the Central AI Intelligence Engine — sole intelligence layer.
    # Reads from internal event bus (fed by /api/v1/agent/push), never from external SDKs.
    from Infrastructure.Http.Deps import get_db
    ai_engine_task = asyncio.create_task(run_intelligence_loop(get_db))
    logger.info("🧠 [AI Engine] Central Intelligence Engine started as background task.")
    
    yield

    consumer_task.cancel()
    ai_engine_task.cancel()
    try:
        await asyncio.gather(consumer_task, ai_engine_task, return_exceptions=True)
    except asyncio.CancelledError:
        pass
    
    grpc_stub_context.reset(token)
    await channel.close()
    await close_db_pool()
    logger.info("🛑 [gRPC] Connection pool closed.")

app = FastAPI(title="AI-Driven Agentic SOC Backend", lifespan=lifespan)
app.include_router(local_auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(google_auth_router, prefix="/api/auth/google", tags=["Google Authentication"])
app.include_router(agent_router, prefix="/api", tags=["Agent Fabric"])
app.include_router(data_router, prefix="/api", tags=["Data"])
app.include_router(data_router, tags=["Data Direct"])

class HTTPSRedirectProxyMiddleware:
    """
    Pure ASGI middleware to rewrite the scheme to https if x-forwarded-proto is https.
    Using BaseHTTPMiddleware breaks WebSockets, so this uses the pure ASGI interface.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            if b"x-forwarded-proto" in headers and headers[b"x-forwarded-proto"] == b"https":
                scope["scheme"] = "https"
                
        return await self.app(scope, receive, send)

app.add_middleware(HTTPSRedirectProxyMiddleware)

@app.middleware("http")
async def ensure_context_persistence(request: Request, call_next):
    from Infrastructure.Metrics import record_http_latency
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    tenant_id = request.headers.get("X-Tenant-ID", "default_fallback_tenant")
    
    token_corr = correlation_id_ctx.set(correlation_id)
    token_tenant = tenant_id_ctx.set(tenant_id)
    
    start_time = time.time()
    try:
        response = await call_next(request)
        
        # Record Prometheus HTTP metrics & high latency threshold warnings
        duration = time.time() - start_time
        route = request.url.path
        if route != "/metrics" and route != "/api/health":
            HTTP_REQUESTS_TOTAL.labels(method=request.method, endpoint=route, status=response.status_code).inc()
            record_http_latency(method=request.method, endpoint=route, duration_seconds=duration)
            
        return response
    except Exception as e:
        HTTP_REQUESTS_TOTAL.labels(method=request.method, endpoint=request.url.path, status=500).inc()
        logger.error(f"Request Failed: {e}")
        raise e
    finally:
        correlation_id_ctx.reset(token_corr)
        tenant_id_ctx.reset(token_tenant)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
