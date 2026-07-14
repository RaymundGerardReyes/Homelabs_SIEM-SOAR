# soc_sdk.py
# A minimal, safe SDK exposed to Playbooks running in the Docker sandbox.

import os
import json

# Environment variables injected by the SOAR engine
GO_CORE_URL = os.environ.get("GO_CORE_URL", "http://host.docker.internal:9090")
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN", "SYSTEM_TOKEN")

def query_threat_intel(ip_address: str) -> dict:
    """Mock query to external Threat Intel providers."""
    print(f"[SDK: query_threat_intel] Looking up {ip_address}...")
    return {"ip": ip_address, "reputation": "malicious", "confidence": 0.95}

def isolate_host(host_id: str) -> str:
    """Mock action simulating an EDR API call."""
    print(f"[SDK: isolate_host] Sending isolation command to {host_id} via EDR API...")
    return f"Host {host_id} successfully isolated."
