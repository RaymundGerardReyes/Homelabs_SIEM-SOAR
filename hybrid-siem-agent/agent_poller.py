import os
import time
import requests
import logging
import json
import subprocess
import threading
from datetime import datetime
import uvicorn
from fastapi import FastAPI, Request

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("agent-poller")

HUB_BASE_URL = os.getenv("HUB_BASE_URL", "http://localhost:8000")
ENROLLMENT_TOKEN = os.getenv("TENANT_ENROLLMENT_TOKEN", "")
ENDPOINT_SECRET = os.getenv("ENDPOINT_SECRET", "")  # Or populated by enrollment
ENDPOINT_ID = ""
TENANT_ID = ""
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))
WEBHOOK_PORT = int(os.getenv("WEBHOOK_PORT", "0"))
HOSTNAME = os.getenv("HOSTNAME", "agent-host")
ENDPOINT_TYPE = os.getenv("ENDPOINT_TYPE", "iaas")


def execute_task(task):
    """
    Executes a task assigned by the Control Plane.
    """
    action = task.get("action")
    params = task.get("params", {})
    task_id = task.get("task_id")
    
    logger.info(f"Executing task: {task_id} - Action: {action}")
    
    try:
        if action in ("isolate_host", "isolate_lan_client"):
            target_ip = params.get("target_ip") or params.get("target", "192.168.1.105")
            logger.warning(f"ISOLATING LAN CLIENT {target_ip} VIA ARP QUARANTINE")
            # In a live production environment:
            # subprocess.run(["arpspoof", "-i", "eth0", "-t", target_ip, "192.168.1.1"], check=False)
            # Or Windows: netsh advfirewall firewall add rule name="Block_LAN" dir=in action=block remoteip=target_ip
            return {
                "status": "success",
                "details": {
                    "msg": f"Host {target_ip} quarantined on local WiFi 6 subnet",
                    "target": target_ip,
                    "mechanism": "ARP_LAYER2_ISOLATION",
                    "router_gateway": "192.168.1.1"
                }
            }
            
        elif action in ("release_host", "release_lan_client"):
            target_ip = params.get("target_ip") or params.get("target", "192.168.1.105")
            logger.info(f"Releasing LAN client {target_ip} from quarantine")
            return {"status": "success", "details": {"msg": f"Host {target_ip} released", "target": target_ip}}

        elif action == "query_lan_devices":
            logger.info("Scanning local WiFi 6 LAN devices from ARP cache")
            # Simulates reading local ARP table on WiFi 6 subnet
            return {
                "status": "success",
                "details": {
                    "gateway": "192.168.1.1",
                    "devices": [
                        {"ip": "192.168.1.1", "mac": "00:11:22:33:44:01", "role": "WiFi 6 Gateway / AP"},
                        {"ip": "192.168.1.105", "mac": "34:2e:b7:aa:bb:cc", "role": "WiFi 6 802.11ax Client (Station)"},
                        {"ip": "192.168.1.50", "mac": "52:54:00:12:34:56", "role": "Local Gateway Bridge"}
                    ]
                }
            }

        elif action == "maintenance_mode":
            logger.info("Setting maintenance mode (Simulated)")
            return {"status": "success", "details": {"msg": "Maintenance mode activated"}}
            
        elif action == "test_alert":
            logger.info("Triggering test alert (Simulated)")
            return {"status": "success", "details": {"msg": "Test alert triggered locally"}}
            
        elif action == "collect_diagnostics":
            logger.info("Collecting diagnostics (Simulated)")
            return {"status": "success", "details": {"cpu_usage": "45%", "memory_usage": "62%"}}

        # ==============================================================================
        # PHASE 5: SOAR RESPONSE ACTIONS — Docker Container Containment
        # All container actions are DESTRUCTIVE and must arrive via two-key approved task.
        # PolicyGovernanceSubagent validates the twoKeyToken before dispatch.
        # ==============================================================================
        elif action == "throttle_container_network":
            container_id = params.get("container_id") or params.get("target", "")
            rate_kbps = params.get("rate_kbps", 512)  # Default: throttle to 512 Kbps
            if not container_id:
                return {"status": "failed", "details": {"error": "Missing container_id parameter"}}
            logger.warning(f"THROTTLING CONTAINER NETWORK: {container_id} -> {rate_kbps} Kbps")
            # Production (Linux tc on Docker host):
            # subprocess.run([
            #     "docker", "exec", container_id,
            #     "tc", "qdisc", "add", "dev", "eth0", "root", "tbf",
            #     "rate", f"{rate_kbps}kbit", "burst", "32kbit", "latency", "400ms"
            # ], check=False)
            return {
                "status": "success",
                "details": {
                    "msg": f"Container {container_id} network throttled to {rate_kbps} Kbps",
                    "container_id": container_id,
                    "mechanism": "TC_TOKEN_BUCKET_FILTER",
                    "rate_kbps": rate_kbps,
                }
            }

        elif action == "pause_container":
            container_id = params.get("container_id") or params.get("target", "")
            if not container_id:
                return {"status": "failed", "details": {"error": "Missing container_id parameter"}}
            logger.warning(f"PAUSING CONTAINER: {container_id}")
            # Production: subprocess.run(["docker", "pause", container_id], check=False)
            return {
                "status": "success",
                "details": {
                    "msg": f"Container {container_id} paused (all processes suspended)",
                    "container_id": container_id,
                    "mechanism": "DOCKER_PAUSE_CGROUP_FREEZE",
                }
            }

        elif action == "resume_container":
            container_id = params.get("container_id") or params.get("target", "")
            if not container_id:
                return {"status": "failed", "details": {"error": "Missing container_id parameter"}}
            logger.info(f"Resuming container: {container_id}")
            # Production: subprocess.run(["docker", "unpause", container_id], check=False)
            return {
                "status": "success",
                "details": {
                    "msg": f"Container {container_id} resumed",
                    "container_id": container_id,
                }
            }

        # ==============================================================================
        # PHASE 1: ENDPOINT TELEMETRY COLLECTION ACTIONS
        # Instructs the agent to push a process/network snapshot for detection pipeline.
        # ==============================================================================
        elif action == "collect_endpoint_process_telemetry":
            logger.info("Collecting endpoint process telemetry snapshot")
            import platform
            proc_snapshot = [
                {
                    "pid": 1234,
                    "process_name": "chrome.exe",
                    "parent_process_name": "explorer.exe",
                    "command_line": "chrome.exe --profile-directory=Default",
                    "cpu_pct": 2.5,
                    "mem_rss_bytes": 204800000,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
            ]
            return {
                "status": "success",
                "details": {
                    "msg": f"Process telemetry snapshot collected ({len(proc_snapshot)} processes)",
                    "platform": platform.system(),
                    "processes": proc_snapshot,
                }
            }

        elif action == "collect_endpoint_flow_telemetry":
            logger.info("Collecting endpoint active network flow telemetry snapshot")
            flow_snapshot = [
                {
                    "pid": 1234,
                    "process_name": "chrome.exe",
                    "source_ip": "192.168.1.105",
                    "destination_ip": "142.250.80.14",
                    "destination_port": 443,
                    "protocol": "TCP",
                    "bytes_out": 10240,
                    "bytes_in": 512000,
                    "domain": "google.com",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
            ]
            return {
                "status": "success",
                "details": {
                    "msg": f"Flow telemetry snapshot collected ({len(flow_snapshot)} flows)",
                    "flows": flow_snapshot,
                }
            }

        else:
            logger.error(f"Unknown action: {action}")
            return {"status": "failed", "details": {"error": f"Unknown action: {action}"}}
            
    except Exception as e:
        logger.error(f"Error executing task {task_id}: {e}")
        return {"status": "failed", "details": {"error": str(e)}}

def submit_result(task_id, result):
    """
    Submits the task result back to the Control Plane.
    """
    url = f"{HUB_BASE_URL}/api/agents/tasks/{task_id}/result"
    headers = {"Authorization": f"Bearer {ENDPOINT_SECRET}"}
    
    try:
        resp = requests.post(url, headers=headers, json=result)
        resp.raise_for_status()
        logger.info(f"Successfully submitted result for task {task_id}")
    except Exception as e:
        logger.error(f"Failed to submit result for task {task_id}: {e}")

# ==============================================================================
# PHASE 2: IDENTITY ENROLLMENT & REGISTRATION
# ==============================================================================

def enroll_and_register():
    global ENDPOINT_ID, ENDPOINT_SECRET, TENANT_ID
    
    if not ENROLLMENT_TOKEN:
        logger.error("Missing TENANT_ENROLLMENT_TOKEN")
        return False
        
    try:
        # 1. Enroll
        logger.info("Starting Phase 1: Identity Enrollment...")
        enroll_url = f"{HUB_BASE_URL}/api/endpoints/enroll"
        enroll_resp = requests.post(enroll_url, json={"enrollment_token": ENROLLMENT_TOKEN})
        enroll_resp.raise_for_status()
        
        enroll_data = enroll_resp.json()
        ENDPOINT_ID = enroll_data["endpoint_id"]
        ENDPOINT_SECRET = enroll_data["endpoint_secret"]
        TENANT_ID = enroll_data["tenant_id"]
        logger.info(f"Enrolled successfully. Endpoint ID: {ENDPOINT_ID}")
        
        # 2. Register
        logger.info("Starting Phase 2: Metadata Registration...")
        register_url = f"{HUB_BASE_URL}/api/endpoints/register"
        headers = {"Authorization": f"Bearer {ENDPOINT_SECRET}"}
        
        tunnel_url = f"https://{ENDPOINT_ID}.socanalyst.raymundgerardestaca.dev" if WEBHOOK_PORT > 0 else None
        
        register_payload = {
            "hostname": HOSTNAME,
            "label": f"{ENDPOINT_TYPE}-{HOSTNAME}",
            "type": ENDPOINT_TYPE,
            "cf_tunnel_url": tunnel_url,
            "capabilities": ["can_execute_docker", "has_agent_v1"],
            "agent_version": "1.0.0",
            "os": "linux",
            "region": "us-east-1"
        }
        
        reg_resp = requests.post(register_url, headers=headers, json=register_payload)
        reg_resp.raise_for_status()
        logger.info("Registration complete.")
        return True
        
    except Exception as e:
        logger.error(f"Enrollment/Registration failed: {e}")
        return False

def generate_and_start_fluentbit():
    """Generates fluent-bit.conf and spawns the daemon."""
    logger.info("Generating Fluent Bit configuration...")
    try:
        with open("fluent-bit.conf.template", "r") as f:
            template = f.read()
            
        hub_domain = HUB_BASE_URL.replace("http://", "").replace("https://", "").split(":")[0]
            
        conf = template.replace("${ENDPOINT_ID}", ENDPOINT_ID)
        conf = conf.replace("${TENANT_ID}", TENANT_ID)
        conf = conf.replace("${ENDPOINT_SECRET}", ENDPOINT_SECRET)
        conf = conf.replace("${HUB_DOMAIN}", hub_domain)
        
        with open("fluent-bit.conf", "w") as f:
            f.write(conf)
            
        logger.info("Starting Fluent Bit log shipper...")
        # In a real container, we'd spawn this via subprocess and monitor it
        # subprocess.Popen(["/opt/fluent-bit/bin/fluent-bit", "-c", "fluent-bit.conf"])
        logger.info("[Mock] Fluent Bit daemon started successfully.")
    except Exception as e:
        logger.error(f"Failed to start Fluent Bit: {e}")

# ==============================================================================
# PHASE 3: POLLING CONTROL PLANE
# ==============================================================================
def poll_for_tasks():
    """
    Polls the Control Plane for pending tasks.
    """
    url = f"{HUB_BASE_URL}/api/agents/tasks"
    headers = {"Authorization": f"Bearer {ENDPOINT_SECRET}"}
    
    try:
        resp = requests.get(url, headers=headers)
        if resp.status_code == 401:
            logger.error("Authentication failed. Endpoint secret may be invalid or revoked.")
            time.sleep(30) # Backoff
            return
            
        resp.raise_for_status()
        tasks = resp.json()
        
        if not tasks:
            logger.debug("No pending tasks.")
            return
            
        logger.info(f"Received {len(tasks)} pending tasks.")
        
        for task in tasks:
            result = execute_task(task)
            submit_result(task.get("task_id"), result)
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Connection error while polling for tasks: {e}")

def emit_router_heartbeat_summary():
    """
    Periodically emits summary heartbeat events about router state:
    - Connected client count.
    - Total bytes in/out per interval.
    - Top N domains by traffic.
    Pushes to /api/v1/agent/push under the existing endpoint identity.
    """
    if not ENDPOINT_ID or not ENDPOINT_SECRET:
        return

    summary_payload = {
        "client_id": HOSTNAME,
        "endpoint_id": ENDPOINT_ID,
        "endpoint_type": ENDPOINT_TYPE,
        "event_type": "router_heartbeat_summary",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "raw_data": {
            "connected_client_count": 8,
            "bytes_in": 10485760,
            "bytes_out": 4194304,
            "router_gateway": "192.168.1.1",
            "top_domains": [
                {"domain": "google.com", "hits": 142, "bytes": 2048000},
                {"domain": "cloudflare.com", "hits": 98, "bytes": 1024000},
                {"domain": "github.com", "hits": 45, "bytes": 512000},
                {"domain": "c2-malicious.org", "hits": 12, "bytes": 64000}
            ]
        }
    }

    url = f"{HUB_BASE_URL}/api/v1/agent/push"
    headers = {
        "Authorization": f"Bearer {ENDPOINT_SECRET}",
        "X-Tenant-ID": TENANT_ID,
        "X-Agent-Type": ENDPOINT_TYPE,
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post(url, headers=headers, json=summary_payload, timeout=5)
        if resp.status_code in (200, 202):
            logger.info("Router heartbeat summary emitted successfully.")
        else:
            logger.debug(f"Router heartbeat response: {resp.status_code}")
    except Exception as e:
        logger.debug(f"Router heartbeat emission skipped: {e}")

# ==============================================================================
# PHASE 4: OPTIONAL WEBHOOK LISTENER
# ==============================================================================
app = FastAPI()

@app.post("/agent/execute")
async def handle_webhook_execute(request: Request):
    """
    Synchronous execution endpoint exposed via Cloudflare Tunnel.
    """
    try:
        task = await request.json()
        logger.info(f"Received urgent Webhook task: {task.get('task_id')}")
        
        # Execute synchronously
        result = execute_task(task)
        
        # Return the result immediately to the Hub
        return result
        
    except Exception as e:
        logger.error(f"Webhook execution error: {e}")
        return {"status": "failed", "details": {"error": str(e)}}

def start_webhook_server():
    logger.info(f"Starting optional Webhook listener on port {WEBHOOK_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=WEBHOOK_PORT, log_level="info")

# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================
def main():
    logger.info(f"Agent Fabric Sidecar starting up. Hub: {HUB_BASE_URL}")
    
    # Execute Phase 1 & 2 Bootstrap
    if not enroll_and_register():
        logger.error("Fatal: Identity bootstrap failed.")
        return
        
    generate_and_start_fluentbit()
    
    if WEBHOOK_PORT > 0:
        # Start webhook server in a background thread
        webhook_thread = threading.Thread(target=start_webhook_server, daemon=True)
        webhook_thread.start()
    
    # Enter Phase 3 Polling Loop with periodic heartbeat
    last_heartbeat = 0
    HEARTBEAT_INTERVAL = 60 # 60 seconds

    while True:
        now = time.time()
        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            emit_router_heartbeat_summary()
            last_heartbeat = now

        poll_for_tasks()
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
