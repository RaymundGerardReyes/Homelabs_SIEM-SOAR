import requests
import time
import csv
import sys
import os
import urllib3
from datetime import datetime, timezone

# Suppress insecure request warnings if testing against self-signed local IPs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

URL = os.getenv("CHECK_URL", "http://localhost:81/health")

LOG_FILE = os.getenv("LOG_FILE", "uptime_log.csv")
INTERVAL_SEC = int(os.getenv("CHECK_INTERVAL", "10"))

class UptimeMonitor:
    def __init__(self):
        self.stats = {
            "total": 0,
            "success": 0,
            "timeout": 0,
            "gateway_error": 0,
            "connection_error": 0,
            "other_error": 0
        }
        self.latencies = []
        self.start_time = datetime.now(timezone.utc)
        self._init_csv()

    def _init_csv(self):
        with open(LOG_FILE, mode="a", newline="") as file:
            writer = csv.writer(file)
            file.seek(0, 2)
            if file.tell() == 0:
                writer.writerow(["Timestamp", "StatusCode", "Latency_ms", "ErrorType", "ErrorDetail"])

    def _log_csv(self, status, latency, error_type="", error_detail=""):
        timestamp = datetime.now(timezone.utc).isoformat()
        with open(LOG_FILE, mode="a", newline="") as file:
            writer = csv.writer(file)
            writer.writerow([timestamp, status, latency, error_type, error_detail])

    def print_summary(self):
        uptime = (self.stats["success"] / self.stats["total"]) * 100 if self.stats["total"] > 0 else 0
        avg_latency = sum(self.latencies) / len(self.latencies) if self.latencies else 0
        duration = datetime.now(timezone.utc) - self.start_time
        
        print("\n" + "="*50)
        print(f"📊 UPTIME MONITORING SUMMARY")
        print("="*50)
        print(f"Target URL     : {URL}")
        print(f"Duration       : {duration}")
        print(f"Total Requests : {self.stats['total']}")
        print(f"Uptime Ratio   : {uptime:.2f}%")
        print(f"Avg Latency    : {avg_latency:.1f}ms")
        print("-" * 50)
        print(f"✅ Success (2xx)    : {self.stats['success']}")
        print(f"🚨 Gateway (5xx)    : {self.stats['gateway_error']}")
        print(f"⏱️  Timeouts         : {self.stats['timeout']}")
        print(f"🔌 Connection Drops : {self.stats['connection_error']}")
        print(f"❌ Other Errors     : {self.stats['other_error']}")
        print("="*50 + "\n")

    def run(self):
        print(f"🚀 Starting SRE Synthetic Monitor...")
        print(f"🎯 Target  : {URL}")
        print(f"⏱️  Interval: {INTERVAL_SEC}s")
        print(f"Press Ctrl+C to stop and view the final summary.\n")

        try:
            while True:
                self.stats["total"] += 1
                timestamp = datetime.now(timezone.utc).isoformat()
                req_start = time.time()
                
                try:
                    response = requests.get(URL, timeout=10, verify=False)
                    latency = int((time.time() - req_start) * 1000)
                    self.latencies.append(latency)

                    if response.status_code == 502 or response.status_code == 504:
                        self.stats["gateway_error"] += 1
                        self._log_csv(response.status_code, latency, "GatewayError")
                        print(f"[{timestamp}] 🚨 {response.status_code} GATEWAY ERROR! Latency: {latency}ms")
                    elif 200 <= response.status_code < 400:
                        self.stats["success"] += 1
                        self._log_csv(response.status_code, latency)
                        print(f"[{timestamp}] ✅ OK {response.status_code} - {latency}ms")
                    else:
                        self.stats["other_error"] += 1
                        self._log_csv(response.status_code, latency, "HTTPError")
                        print(f"[{timestamp}] ⚠️ HTTP {response.status_code} - {latency}ms")
                        
                except requests.exceptions.Timeout as e:
                    self.stats["timeout"] += 1
                    self._log_csv("TIMEOUT", "", "TimeoutError", str(e))
                    print(f"[{timestamp}] ⏱️ TIMEOUT ERROR: Server took >10s to respond")
                except requests.exceptions.ConnectionError as e:
                    self.stats["connection_error"] += 1
                    self._log_csv("FAILED", "", "ConnectionError", str(e))
                    print(f"[{timestamp}] 🔌 CONNECTION DROP: Could not resolve or connect to host")
                except requests.exceptions.RequestException as e:
                    self.stats["other_error"] += 1
                    self._log_csv("ERROR", "", "UnknownError", str(e))
                    print(f"[{timestamp}] ❌ UNKNOWN ERROR: {e}")

                # Rolling summary every 10 requests
                if self.stats["total"] % 10 == 0:
                    print(f"... [Rolling Stats] {self.stats['success']}/{self.stats['total']} successful | Avg Latency: {sum(self.latencies[-10:])/10:.0f}ms")
                
                time.sleep(INTERVAL_SEC)
                
        except KeyboardInterrupt:
            print("\n\n🛑 Received termination signal. Shutting down monitor...")
            self.print_summary()
            sys.exit(0)

if __name__ == "__main__":
    monitor = UptimeMonitor()
    monitor.run()
