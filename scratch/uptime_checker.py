# uptime_checker.py
import requests
import time
import csv
from datetime import datetime, timezone

URL = "https://socanalyst.raymundgerardestaca.dev/health"
LOG_FILE = "uptime_log.csv"

def main():
    print(f"Starting synthetic monitoring against {URL}")
    with open(LOG_FILE, mode="a", newline="") as file:
        writer = csv.writer(file)
        # Write header if file is empty
        file.seek(0, 2)
        if file.tell() == 0:
            writer.writerow(["Timestamp", "StatusCode", "Latency_ms", "Error"])

    while True:
        timestamp = datetime.now(timezone.utc).isoformat()
        try:
            start_time = time.time()
            response = requests.get(URL, timeout=10)
            latency = int((time.time() - start_time) * 1000)
            
            with open(LOG_FILE, mode="a", newline="") as file:
                writer = csv.writer(file)
                writer.writerow([timestamp, response.status_code, latency, ""])
                
            if response.status_code == 502:
                print(f"[{timestamp}] 🚨 502 BAD GATEWAY DETECTED! Latency: {latency}ms")
            else:
                print(f"[{timestamp}] OK {response.status_code} - {latency}ms")
                
        except requests.exceptions.RequestException as e:
            with open(LOG_FILE, mode="a", newline="") as file:
                writer = csv.writer(file)
                writer.writerow([timestamp, "ERROR", "", str(e)])
            print(f"[{timestamp}] ❌ ERROR: {e}")
            
        time.sleep(10)

if __name__ == "__main__":
    main()
