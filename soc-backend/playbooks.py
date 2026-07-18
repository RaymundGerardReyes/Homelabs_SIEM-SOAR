# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Step 6 of 6: The ultimate execution boundary of the SOAR pipeline.
#    - Upstream: API Routes → execute_playbook_in_sandbox()
#    - Downstream: Ephemeral Docker container via /var/run/docker.sock proxy
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Manages the playbook registry and executes sandboxed Python code inside
#      ephemeral, heavily-constrained Docker containers.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - LAZY DOCKER IMPORT: `import docker` is deferred to execute-time, NOT at
#      module load. This allows Uvicorn to boot cleanly even if the docker SDK
#      is absent or the daemon is unreachable. The error surfaces only when
#      a playbook execution is actually requested, not on startup.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - `get_all_playbooks()` → consumed by GET /api/data/playbooks
#    - `execute_playbook_in_sandbox()` → consumed by POST /api/data/playbooks/:id/run
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: docker SDK not installed → ImportError caught, returns 503 payload.
#    - Failure Mode: Docker daemon offline → DockerException caught, returns error dict.
#    - Failure Mode: Container OOMKilled / timeout → ContainerError caught gracefully.
#    - Fail-Closed: All sandbox failures leave the host system untouched.
# ==============================================================================
import tempfile
import os
import logging
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# ─── Sentinel for lazy docker import ─────────────────────────────────────────
# docker SDK is imported lazily inside functions so that a missing package does
# NOT crash the entire FastAPI process during `uvicorn main:app` startup.
_docker_module: Optional[Any] = None
_docker_import_error: Optional[str] = None

def _get_docker():
    """Lazily imports the docker SDK. Returns the module or raises RuntimeError."""
    global _docker_module, _docker_import_error
    if _docker_module is not None:
        return _docker_module
    if _docker_import_error is not None:
        raise RuntimeError(_docker_import_error)
    try:
        import docker as _docker
        _docker_module = _docker
        logger.info("[Playbooks] docker SDK loaded successfully.")
        return _docker_module
    except ImportError as exc:
        _docker_import_error = (
            f"Python docker SDK is not installed: {exc}. "
            "Add `docker>=7.0.0` to requirements.txt and rebuild the image."
        )
        logger.error(f"[Playbooks] {_docker_import_error}")
        raise RuntimeError(_docker_import_error) from exc

# ─────────────────────────────────────────────────────────────────────────────

from soc_sdk import IsolationTarget


class Playbook(BaseModel):
    id: str
    name: str
    trigger: str
    code: str


# ─── Playbook Registry ────────────────────────────────────────────────────────
PLAYBOOKS_DB: Dict[str, Playbook] = {
    "pb-1": Playbook(
        id="pb-1",
        name="Auto-Isolate Malware",
        trigger="Malware_Detected",
        # Sandboxed code runs generic actions inside the container.
        # Strict validation (IsolationTarget) happens OUTSIDE before the container spawns.
        code=(
            "import sys\n\n"
            "def run(target):\n"
            "    return f'[SUCCESS] Host {target} processed successfully in sandbox.'\n\n"
            "if __name__ == '__main__':\n"
            "    print(run(sys.argv[1]))\n"
        )
    ),
    "pb-2": Playbook(
        id="pb-2",
        name="Block Malicious IP",
        trigger="C2_Beacon_Detected",
        code=(
            "import sys\n\n"
            "def run(target):\n"
            "    return f'[SUCCESS] IP {target} added to block-list.'\n\n"
            "if __name__ == '__main__':\n"
            "    print(run(sys.argv[1]))\n"
        )
    ),
}


def get_all_playbooks() -> List[Playbook]:
    return list(PLAYBOOKS_DB.values())


# ─── Sandbox Orchestrator ─────────────────────────────────────────────────────

class HardenedSandboxOrchestrator:
    """
    Thread-safe Docker container manager factory.
    Instantiates isolated, local connection pools per agent playbook run.
    The Docker SDK is imported lazily — if unavailable, `get_secure_client()`
    raises a RuntimeError that is caught by `execute_playbook_in_sandbox()`.
    """
    def __init__(self, proxy_url: str = "tcp://docker-proxy:2375"):
        self.proxy_url = os.environ.get("DOCKER_HOST", proxy_url)

    @contextmanager
    def get_secure_client(self):
        """
        Context manager yielding a thread-local DockerClient.
        Always closes the connection in the `finally` block to recycle sockets.
        """
        docker = _get_docker()  # Raises RuntimeError if SDK missing
        client = None
        try:
            client = docker.DockerClient(base_url=self.proxy_url, timeout=10)
            yield client
        finally:
            if client:
                client.close()


# Module-level singleton — safe because __init__ does NOT import docker
orchestrator = HardenedSandboxOrchestrator()


# ─── Core Execution Function ──────────────────────────────────────────────────

