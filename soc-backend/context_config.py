from contextvars import ContextVar
from typing import Any

# Create an isolated, thread-safe memory context slot for the network client
grpc_stub_context: ContextVar[Any] = ContextVar("grpc_stub_context")

# Create an isolated, thread-safe memory context slot for multi-tenant configurations
tenant_config_context: ContextVar[Any] = ContextVar("tenant_config_context")

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - State Bridging Module: Available globally across the entire FastAPI instance.
#    - Upstream: FastAPI Lifespan Boot | Downstream: Any gRPC-dependent Agent Tool
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Injects thread-safe access to the persistent gRPC socket without having to
#      pass connection instances explicitly through deeply nested LangGraph logic.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Python Backend / ML: Utilizes Python `ContextVar`. This guarantees memory
#      isolation across `asyncio` task switches, preventing concurrent web requests
#      from mutating or dropping each other's socket references.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Interacts purely with the internal Python event loop thread state.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Calling this outside the context of a FastAPI request cycle
#      will raise a fatal `LookupError`.
#    - Fallback State: Bubbles up as an unhandled HTTP 500 error if invoked illegally.
# ==============================================================================
def get_grpc_stub() -> Any:
    """
    Thread-safe utility wrapper. Allows LangGraph tools to instantly 
    pull the warm network channel from memory without passing framework objects.
    """
    try:
        return grpc_stub_context.get()
    except LookupError:
        raise RuntimeError("gRPC Stub has not been initialized within this thread context.")

def get_tenant_config() -> Any:
    """
    Thread-safe utility wrapper. Allows deeply nested AI inference logic to instantly 
    pull cryptographic and API billing tokens for the active request's tenant.
    """
    try:
        return tenant_config_context.get()
    except LookupError:
        raise RuntimeError("Tenant configuration has not been initialized within this thread context.")
