import tempfile
import os
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from contextlib import contextmanager

from domain.playbooks.registry import PLAYBOOKS_DB
from infra.llm.sdk import IsolationTarget

logger = logging.getLogger(__name__)

_docker_module: Optional[Any] = None
_docker_import_error: Optional[str] = None

def _get_docker():
    global _docker_module, _docker_import_error
    if _docker_module is not None:
        return _docker_module
    if _docker_import_error is not None:
        raise RuntimeError(_docker_import_error)
    try:
        import docker as _docker
        _docker_module = _docker
        return _docker_module
    except ImportError as exc:
        _docker_import_error = f"docker SDK not installed: {exc}"
        raise RuntimeError(_docker_import_error) from exc

class HardenedSandboxOrchestrator:
    def __init__(self, proxy_url: str = "tcp://docker-proxy:2375"):
        self.proxy_url = os.environ.get("DOCKER_HOST", proxy_url)

    @contextmanager
    def get_secure_client(self):
        docker = _get_docker()
        client = None
        try:
            client = docker.DockerClient(base_url=self.proxy_url, timeout=10)
            yield client
        finally:
            if client:
                client.close()

orchestrator = HardenedSandboxOrchestrator()

def execute_playbook_in_sandbox(playbook_id: str, context: dict) -> Dict[str, Any]:
    playbook = PLAYBOOKS_DB.get(playbook_id)
    if not playbook:
        return {"status": "error", "message": f"Playbook '{playbook_id}' not found."}

    target_entity = context.get("target", "unknown_target")

    try:
        validated_target = IsolationTarget(
            target_ip=target_entity,
            justification=context.get("justification", "Automated"),
            risk_level="DESTRUCTIVE",
        )
        target_entity = str(validated_target.target_ip)
    except Exception as exc:
        return {"status": "error", "message": f"Sandbox aborted: {exc}"}

    temp_script_path = None
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
        tmp.write(playbook.code)
        temp_script_path = tmp.name

    logs = [f"Target entity: {target_entity}"]
    actions_taken = []
    status_result = "failed"

    try:
        container_args = {
            "image": "playbook-sandbox:latest",
            "command": ["python", "/sandbox/playbook.py", target_entity],
            "remove": True,
            "network_mode": "none",
            "mem_limit": "128m",
            "nano_cpus": 500_000_000,
            "user": "playbook_user",
            "pids_limit": 50,
            "memsw_limit": "128m",
            "cap_drop": ["ALL"],
            "read_only": True,
            "security_opt": ["no-new-privileges:true"],
            "tmpfs": {"/tmp": "rw,size=16m", "/home/playbook_user/.cache": "rw,size=16m"},
            "volumes": {os.path.abspath(temp_script_path): {"bind": "/sandbox/playbook.py", "mode": "ro"}},
        }

        with orchestrator.get_secure_client() as client:
            logs_bytes = client.containers.run(**container_args)
            logs.append(f"Container output:\n{logs_bytes.decode('utf-8').strip()}")
            actions_taken.append("Playbook executed.")
            status_result = "success"

    except Exception as exc:
        logs.append(f"Sandbox error: {exc}")

    finally:
        if temp_script_path and os.path.exists(temp_script_path):
            os.remove(temp_script_path)

    return {
        "status": status_result,
        "playbook_id": playbook.id,
        "execution_time": datetime.now(timezone.utc).isoformat(),
        "logs": logs,
        "actions_taken": actions_taken,
    }

class PlaybookSandboxRunner:
    def __init__(self):
        self.client = None
        self._docker = None
        try:
            import docker as _docker
            self._docker = _docker
            self.client = _docker.from_env()
        except Exception as exc:
            logger.error(f"Failed to connect to Docker daemon: {exc}")

    def execute_script(self, playbook_code: str, target_args: list[str]) -> Dict[str, Any]:
        if not self.client:
            return {"status": "failed", "logs": "Docker daemon unavailable."}

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as temp_script:
            temp_script.write(playbook_code)
            temp_script_path = temp_script.name

        try:
            container_args = {
                "image": "playbook-sandbox:latest",
                "command": ["/sandbox/playbook.py"] + target_args,
                "remove": True,
                "network_mode": "bridge",
                "mem_limit": "128m",
                "memswap_limit": "128m",
                "nano_cpus": 500000000,
                "read_only": True,
                "security_opt": ["no-new-privileges:true"],
                "volumes": {os.path.abspath(temp_script_path): {"bind": "/sandbox/playbook.py", "mode": "ro"}}
            }
            
            logs_bytes = self.client.containers.run(**container_args)
            return {"status": "success", "logs": logs_bytes.decode('utf-8')}
        except Exception as exc:
            return {"status": "failed", "logs": str(exc)}
        finally:
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)
