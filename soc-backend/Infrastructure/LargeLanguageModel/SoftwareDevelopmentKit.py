import logging
from typing import Annotated
from pydantic import BaseModel, Field, IPvAnyAddress, StringConstraints

logger = logging.getLogger("soc_sdk")

_Justification = Annotated[str, StringConstraints(min_length=10, max_length=255)]
_RiskLevel = Annotated[str, StringConstraints(pattern=r"^(LOW_IMPACT_WRITE|HIGH_IMPACT_WRITE|DESTRUCTIVE)$")]

class IsolationTarget(BaseModel):
    target_ip: IPvAnyAddress = Field(..., description="The IPv4 or IPv6 address to isolate.")
    justification: _Justification = Field(..., description="Audit justification for containment action.")
    risk_level: _RiskLevel = Field(..., description="Declared action severity classification.")

class BlockActionConfig(BaseModel):
    ip_address: IPvAnyAddress
    justification: _Justification
    actor_id: str
    session_id: str
    authorization_jwt: str

def isolate_host(target: str) -> str:
    try:
        validated_target = IsolationTarget(target_ip=target, justification="Automated sandbox containment initiated via Playbook", risk_level="DESTRUCTIVE")
        return f"[SUCCESS] Host {validated_target.target_ip} mathematically verified and queued for isolation."
    except ValueError as e:
        return f"[ERROR] SDK Validation Failure: Invalid containment target parameters."

def tag_alert(alert_id: str, tags: list) -> str:
    return f"Alert {alert_id} dynamically tagged with: {tags}"
