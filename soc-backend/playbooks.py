import docker
import tempfile
import os
import logging
from pydantic import BaseModel
from typing import Dict, Any, List
from datetime import datetime
from contextlib import contextmanager

logger = logging.getLogger(__name__)

class Playbook(BaseModel):
    id: str
    name: str
    trigger: str
    code: str

from soc_sdk import IsolationTarget

# Mock Database for Playbooks
PLAYBOOKS_DB: Dict[str, Playbook] = {
    "pb-1": Playbook(
        id="pb-1",
        name="Auto-Isolate Malware",
        trigger="Malware_Detected",
        # Removed soc_sdk import. The container executes raw generic actions.
        # Strict validation happens OUTSIDE the container before it spins up.
        code="import sys\n\ndef run(target):\n    return f'[SUCCESS] Host {target} processed successfully in sandbox.'\n\nif __name__ == '__main__':\n    print(run(sys.argv[1]))"
    )
}

def get_all_playbooks() -> List[Playbook]:
    return list(PLAYBOOKS_DB.values())

class HardenedSandboxOrchestrator:
    """
    Thread-safe Docker container manager factory.
    Instantiates isolated, local connection pools per agent playbook run.
    """
    def __init__(self, proxy_url: str = "tcp://docker-proxy:2375"):
        # We explicitly rely on the DOCKER_HOST injection if available, otherwise fallback to proxy
        self.proxy_url = os.environ.get("DOCKER_HOST", proxy_url)

    @contextmanager
    def get_secure_client(self):
        client = None
        try:
            # Create a localized, thread-safe network socket engine reference
            client = docker.DockerClient(base_url=self.proxy_url, timeout=10)
            yield client
        finally:
            if client:
                client.close() # Always drain and recycle connection sockets immediately

orchestrator = HardenedSandboxOrchestrator()

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Step 6 of 6: The ultimate execution boundary of the SOAR pipeline.
#    - Upstream: AI Response Proposer Agent | Downstream: Ephemeral Docker Daemon
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Instantiates a secure, hardened, ephemeral container to execute untrusted
#      dynamic Python playbooks generated or selected by the AI agent.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Docker / Devops: Applies extreme Kernel constraints (cgroups, namespaces).
#      Enforces a 128MB RAM limit, read-only root filesystems, and strict PID
#      limits to prevent Fork-Bomb denial-of-service attacks.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Consumes payload strings natively. Does not rely on Protobuf schema.
#    - Interfaces with the local host's `/var/run/docker.sock` via the Docker proxy.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Container timeout or Kernel out-of-memory kill (OOMKilled)
#      will throw a `docker.errors.ContainerError`.
#    - Fallback State: Fail-Closed. Execution stops, but host integrity remains untouched.
# ==============================================================================
def execute_playbook_in_sandbox(playbook_id: str, context: dict) -> Dict[str, Any]:
    """
    Executes a Python playbook in an ephemeral Docker container securely.
    """
    playbook = PLAYBOOKS_DB.get(playbook_id)
    if not playbook:
        return {"status": "error", "message": "Playbook not found"}
        
    print(f"[SANDBOX EXECUTION] Preparing to run playbook '{playbook.name}' in restricted Docker container...")
    
    target_entity = context.get('target', 'unknown_target')
    
    # 0. STRICT OFFLINE VALIDATION (Pydantic execution outside the sandbox)
    try:
        validated_target = IsolationTarget(
            target_ip=target_entity,
            justification=context.get('justification', 'Automated containment payload verification'),
            risk_level="DESTRUCTIVE"
        )
        # Reassign to the sanitized string structure natively
        target_entity = str(validated_target.target_ip)
    except Exception as e:
        logger.error(f"[SDK] Pre-flight Sandbox validation failed: {e}")
        return {"status": "error", "message": f"Sandbox execution aborted due to invalid target constraint: {e}"}
    
    # 1. Write the dynamic playbook code to a secure temporary file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as temp_script:
        temp_script.write(playbook.code)
        temp_script_path = temp_script.name

    logs = []
    actions_taken = []
    status_result = "failed"
    
    try:
        logs.append(f"Triggered by context: {target_entity}")
        logs.append("Initializing ephemeral Docker container (playbook-sandbox:latest)...")
        
        # 2. Configure strict DevSecOps constraints (Cgroups and namespaces)
        container_args = {
            "image": "playbook-sandbox:latest",
            "command": ["python", "/sandbox/playbook.py", target_entity],
            "remove": True,                        
            "network_mode": "none",                
            "mem_limit": "128m",                   
            "nano_cpus": 500000000,                
            "user": "playbook_user",               
            
            # SECURITY CORRECTIONS (Prevents Host Kernel Fork-Bomb Denial of Service)
            "pids_limit": 50,                      
            "memsw_limit": "128m",                 
            "cap_drop": ["ALL"],                   
            "read_only": True,                     
            "security_opt": ["no-new-privileges:true"], # MANDATORY for Ubuntu 24.04 AppArmor
            
            # FIXED: Inject in-memory scratch space so read_only Python containers don't crash on bytecode generation
            "tmpfs": {"/tmp": "rw,size=16m", "/home/playbook_user/.cache": "rw,size=16m"},
            
            "volumes": {
                os.path.abspath(temp_script_path): {
                    "bind": "/sandbox/playbook.py", 
                    "mode": "ro"
                }
            }
        }
        
        # 3. Thread-safe execution using the factory context manager
        with orchestrator.get_secure_client() as client:
            # 3.1 Execute the container synchronously
            logs_bytes = client.containers.run(**container_args)
            
            stdout_text = logs_bytes.decode('utf-8').strip()
            logs.append(f"Container Output:\n{stdout_text}")
            actions_taken.append("Playbook executed successfully under strict isolation.")
            status_result = "success"
        
    except docker.errors.ContainerError as e:
        logs.append(f"Container Error:\n{e.stderr.decode('utf-8').strip()}")
    except Exception as e:
        logs.append(f"Sandbox execution failed: {e}")
        
    finally:
        # 4. Clean up host temp files
        if os.path.exists(temp_script_path):
            os.remove(temp_script_path)
            
    return {
        "status": status_result,
        "playbook_id": playbook.id,
        "execution_time": datetime.utcnow().isoformat(),
        "logs": logs,
        "actions_taken": actions_taken
    }
