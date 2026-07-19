import contextvars

grpc_stub_context = contextvars.ContextVar("grpc_stub_context")

def get_grpc_stub():
    """Retrieves the thread-safe gRPC stub bound to the current ContextVar scope."""
    try:
        return grpc_stub_context.get()
    except LookupError:
        raise RuntimeError("gRPC stub not initialized for this context. Check FastAPI lifespan middleware.")
