import os
from urllib.parse import urlparse
import grpc
from fastapi import FastAPI, Request
from contextlib import asynccontextmanager
from Infrastructure.gRPC.Client import grpc_stub_context
from Interfaces.auth import router as local_auth_router
from Interfaces.auth_google import router as google_auth_router
from Interfaces.api_routes import router as data_router
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

class MockIngestionCoreServiceStub:
    def __init__(self, channel):
        self.channel = channel

@asynccontextmanager
async def lifespan(app: FastAPI):
    options = [('grpc.keepalive_time_ms', 30000)]
    
    core_url = os.environ.get("GO_CORE_URL", "grpc://core-ingest:9090")
    
    parsed_url = urlparse(core_url if "://" in core_url else f"grpc://{core_url}")
    core_target = f"{parsed_url.hostname}:{parsed_url.port}" if parsed_url.port else parsed_url.hostname
    
    
    internal_key = os.environ.get("INTERNAL_SERVICE_KEY", "dev-internal-key-change-in-prod")
    
    class InternalAuthInterceptor(grpc.aio.UnaryUnaryClientInterceptor, grpc.aio.UnaryStreamClientInterceptor):
        async def intercept_unary_unary(self, continuation, client_call_details, request):
            new_details = client_call_details._replace(
                metadata=(client_call_details.metadata or ()) + (("x-internal-service-key", internal_key),)
            )
            return await continuation(new_details, request)
            
        async def intercept_unary_stream(self, continuation, client_call_details, request):
            new_details = client_call_details._replace(
                metadata=(client_call_details.metadata or ()) + (("x-internal-service-key", internal_key),)
            )
            return await continuation(new_details, request)

    channel = grpc.aio.insecure_channel(core_target, options=options, interceptors=[InternalAuthInterceptor()])
    stub = MockIngestionCoreServiceStub(channel)
    token = grpc_stub_context.set(stub)
    logger.info("⚡ Secure Context Var connection pool active for LangGraph.")
    
    yield
    
    grpc_stub_context.reset(token)
    await channel.close()

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
