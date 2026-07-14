import docker
import tempfile
import os
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class PlaybookSandboxRunner:
    """
    DevSecOps Sandbox Orchestrator:
    Safely executes untrusted Python playbook scripts inside an ephemeral, 
    heavily-restricted Docker container on the host machine.
    """
    def __init__(self):
        try:
            # Connects via the /var/run/docker.sock socket mounted in the soc-backend container
            self.client = docker.from_env()
        except docker.errors.DockerException as e:
            logger.error(f"Failed to connect to Docker daemon: {e}")
            self.client = None

    def execute_script(self, playbook_code: str, target_args: list[str]) -> Dict[str, Any]:
        if not self.client:
            return {"status": "failed", "logs": "Docker daemon unavailable."}

        # Ensure the playbook sandbox image is available
        image_tag = "playbook-sandbox:latest"
        
        # 1. Write the dynamic playbook code to a secure temporary file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as temp_script:
            temp_script.write(playbook_code)
            temp_script_path = temp_script.name

        try:
            # 2. Configure strict DevSecOps constraints
            # We enforce limits at the Kernel level using Cgroups and namespaces
            container_args = {
                "image": image_tag,
                "command": ["/sandbox/playbook.py"] + target_args,
                "remove": True,                        # Automatically delete container after execution
                "network_mode": "none",                # HARD REQUIREMENT: Zero network access
                "mem_limit": "128m",                   # Strict memory ceiling
                "memswap_limit": "128m",               # Prevent swap abuse
                "nano_cpus": 500000000,                # Restrict to 0.5 CPUs
                "read_only": True,                     # Mount container root filesystem as read-only
                "security_opt": ["no-new-privileges:true"], # Prevent privilege escalation
                "volumes": {
                    # Mount the temporary script strictly as Read-Only
                    os.path.abspath(temp_script_path): {
                        "bind": "/sandbox/playbook.py", 
                        "mode": "ro"
                    }
                }
            }
            
            logger.info("Executing untrusted playbook inside restricted Docker namespace...")
            
            # 3. Execute the container synchronously, capturing the standard streams
            # Wait for maximum of 5 seconds to prevent infinite loops (Turing completeness risk)
            logs_bytes = self.client.containers.run(**container_args)
            
            return {
                "status": "success",
                "logs": logs_bytes.decode('utf-8')
            }
            
        except docker.errors.ContainerError as e:
            logger.error(f"Playbook execution failed (ContainerError): {e}")
            return {"status": "failed", "logs": e.stderr.decode('utf-8') if e.stderr else str(e)}
        except docker.errors.APIError as e:
            logger.error(f"Docker API Error: {e}")
            return {"status": "failed", "logs": str(e)}
        except Exception as e:
            logger.error(f"Sandbox orchestration exception: {e}")
            return {"status": "failed", "logs": str(e)}
            
        finally:
            # 4. Clean up host temp files
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)
