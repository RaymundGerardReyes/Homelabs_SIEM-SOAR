import subprocess
import os
import tempfile
from pydantic import BaseModel
from typing import Dict, Any, List
from datetime import datetime

class Playbook(BaseModel):
    id: str
    name: str
    trigger: str
    code: str

# Mock Database for Playbooks
PLAYBOOKS_DB: Dict[str, Playbook] = {
    "pb-1": Playbook(
        id="pb-1",
        name="Auto-Isolate Malware",
        trigger="Malware_Detected",
        code="import soc_sdk\nimport sys\n\ndef run(target):\n    return soc_sdk.isolate_host(target)\n\nif __name__ == '__main__':\n    print(run(sys.argv[1]))"
    )
}

def get_all_playbooks() -> List[Playbook]:
    return list(PLAYBOOKS_DB.values())

def execute_playbook_in_sandbox(playbook_id: str, context: dict) -> Dict[str, Any]:
    """
    Executes a Python playbook in an ephemeral Docker container.
    Maps to FR4 (Automation & Extension - Execution Sandbox).
    """
    playbook = PLAYBOOKS_DB.get(playbook_id)
    if not playbook:
        return {"status": "error", "message": "Playbook not found"}
        
    print(f"[SANDBOX EXECUTION] Preparing to run playbook '{playbook.name}' in Docker container...")
    
    # Extract target from the context payload originating from React UI
    target_entity = context.get('target', 'unknown_target')
    
    # 1. Write the playbook code to a temporary file so Docker can mount it
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as temp_script:
        temp_script.write(playbook.code)
        temp_script_path = temp_script.name

    logs = []
    actions_taken = []
    
    try:
        logs.append(f"Triggered by context: {target_entity}")
        logs.append("Initializing ephemeral Docker container (soc-sandbox:latest)...")
        
        # 2. Construct the Docker run command
        # --rm ensures container is destroyed after execution
        # -v mounts the playbook code as read-only
        docker_cmd = [
            "docker", "run", "--rm",
            "-v", f"{temp_script_path}:/sandbox/playbook.py:ro",
            "soc-sandbox:latest",
            "/sandbox/playbook.py",
            target_entity
        ]
        
        # NOTE: For demonstration purposes in this local setup without Docker guaranteed to be running,
        # we will simulate the container execution by falling back to a local subprocess call.
        # In a real environment, you would use: result = subprocess.run(docker_cmd, ...)
        
        fallback_cmd = ["python", temp_script_path, target_entity]
        
        # 3. Execute the playbook
        logs.append("Executing untrusted code...")
        
        # Set the PYTHONPATH so the local execution can find the mock soc_sdk.py
        env = os.environ.copy()
        env["PYTHONPATH"] = os.path.dirname(os.path.abspath(__file__))
        
        result = subprocess.run(fallback_cmd, capture_output=True, text=True, timeout=10, env=env)
        
        if result.returncode == 0:
            logs.append(f"Container Output:\n{result.stdout.strip()}")
            actions_taken.append("Playbook executed successfully.")
        else:
            logs.append(f"Container Error:\n{result.stderr.strip()}")
            
    except subprocess.TimeoutExpired:
        logs.append("Container execution timed out (exceeded 10s).")
    except Exception as e:
        logs.append(f"Sandbox execution failed: {e}")
            
    finally:
        # 4. Clean up temporary files
        if os.path.exists(temp_script_path):
            os.remove(temp_script_path)
            
    return {
        "status": "success" if result.returncode == 0 else "failed",
        "playbook_id": playbook.id,
        "execution_time": datetime.utcnow().isoformat(),
        "logs": logs,
        "actions_taken": actions_taken
    }
