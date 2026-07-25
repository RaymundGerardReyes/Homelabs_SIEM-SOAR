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
from Domain.Investigations.LargeLanguageModelTriage import simulate_triage_pipeline
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

class CorrelationIdFilter(logging.Filter):
    def filter(self, record):
        record.correlation_id = correlation_id_ctx.get()
        return True

# Update root logger to include correlation ID
root_logger = logging.getLogger()
for handler in root_logger.handlers:
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - [corr_id:%(correlation_id)s] - %(message)s'))
    handler.addFilter(CorrelationIdFilter())

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

                # Fire-and-forget: spin up triage pipeline asynchronously so the
                # gRPC stream read-loop is never blocked by AI processing latency.
                asyncio.create_task(
                    simulate_triage_pipeline(
                        correlation_id=corr_id,
                        investigation_id=f"inv-{corr_id[:8]}"
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
    options = [
        ('grpc.keepalive_time_ms', 60000),
        ('grpc.keepalive_timeout_ms', 20000),
        ('grpc.keepalive_permit_without_calls', True),
        ('grpc.http2.min_time_between_pings_ms', 10000),
    ]

    
    core_url = os.environ.get("GO_CORE_URL", "grpc://core-ingest:9090")
    parsed_url = urlparse(core_url if "://" in core_url else f"grpc://{core_url}")
    core_target = f"{parsed_url.hostname}:{parsed_url.port}" if parsed_url.port else parsed_url.hostname
    
    internal_key = os.environ.get("INTERNAL_SERVICE_KEY", "dev-internal-key-change-in-prod")

    channel = grpc.aio.insecure_channel(core_target, options=options)
    
    # Use the real generated stub for both existing calls and the new subscription
    real_stub = soc_service_pb2_grpc.IngestionCoreServiceStub(channel)
    token = grpc_stub_context.set(real_stub)
    logger.info(f"⚡ [gRPC] Connected to core-ingest at {core_target}")

    # Launch the persistent background consumer task that closes the
    # Go -> Python -> WebSocket -> UI execution loop.
    # NOTE: internal_key is passed directly so the consumer can attach it as
    # call-level metadata on the server-streaming RPC (interceptors don't fire
    # reliably for server-streaming calls in grpc.aio).
    consumer_task = asyncio.create_task(_grpc_event_consumer(real_stub, internal_key))
    logger.info("🚀 [Triage Consumer] Background LangGraph event consumer started.")
    
    yield
    

    consumer_task.cancel()
    try:
        await consumer_task
    except asyncio.CancelledError:
        pass
    
    grpc_stub_context.reset(token)
    await channel.close()
    logger.info("🛑 [gRPC] Connection pool closed.")

app = FastAPI(title="AI-Driven Agentic SOC Backend", lifespan=lifespan)
app.include_router(local_auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(google_auth_router, prefix="/api/auth/google", tags=["Google Authentication"])
app.include_router(data_router, prefix="/api", tags=["Data"])

class HTTPSRedirectProxyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        forwarded_proto = request.headers.get("x-forwarded-proto")
        
        if request.scope.get("type") == "websocket":
            return await call_next(request)
            
        if forwarded_proto == "https" and request.scope.get("type") == "http":
            request.scope["scheme"] = "https"
            
        return await call_next(request)

app.add_middleware(HTTPSRedirectProxyMiddleware)

@app.middleware("http")
async def ensure_context_persistence(request: Request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    token = correlation_id_ctx.set(correlation_id)
    
    start_time = time.time()
    try:
        response = await call_next(request)
        
        # Record Prometheus HTTP metrics
        duration = time.time() - start_time
        route = request.url.path
        if route != "/metrics" and route != "/api/health":
            HTTP_REQUESTS_TOTAL.labels(method=request.method, endpoint=route, status=response.status_code).inc()
            HTTP_REQUEST_DURATION.labels(method=request.method, endpoint=route).observe(duration)
            
        return response
    except Exception as e:
        HTTP_REQUESTS_TOTAL.labels(method=request.method, endpoint=request.url.path, status=500).inc()
        logger.error(f"Request Failed: {e}")
        raise e
    finally:
        correlation_id_ctx.reset(token)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