def execute_playbook_in_sandbox(playbook_id: str, context: dict) -> Dict[str, Any]:
    """
    Executes a Python playbook inside an ephemeral, hardened Docker container.

    Returns a structured result dict. Never raises — all failure modes are
    captured and returned as `{"status": "error" | "failed", ...}`.
    """
    playbook = PLAYBOOKS_DB.get(playbook_id)
    if not playbook:
        return {"status": "error", "message": f"Playbook '{playbook_id}' not found in registry."}

    logger.info(f"[SANDBOX] Preparing playbook '{playbook.name}' (id={playbook_id})…")

    target_entity = context.get("target", "unknown_target")

    # ── 0. Pre-flight Pydantic validation (runs OUTSIDE the container) ───────
    try:
        validated_target = IsolationTarget(
            target_ip=target_entity,
            justification=context.get("justification", "Automated containment payload verification"),
            risk_level="DESTRUCTIVE",
        )
        target_entity = str(validated_target.target_ip)
    except Exception as exc:
        logger.error(f"[SDK] Pre-flight validation failed: {exc}")
        return {
            "status": "error",
            "message": f"Sandbox aborted — invalid target constraint: {exc}",
        }

    # ── 1. Write playbook code to a secure temporary file ────────────────────
    temp_script_path: Optional[str] = None
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
        tmp.write(playbook.code)
        temp_script_path = tmp.name

    logs: List[str] = [f"Target entity: {target_entity}"]
    actions_taken: List[str] = []
    status_result = "failed"

    try:
        logs.append("Initialising ephemeral Docker container (playbook-sandbox:latest)…")

        # ── 2. DevSecOps-hardened container configuration ─────────────────────
        container_args = {
            "image":        "playbook-sandbox:latest",
            "command":      ["python", "/sandbox/playbook.py", target_entity],
            "remove":       True,           # Auto-delete container after exit
            "network_mode": "none",         # No egress — air-gapped execution
            "mem_limit":    "128m",
            "nano_cpus":    500_000_000,    # 0.5 vCPUs
            "user":         "playbook_user",
            "pids_limit":   50,             # Prevent fork-bomb DoS
            "memsw_limit":  "128m",         # Prevent swap abuse
            "cap_drop":     ["ALL"],        # Drop all Linux capabilities
            "read_only":    True,
            "security_opt": ["no-new-privileges:true"],
            # Scratch space so read-only Python containers can write .pyc bytecode
            "tmpfs": {
                "/tmp":                          "rw,size=16m",
                "/home/playbook_user/.cache":    "rw,size=16m",
            },
            "volumes": {
                os.path.abspath(temp_script_path): {
                    "bind": "/sandbox/playbook.py",
                    "mode": "ro",
                }
            },
        }

        # ── 3. Thread-safe execution via factory context manager ──────────────
        with orchestrator.get_secure_client() as client:
            logs_bytes: bytes = client.containers.run(**container_args)
            stdout_text = logs_bytes.decode("utf-8").strip()
            logs.append(f"Container output:\n{stdout_text}")
            actions_taken.append("Playbook executed successfully under strict isolation.")
            status_result = "success"

    except RuntimeError as exc:
        # Docker SDK missing or daemon unreachable — surface a clear 503-style payload
        logger.error(f"[SANDBOX] Docker unavailable: {exc}")
        logs.append(f"Sandbox unavailable: {exc}")

    except Exception as exc:
        # Try to import docker errors for specific handling
        try:
            docker = _get_docker()
            if isinstance(exc, docker.errors.ContainerError):
                stderr = exc.stderr.decode("utf-8").strip() if exc.stderr else str(exc)
                logs.append(f"Container error (non-zero exit):\n{stderr}")
                logger.error(f"[SANDBOX] ContainerError: {stderr}")
            elif isinstance(exc, docker.errors.ImageNotFound):
                logs.append(
                    "Sandbox image 'playbook-sandbox:latest' not found. "
                    "Run: docker build -f soc-backend/Dockerfile.sandbox -t playbook-sandbox:latest ."
                )
                logger.error("[SANDBOX] Image not found.")
            elif isinstance(exc, docker.errors.APIError):
                logs.append(f"Docker API error: {exc}")
                logger.error(f"[SANDBOX] Docker API error: {exc}")
            else:
                logs.append(f"Unexpected sandbox error: {exc}")
                logger.exception("[SANDBOX] Unexpected error.")
        except RuntimeError:
            # SDK itself is unavailable — already logged above
            logs.append(f"Unexpected error: {exc}")

    finally:
        # ── 4. Always clean up the host temp file ─────────────────────────────
        if temp_script_path and os.path.exists(temp_script_path):
            os.remove(temp_script_path)

    return {
        "status":         status_result,
        "playbook_id":    playbook.id,
        "execution_time": datetime.now(timezone.utc).isoformat(),
        "logs":           logs,
        "actions_taken":  actions_taken,
    }
