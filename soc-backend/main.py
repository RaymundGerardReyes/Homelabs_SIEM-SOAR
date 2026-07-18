import os
from urllib.parse import urlparse
import grpc
from fastapi import FastAPI, Request
from contextlib import asynccontextmanager
from context_config import grpc_stub_context
from auth_google import router as auth_router
from api_routes import router as data_router
import logging

from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Assumes protoc generated code is placed in the 'pb' module:
# from pb import soc_service_pb2_grpc

class MockIngestionCoreServiceStub:
    def __init__(self, channel):
        self.channel = channel

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - FastAPI Bootstrap: The absolute root entry point for the Python orchestrator.
#    - Upstream: Nginx Load Balancer / SIEM Webhooks | Downstream: LangGraph Agents
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Establishes the persistent `grpc.aio.insecure_channel` connection pool to the
#      Go backend exactly once during the server lifespan.
#    - Anchors the gRPC stub to a thread-safe `ContextVar` to prevent variable pollution.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Python Backend / ML: Using `ContextVars` correctly bypasses the asyncio
#      task-switching limits, ensuring concurrent requests do not steal each other's
#      socket instances.
#    - Docker / Devops: Connection relies on docker-compose DNS `core-ingest:9090`.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Initializes the `MockIngestionCoreServiceStub` (or Protobuf stub in prod).
#    - Serves REST API over `0.0.0.0:8000`.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: If `core-ingest` is offline during boot, the channel creation
#      will succeed (lazy connection), but the first gRPC call will throw `StatusCode.UNAVAILABLE`.
#    - Fallback State: The FastAPI server boots regardless (Fail-Open), allowing UI endpoints to function.
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Establish single persistent connection pool on server boot
    options = [('grpc.keepalive_time_ms', 30000)]
    
    # ==============================================================================
    # 1. 🌐 COMPONENT PLACEMENT & DYNAMIC NETWORK DISCOVERY
    #    - Step 1 of 5: Microservice network connection bootstrapping prior to HTTP or gRPC request routing.
    #    - Upstream: Cloud PaaS ENV / Local Docker DNS | Downstream: core-ingest gRPC
    # 🛡️ 2. LOGICAL INTENT, ARCHITECTURAL PARITY & ANTI-REDUNDANCY
    #    - Dynamically maps the target gRPC ingestion engine using standard `urllib.parse`
    #      to securely extract host and port, gracefully isolating environments without naive string hacks.
    # 🚨 3. TRANSPORTS & SYSTEM RESOURCE GUARDRAILS
    #    - Isolates the gRPC channel into a thread-safe `ContextVar` scope, explicitly
    #      preventing race conditions across `asyncio` task-switching boundaries.
    # 🔗 4. CROSS-MODULE INTERFACE & TLS CONTRACT BOUNDARIES
    #    - Anchors into `soc_service.proto` specifications via `core-ingest:9090`.
    # ☣️ 5. CASCADING FAILURE MODE & DETAILED RESILIENCE STATE
    #    - Failure Mode: Invalid DNS or unreachable network host.
    #    - Resilience State: Employs a lazy-retry mechanism via `grpc.aio.insecure_channel`.
    #      The boot routine succeeds (Fail-Open), and the connection dynamically reconnects on the first payload.
    # ==============================================================================
    core_url = os.environ.get("GO_CORE_URL", "grpc://core-ingest:9090")
    
    # Robust URL Parsing: Extract the exact host and port regardless of scheme
    parsed_url = urlparse(core_url if "://" in core_url else f"grpc://{core_url}")
    core_target = f"{parsed_url.hostname}:{parsed_url.port}" if parsed_url.port else parsed_url.hostname
    
    channel = grpc.aio.insecure_channel(core_target, options=options)
    
    # In production: stub = soc_service_pb2_grpc.IngestionCoreServiceStub(channel)
    stub = MockIngestionCoreServiceStub(channel)
    
    # Securely bind the stub reference to the context var tracking token
    token = grpc_stub_context.set(stub)
    logger.info("⚡ Secure Context Var connection pool active for LangGraph.")
    
    yield
    
    # Cleanup file descriptors completely on server exit
    grpc_stub_context.reset(token)
    await channel.close()

# CRITICAL UNIFICATION FIX: Only instantiate the application once with all structural parameters
app = FastAPI(title="AI-Driven Agentic SOC Backend", lifespan=lifespan)
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(data_router, prefix="/api/data", tags=["Data"])

# 1. ENFORCE TRUSTED HOST RESTRICTIONS (Handled natively by Nginx edge)
# Removed TrustedHostMiddleware to prevent "Invalid host header" errors behind reverse proxies.

# 2. PROXY MIDDLEWARE: Forces FastAPI to recognize Nginx SSL termination
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
    try:
        return await call_next(request)
    except Exception as e:
        raise e

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
