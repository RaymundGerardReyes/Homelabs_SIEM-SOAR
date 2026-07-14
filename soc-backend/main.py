import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
import grpc.aio
from typing import List, Dict

# Assumes protoc generated code is placed in the 'pb' module:
# import pb.soc_service_pb2 as pb2
# import pb.soc_service_pb2_grpc as pb2_grpc

# We mock these classes for the blueprint to run cleanly without requiring protoc compilation locally
class MockIngestionCoreServiceStub:
    def __init__(self, channel):
        self.channel = channel
    
    async def FetchAlertContext(self, request):
        return type("Response", (), {"status": "success", "events_found": 1, "log_payload_json": '{"mock":"data"}'})()
        
    async def PushBlockDirective(self, request):
        return type("Response", (), {"success": True, "log_id": "audit-123"})()

class MockLogContextRequest:
    def __init__(self, evidence_ids):
        self.evidence_ids = evidence_ids

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state for persistent gRPC connection
grpc_channel = None
soc_core_stub = None

# ==========================================
# FASTAPI LIFESPAN (Connection Management)
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global grpc_channel, soc_core_stub
    logger.info("Initializing persistent async gRPC connection to Go Ingestion Core (localhost:9090)...")
    
    # Initialize the asyncio-based gRPC channel
    grpc_channel = grpc.aio.insecure_channel("localhost:9090")
    
    # Instantiate the stub (Replace Mock with actual pb2_grpc.IngestionCoreServiceStub)
    # soc_core_stub = pb2_grpc.IngestionCoreServiceStub(grpc_channel)
    soc_core_stub = MockIngestionCoreServiceStub(grpc_channel)
    
    yield
    
    logger.info("Closing async gRPC connection during shutdown...")
    if grpc_channel:
        await grpc_channel.close()

app = FastAPI(title="Agentic SOC Backend", lifespan=lifespan)

# ==========================================
# LLM NATIVE TOOL WRAPPER
# ==========================================
async def query_soc_core_logs_tool(evidence_ids: List[str]) -> Dict:
    """
    Native Python tool function wrapper. 
    Actively triggers the async Go gRPC stub client, processes the binary response, 
    and returns it as a native dictionary for the LLM context.
    """
    if not soc_core_stub:
        raise RuntimeError("gRPC stub is not initialized.")
        
    logger.info(f"Tool Invoked: Querying Go Core for {len(evidence_ids)} evidence IDs...")
    
    # Instantiate protobuf request (Replace MockLogContextRequest with pb2.LogContextRequest)
    request = MockLogContextRequest(evidence_ids=evidence_ids)
    
    # Await the async gRPC call to strictly prevent blocking the concurrent FastAPI event loop
    response = await soc_core_stub.FetchAlertContext(request)
    
    if response.status != "success":
        logger.error(f"Go Core returned error: {response.status}")
        return {"error": "Failed to fetch context from Go Core."}
        
    # Safely parse the returning JSON payload from the Go Core string field
    try:
        data = json.loads(response.log_payload_json)
        return {
            "events_found": response.events_found,
            "data": data
        }
    except json.JSONDecodeError:
        logger.error("Failed to decode JSON from gRPC response payload.")
        return {"error": "Invalid JSON payload returned from Go Core."}

# ==========================================
# LANGGRAPH MOCKUP INTEGRATION
# ==========================================
# This demonstrates exactly how the tool above is injected into a LangGraph StateGraph Node
"""
from langgraph.graph import StateGraph, END
from typing import TypedDict

class AgentState(TypedDict):
    evidence_ids: List[str]
    context_data: dict

async def query_node(state: AgentState):
    # The LangGraph node directly awaits our async gRPC tool wrapper
    context = await query_soc_core_logs_tool(state["evidence_ids"])
    return {"context_data": context}

workflow = StateGraph(AgentState)
workflow.add_node("query_go_core", query_node)
workflow.set_entry_point("query_go_core")
workflow.add_edge("query_go_core", END)
compiled_graph = workflow.compile()
"""

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "grpc_connected": grpc_channel is not None}

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
