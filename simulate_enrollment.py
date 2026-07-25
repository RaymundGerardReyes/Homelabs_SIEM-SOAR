import httpx
import time
import json
import sys

# NOTE: Run this script after making sure your Docker containers are running!
# `python simulate_enrollment.py`

BASE_URL = "http://localhost:8000" # Targeting the soc-backend directly for simulation

def run_simulation():
    print("\n🚀 [Step 1] Analyst generates a One-Time Enrollment Token from the UI...")
    try:
        # In reality, this route requires a valid analyst JWT, but we'll mock the call for simulation
        res = httpx.post(f"{BASE_URL}/api/endpoints/generate-enrollment-token")
        res.raise_for_status()
        token = res.json().get("token")
        print(f"✅ Successfully generated 15-minute token: {token}")
    except Exception as e:
        print(f"❌ Failed to generate token: {e}")
        print("Make sure soc-backend is running and accessible on port 8000.")
        sys.exit(1)

    time.sleep(2)
    print("\n💻 [Step 2] Remote Agent (Spoke) runs the bootstrap script with the token...")
    endpoint_payload = {
        "hostname": "mock-paas-agent-01",
        "label": "prod-api-worker",
        "type": "paas",
        "capabilities": ["block_user"],
        "agent_version": "1.0.0",
        "os": "Ubuntu 22.04",
        "region": "us-east-1"
    }
    
    try:
        res = httpx.post(
            f"{BASE_URL}/api/endpoints/enroll",
            json=endpoint_payload,
            headers={"X-Enrollment-Token": token}
        )
        res.raise_for_status()
        enrollment_data = res.json()
        print(f"✅ Successfully enrolled endpoint!")
        print(f"   Assigned Endpoint ID: {enrollment_data['endpoint_id']}")
        print(f"   CF_ACCESS_CLIENT_ID:  {enrollment_data['cf_client_id']}")
        print(f"   CF_ACCESS_CLIENT_SECRET: {enrollment_data['cf_client_secret'][:10]}... (hidden)")
    except Exception as e:
        print(f"❌ Failed to enroll endpoint: {e}")
        sys.exit(1)

    time.sleep(2)
    print("\n🛡️  [Step 3] Verifying the Endpoint exists in the Hub Inventory (Without exposing the secret)...")
    try:
        res = httpx.get(f"{BASE_URL}/endpoints/hosts")
        res.raise_for_status()
        hosts = res.json()
        
        found = False
        for host in hosts:
            if host["id"] == enrollment_data['endpoint_id']:
                found = True
                print(f"✅ Found newly enrolled endpoint in inventory!")
                print(f"   Hostname: {host['hostname']}")
                print(f"   Type: {host['type']}")
                print(f"   Secret Exposed?: {'Yes (VULNERABILITY!)' if 'cf_client_secret' in host else 'No (Secure)'}")
        
        if not found:
            print("❌ Could not find the endpoint in the inventory.")
            
    except Exception as e:
        print(f"❌ Failed to fetch inventory: {e}")

    print("\n🎉 Simulation Complete! The Zero-Trust bootstrap flow works perfectly.")

if __name__ == "__main__":
    run_simulation()
