import os
import httpx
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from pydantic import BaseModel
from .Registry import PLAYBOOKS_DB

logger = logging.getLogger(__name__)

async def record_action_success(endpoint_id: str, action_payload: dict, response_data: dict):
    logger.info(f"✅ SOAR Action Success | Endpoint: {endpoint_id} | Action: {action_payload.get('action')} | Resp: {response_data}")

async def record_action_failure(endpoint_id: str, action_payload: dict, reason: str, timestamp: datetime):
    logger.error(f"❌ SOAR Action Failure | Endpoint: {endpoint_id} | Action: {action_payload.get('action')} | Reason: {reason}")

class EndpointTarget(BaseModel):
    id: str
    cf_tunnel_url: str
    cf_client_id: str
    cf_client_secret: str

async def execute_playbook_on_endpoint(endpoint: EndpointTarget, action_payload: dict):
    """
    Executes a SOAR action against an endpoint via its Cloudflare Tunnel URL,
    authenticated using Cloudflare Access Service Tokens.
    """
    url = f"{endpoint.cf_tunnel_url.rstrip('/')}/agent/execute"
    headers = {
        "CF-Access-Client-Id": endpoint.cf_client_id,
        "CF-Access-Client-Secret": endpoint.cf_client_secret,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(url, json=action_payload, headers=headers)
        except httpx.RequestError as e:
            await record_action_failure(
                endpoint.id, action_payload,
                reason=f"network_error: {e}",
                timestamp=datetime.now(timezone.utc),
            )
            raise

    if resp.status_code == 200:
        await record_action_success(endpoint.id, action_payload, resp.json())
    elif resp.status_code == 403:
        await record_action_failure(
            endpoint.id, action_payload,
            reason="service_token_invalid_or_expired",
            timestamp=datetime.now(timezone.utc),
        )
    else:
        await record_action_failure(
            endpoint.id, action_payload,
            reason=f"http_{resp.status_code}: {resp.text}",
            timestamp=datetime.now(timezone.utc),
        )

    return resp
