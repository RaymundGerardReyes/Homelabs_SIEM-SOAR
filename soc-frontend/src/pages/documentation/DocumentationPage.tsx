import React, { useState } from 'react';
import { Link } from 'react-router-dom';

type LanguageTab = 'bash' | 'python' | 'csharp' | 'go' | 'typescript' | 'java';

export default function DocumentationPage() {
  const [activeTab, setActiveTab] = useState<LanguageTab>('python');

  // Dynamically resolve the HUB_URL based on where the app is hosted (e.g. PaaS environments)
  const currentHubUrl = (import.meta as any).env?.VITE_HUB_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:81');


  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-indigo-500/30">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 w-full backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-white font-bold text-lg tracking-tight">Agentic SOC <span className="text-slate-500 font-normal">/ Docs</span></span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Sign In</Link>
              <Link to="/" className="text-sm font-medium px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all shadow-lg shadow-indigo-500/20">Go to App</Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col lg:flex-row gap-12">
        
        {/* Sidebar TOC */}
        <div className="w-full lg:w-64 shrink-0">
          <div className="sticky top-28 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Getting Started</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#why" className="text-indigo-400 font-medium hover:text-indigo-300 transition-colors">Why This API Exists</a></li>
                <li><a href="#pipeline" className="text-slate-400 hover:text-slate-200 transition-colors">How Logs Reach the Pipeline</a></li>
                <li><a href="#security" className="text-slate-400 hover:text-slate-200 transition-colors">Security Contract</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Integration Lifecycle</h3>
              <ul className="space-y-2 text-sm border-l border-slate-800 ml-1">
                <li><a href="#lifecycle" className="block pl-4 -ml-px border-l hover:border-indigo-500 text-slate-400 hover:text-slate-200 transition-colors">How Enrollment Works</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Troubleshooting</h3>
              <ul className="space-y-2 text-sm border-l border-slate-800 ml-1">
                <li><a href="#failures" className="block pl-4 -ml-px border-l hover:border-indigo-500 text-slate-400 hover:text-slate-200 transition-colors">Common Failure Reference</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 max-w-4xl min-w-0">
          
          {/* Header */}
          <div className="mb-16">
            <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">SIEM Integration SDK</h1>
            <p className="text-lg text-slate-400 leading-relaxed">
              Integrate external services, databases, and custom applications securely into the Agentic SOC platform using our zero-processing telemetry model.
            </p>
          </div>

          {/* Why This API Exists */}
          <section id="why" className="mb-16 scroll-mt-28">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">Why This API Exists</h2>
            <div className="prose prose-invert max-w-none text-slate-300 leading-relaxed">
              <p className="mb-4">
                The platform utilizes a strictly enforced <strong>Zero-Processing Edge</strong> architecture. External integrations act solely as "dumb pipes" — their only responsibility is to collect raw events and forward them securely.
              </p>
              <p className="mb-4">
                <strong>The Problem:</strong> Heterogeneous systems (Windows, Linux, cloud services, custom apps) all need one uniform, secure way to stream raw activity data into a central hub, without each edge system needing to understand threat detection, rule logic, or signature mapping.
              </p>
              <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl p-6 mb-6 shadow-inner">
                <h4 className="text-indigo-400 font-semibold mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  The Solution: A Centralized Hub
                </h4>
                <p className="text-sm text-indigo-200/70">
                  All threat detection, anomaly scoring, correlation, and response automation is performed by the <strong>Central AI Agent</strong> completely isolated within our backend. It never leaks logic, configurations, or secrets back to the edge SDKs.
                </p>
              </div>
            </div>
          </section>

          {/* How Logs Reach the SIEM/SOAR Pipeline */}
          <section id="pipeline" className="mb-16 scroll-mt-28">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">How Logs Reach the SIEM/SOAR Pipeline</h2>
            <div className="prose prose-invert max-w-none text-slate-300 leading-relaxed">
              <p className="mb-4">The path an event takes after you call <code className="text-indigo-400">/api/v1/agent/push</code>:</p>
              <ol className="list-decimal pl-5 space-y-2 mb-6">
                <li><strong>FastAPI Ingress</strong> validates endpoint identity (<code className="text-slate-400">endpoint_secret</code>) and tenant isolation (<code className="text-slate-400">X-Tenant-ID</code>).</li>
                <li>Events are enriched with <code className="text-slate-400">endpoint_id</code>, <code className="text-slate-400">tenant_id</code>, and a unique <code className="text-slate-400">correlation_id</code>.</li>
                <li>Enriched events are forwarded internally to the Go ingestion service (<code className="text-slate-400">core-ingest</code>) over the internal Docker network — never exposed publicly.</li>
                <li><code className="text-slate-400">core-ingest</code> persists events into ClickHouse (the analytical data lake) and streams them to the Internal AI Agent for real-time correlation.</li>
                <li>The <strong>Internal AI Agent</strong> performs anomaly detection, correlation, and (if malicious activity is confirmed) creates alerts/incidents and SOAR tasks — entirely inside the trusted backend, never on the edge SDK.</li>
              </ol>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto shadow-inner">
                <pre className="text-xs text-indigo-300/80 font-mono leading-relaxed">
{`[ Your App / Server ]
         │
     (POST /push)
         │
         ▼
[ FastAPI Ingress ] ── (enrichment) ──┐
                                      │
                                      ▼
                             [ core-ingest (Go) ]
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
            [ ClickHouse ]                    [ Internal AI Agent ]
           (Analytical Lake)                           │
                                                       ▼
                                         [ Alerts & SOAR Playbooks ]`}
                </pre>
              </div>
            </div>
          </section>

          {/* Security Contract */}
          <section id="security" className="mb-16 scroll-mt-28">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">Security Contract</h2>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Security Control</th>
                    <th className="px-6 py-4 font-semibold">Enforced Behavior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">Lifecycle Enforcement</td>
                    <td className="px-6 py-4 text-slate-400"><code className="text-xs">/api/v1/agent/push</code> always requires prior successful <code className="text-xs">/api/endpoints/register</code>; there is no bypass path.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">Token Expiry</td>
                    <td className="px-6 py-4 text-slate-400">Enforced server-side (default 15m). Expired tokens return HTTP 401.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">Single-Use Enforcement</td>
                    <td className="px-6 py-4 text-slate-400">Tokens are consumed immediately. Re-use returns 401.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">Tenant Cross-Check</td>
                    <td className="px-6 py-4 text-slate-400">The <code className="text-indigo-400 text-xs bg-indigo-500/10 px-1 py-0.5 rounded">X-Tenant-ID</code> header is strictly verified against the database.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">Audit Logging</td>
                    <td className="px-6 py-4 text-slate-400">All token issuance and credential rotations are permanently logged.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-4 border-l-4 border-amber-500 bg-amber-500/10 text-amber-200/90 text-sm rounded-r-lg">
              <strong>Requirement:</strong> Your SDK implementation must handle HTTP 401 responses by automatically purging local credentials and requesting a new manual enrollment token from the SOC admin.
            </div>
          </section>

          {/* Lifecycle Breakdown */}
          <section id="lifecycle" className="mb-16 scroll-mt-28">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">How Enrollment and Registration Work</h2>
            <div className="text-slate-400 mb-6 text-sm flex items-center justify-center bg-slate-900/50 py-3 rounded-xl border border-slate-800/80 font-mono">
              no credentials ➔ <span className="text-indigo-400 mx-2">[enroll]</span> ➔ pending_register ➔ <span className="text-cyan-400 mx-2">[register]</span> ➔ active ➔ <span className="text-emerald-400 mx-2">[push]</span> ➔ streaming
            </div>
            <div className="space-y-6">
              
              <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                <h3 className="text-lg font-bold text-indigo-400 mb-2 flex items-center gap-2">
                  <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded flex items-center justify-center text-xs">1</span>
                  Enroll
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed mb-3">
                  <strong>Problem Solved:</strong> Exchanges a short-lived, single-use UI token for a persistent cryptographic secret securely.
                </p>
                <p className="text-sm text-slate-400 leading-relaxed">
                  <strong>State Transition:</strong> The server immediately invalidates the token to prevent replay attacks, and issues a permanent <code className="text-slate-300">endpoint_secret</code>. At this stage, the agent is placed into a <strong>quarantined state</strong> (<code className="text-amber-400/80">pending_register</code>) and cannot push logs yet.
                </p>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
                <h3 className="text-lg font-bold text-cyan-400 mb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/20 text-cyan-300 w-6 h-6 rounded flex items-center justify-center text-xs">2</span>
                  Register
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed mb-3">
                  <strong>Problem Solved:</strong> Declares agent capabilities and activates the endpoint for telemetry ingestion.
                </p>
                <p className="text-sm text-slate-400 leading-relaxed mb-3">
                  <strong>State Transition:</strong> Using the newly acquired secret, the agent calls <code className="text-slate-300">/api/endpoints/register</code>. Here, it announces its hostname, OS, and operational capabilities. The backend records this metadata and formally elevates the endpoint status to <code className="text-emerald-400/80">active</code>, lifting the quarantine.
                </p>
                <p className="text-sm text-red-400/90 leading-relaxed bg-red-950/30 p-3 rounded-lg border border-red-500/20">
                  <strong>If Skipped:</strong> Any attempt to push logs will fail. You will receive exactly: <br/><code className="text-xs">{"{"}"detail": {"{"}"error": "Endpoint not active (status=pending_register)"...{"}"}{"}"}</code>
                </p>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                <h3 className="text-lg font-bold text-emerald-400 mb-2 flex items-center gap-2">
                  <span className="bg-emerald-500/20 text-emerald-300 w-6 h-6 rounded flex items-center justify-center text-xs">3</span>
                  Push Logs
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed mb-3">
                  <strong>Problem Solved:</strong> Continuous, high-throughput transmission of telemetry data into the AI Intelligence Engine.
                </p>
                <p className="text-sm text-slate-400 leading-relaxed">
                  <strong>State Transition:</strong> Now fully authenticated and active, the agent streams raw log events. If an admin ever revokes the agent via the dashboard, this endpoint will immediately return <code className="text-red-400/80">401 Unauthorized</code>, prompting the agent to wipe its local secrets and halt execution.
                </p>
              </div>

            </div>
          </section>

          {/* Common Failure Reference */}
          <section id="failures" className="mb-16 scroll-mt-28">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">Common Failure Reference</h2>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-semibold">HTTP Status</th>
                    <th className="px-4 py-3 font-semibold">Detail</th>
                    <th className="px-4 py-3 font-semibold">Cause</th>
                    <th className="px-4 py-3 font-semibold">Fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 align-top">
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-red-400 font-mono">401</td>
                    <td className="px-4 py-3 text-slate-300">Endpoint not active (status=pending_register)</td>
                    <td className="px-4 py-3 text-slate-400">Step 2 <code className="text-xs">/register</code> was never called</td>
                    <td className="px-4 py-3 text-slate-400">Call POST <code className="text-xs">/api/endpoints/register</code> with your endpoint_secret.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-red-400 font-mono">401</td>
                    <td className="px-4 py-3 text-slate-300">Invalid endpoint secret</td>
                    <td className="px-4 py-3 text-slate-400">Secret was rotated or never issued</td>
                    <td className="px-4 py-3 text-slate-400">Re-run enrollment with a fresh token.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-red-400 font-mono">403</td>
                    <td className="px-4 py-3 text-slate-300">Tenant ID mismatch</td>
                    <td className="px-4 py-3 text-slate-400"><code className="text-xs">X-Tenant-ID</code> header does not match the endpoint's tenant</td>
                    <td className="px-4 py-3 text-slate-400">Use the tenant_id returned during enrollment, unmodified.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-red-400 font-mono">413</td>
                    <td className="px-4 py-3 text-slate-300">Batch too large</td>
                    <td className="px-4 py-3 text-slate-400">More than 500 events in one push</td>
                    <td className="px-4 py-3 text-slate-400">Split into multiple smaller batches.</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-red-400 font-mono">422</td>
                    <td className="px-4 py-3 text-slate-300">No events provided</td>
                    <td className="px-4 py-3 text-slate-400">Empty events array in request body</td>
                    <td className="px-4 py-3 text-slate-400">Include at least one event object.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Interactive Code Section */}
          <section className="mb-24">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2">Implementation Walkthrough</h2>
            
            <p className="text-slate-400 mb-8">
              Select your preferred language to see the exact 3-step lifecycle implementation. You can copy these snippets directly into your projects.
            </p>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
              {/* Code Header / Tabs */}
              <div className="flex items-center overflow-x-auto border-b border-slate-800 bg-slate-950/50 p-2 gap-2 hide-scrollbar">
                {[
                  { id: 'python', label: 'Python' },
                  { id: 'csharp', label: 'C# .NET' },
                  { id: 'go', label: 'Go' },
                  { id: 'typescript', label: 'Node.js' },
                  { id: 'java', label: 'Java' },
                  { id: 'bash', label: 'Bash / cURL' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as LanguageTab)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                      activeTab === tab.id 
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-inner' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Code Content */}
              <div className="p-6 text-sm font-mono leading-relaxed overflow-x-auto text-slate-300">
                {activeTab === 'python' && (
<pre><code>{`import os, json, requests, socket, platform
from pathlib import Path

HUB_URL   = "${currentHubUrl}"
TOKEN     = os.getenv("TENANT_ENROLLMENT_TOKEN")
CRED_FILE = Path(".siem_credentials.json")

def enroll_and_register() -> dict:
    # 1. Enroll
    resp = requests.post(f"{HUB_URL}/api/endpoints/enroll", json={
        "enrollment_token": TOKEN,
        "initial_metadata": {"hostname": socket.gethostname(), "os": platform.platform(), "type": "iaas"}
    }, timeout=15)
    resp.raise_for_status()
    creds = resp.json()
    
    # 2. Register
    requests.post(f"{HUB_URL}/api/endpoints/register", json={
        "hostname": socket.gethostname(), "label": "Python Agent", "type": "iaas",
        "capabilities": ["telemetry"], "agent_version": "1.0", "os": platform.platform(), "region": "local"
    }, headers={"Authorization": f"Bearer {creds['endpoint_secret']}"}).raise_for_status()
    
    CRED_FILE.write_text(json.dumps(creds))
    return creds

def get_credentials() -> dict:
    if CRED_FILE.exists():
        return json.loads(CRED_FILE.read_text())
    return enroll_and_register()

def push_logs(events: list[dict]) -> None:
    creds = get_credentials()
    
    # 3. Push Logs
    resp = requests.post(
        f"{HUB_URL}/api/v1/agent/push",
        json={"events": events},
        headers={
            "Authorization": f"Bearer {creds['endpoint_secret']}",
            "X-Tenant-ID": creds["tenant_id"]
        },
        timeout=30
    )
    if resp.status_code in (401, 403):
        CRED_FILE.unlink(missing_ok=True)
        raise Exception("Credentials revoked — re-enroll required")
    resp.raise_for_status()`}</code></pre>
                )}

                {activeTab === 'csharp' && (
<pre><code>{`using System.Net.Http.Json;
using System.Text.Json;

public class SiemConnector
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly string _hubUrl = "${currentHubUrl}";
    private string? _endpointSecret;
    private string? _tenantId;

    public async Task EnrollAndRegisterAsync(string enrollToken)
    {
        // 1. Enroll
        var resp = await _http.PostAsJsonAsync($"{_hubUrl}/api/endpoints/enroll", new {
            enrollment_token = enrollToken,
            initial_metadata = new { hostname = Environment.MachineName, os = Environment.OSVersion.ToString(), type = "iaas" }
        });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        _endpointSecret = body.GetProperty("endpoint_secret").GetString();
        _tenantId       = body.GetProperty("tenant_id").GetString();

        // 2. Register
        var regReq = new HttpRequestMessage(HttpMethod.Post, $"{_hubUrl}/api/endpoints/register");
        regReq.Headers.Add("Authorization", $"Bearer {_endpointSecret}");
        regReq.Content = JsonContent.Create(new {
            hostname = Environment.MachineName, label = "C# SDK", type = "iaas",
            capabilities = new[] { "telemetry" }, agent_version = "1.0", os = "dotnet", region = "local"
        });
        (await _http.SendAsync(regReq)).EnsureSuccessStatusCode();
    }

    public async Task PushLogsAsync(IEnumerable<object> events)
    {
        // 3. Push Logs
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_hubUrl}/api/v1/agent/push");
        req.Headers.Add("Authorization", $"Bearer {_endpointSecret}");
        req.Headers.Add("X-Tenant-ID", _tenantId);
        req.Content = JsonContent.Create(new { events });

        var resp = await _http.SendAsync(req);
        if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized || resp.StatusCode == System.Net.HttpStatusCode.Forbidden)
            throw new Exception("Credentials revoked");
        resp.EnsureSuccessStatusCode();
    }
}`}</code></pre>
                )}

                {activeTab === 'go' && (
<pre><code>{`package siem

import (
    "bytes"; "encoding/json"; "fmt"; "net/http"; "os"; "runtime"; "time"
)

type Connector struct {
    HubURL, EndpointSecret, TenantID string
    client *http.Client
}

func (c *Connector) EnrollAndRegister(token string) error {
    hostname, _ := os.Hostname()
    
    // 1. Enroll
    payload, _ := json.Marshal(map[string]any{
        "enrollment_token": token,
        "initial_metadata": map[string]string{"hostname": hostname, "os": runtime.GOOS, "type": "iaas"},
    })
    resp, err := c.client.Post(c.HubURL+"/api/endpoints/enroll", "application/json", bytes.NewReader(payload))
    if err != nil { return err }
    defer resp.Body.Close()
    
    var result map[string]string
    json.NewDecoder(resp.Body).Decode(&result)
    c.EndpointSecret, c.TenantID = result["endpoint_secret"], result["tenant_id"]

    // 2. Register
    regPayload, _ := json.Marshal(map[string]any{
        "hostname": hostname, "label": "Go SDK", "type": "iaas",
        "capabilities": []string{"telemetry"}, "agent_version": "1.0", "os": runtime.GOOS, "region": "local",
    })
    reqReg, _ := http.NewRequest("POST", c.HubURL+"/api/endpoints/register", bytes.NewReader(regPayload))
    reqReg.Header.Set("Authorization", "Bearer "+c.EndpointSecret)
    reqReg.Header.Set("Content-Type", "application/json")
    c.client.Do(reqReg)
    return nil
}

func (c *Connector) PushLogs(events []map[string]any) error {
    // 3. Push Logs
    payload, _ := json.Marshal(map[string]any{"events": events})
    req, _ := http.NewRequest("POST", c.HubURL+"/api/v1/agent/push", bytes.NewReader(payload))
    req.Header.Set("Authorization", "Bearer "+c.EndpointSecret)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Tenant-ID", c.TenantID)
    
    resp, err := c.client.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode == 401 || resp.StatusCode == 403 { return fmt.Errorf("credentials revoked") }
    return nil
}`}</code></pre>
                )}

                {activeTab === 'typescript' && (
<pre><code>{`import fs from "fs";

const HUB_URL = "${currentHubUrl}";
const CRED_PATH = ".siem_credentials.json";

async function enrollAndRegister(token: string) {
  // 1. Enroll
  const res = await fetch(\`\${HUB_URL}/api/endpoints/enroll\`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollment_token: token,
      initial_metadata: { hostname: process.env.HOSTNAME ?? "node", os: process.platform, type: "iaas" }
    }),
  });
  const creds = await res.json();
  
  // 2. Register
  await fetch(\`\${HUB_URL}/api/endpoints/register\`, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": \`Bearer \${creds.endpoint_secret}\` },
    body: JSON.stringify({
      hostname: process.env.HOSTNAME ?? "node", label: "TS SDK", type: "iaas",
      capabilities: ["telemetry"], agent_version: "1.0", os: process.platform, region: "local"
    })
  });

  fs.writeFileSync(CRED_PATH, JSON.stringify(creds));
  return creds;
}

export async function pushLogs(events: object[]) {
  const creds = JSON.parse(fs.readFileSync(CRED_PATH, "utf-8"));
  
  // 3. Push Logs
  const res = await fetch(\`\${HUB_URL}/api/v1/agent/push\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${creds.endpoint_secret}\`,
      "Content-Type":  "application/json",
      "X-Tenant-ID":   creds.tenant_id,
    },
    body: JSON.stringify({ events }),
  });
  
  if (res.status === 401 || res.status === 403) { fs.rmSync(CRED_PATH); throw new Error("Revoked"); }
}`}</code></pre>
                )}

                {activeTab === 'java' && (
<pre><code>{`import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class SiemConnector {
    public static void main(String[] args) throws Exception {
        var http = HttpClient.newHttpClient();
        String hubUrl = "${currentHubUrl}";
        String token = System.getenv("ENROLLMENT_TOKEN");
        
        // 1. Enroll 
        String enrollBody = "{\\"enrollment_token\\":\\"" + token + "\\",\\"initial_metadata\\":{\\"hostname\\":\\"java-host\\",\\"os\\":\\"java\\",\\"type\\":\\"iaas\\"}}";
        var enrollReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/endpoints/enroll"))
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(enrollBody)).build();
        var enrollRes = http.send(enrollReq, HttpResponse.BodyHandlers.ofString());
        
        String secret = enrollRes.body().split("\\"endpoint_secret\\":\\"")[1].split("\\"")[0];
        String tenant = enrollRes.body().split("\\"tenant_id\\":\\"")[1].split("\\"")[0];

        // 2. Register
        String regBody = "{\\"hostname\\":\\"java-host\\",\\"label\\":\\"Java SDK\\",\\"type\\":\\"iaas\\",\\"capabilities\\":[\\"telemetry\\"],\\"agent_version\\":\\"1.0\\",\\"os\\":\\"java\\",\\"region\\":\\"local\\"}";
        var regReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/endpoints/register"))
            .header("Content-Type", "application/json").header("Authorization", "Bearer " + secret)
            .POST(HttpRequest.BodyPublishers.ofString(regBody)).build();
        http.send(regReq, HttpResponse.BodyHandlers.discarding());

        // 3. Push Logs
        String pushBody = "{\\"events\\":[{\\"timestamp\\":\\"2026-07-25T18:00:00Z\\",\\"source\\":\\"java-app\\",\\"severity\\":\\"INFO\\",\\"message\\":\\"Transaction logged\\"}]}";
        var pushReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/v1/agent/push"))
            .header("Content-Type", "application/json").header("Authorization", "Bearer " + secret).header("X-Tenant-ID", tenant)
            .POST(HttpRequest.BodyPublishers.ofString(pushBody)).build();
        var pushRes = http.send(pushReq, HttpResponse.BodyHandlers.discarding());
        
        if (pushRes.statusCode() == 401 || pushRes.statusCode() == 403) {
            System.err.println("Credentials revoked. Please re-enroll.");
        }
    }
}`}</code></pre>
                )}

                {activeTab === 'bash' && (
<pre><code>{`#!/usr/bin/env bash
HUB_URL="${currentHubUrl}"
CRED_FILE=".siem_credentials.json"

if [ ! -f "$CRED_FILE" ]; then
  # 1. Enroll
  curl -s -X POST "$HUB_URL/api/endpoints/enroll" \\
    -H "Content-Type: application/json" \\
    -d "{\\"enrollment_token\\":\\"\${TENANT_ENROLLMENT_TOKEN}\\",\\"initial_metadata\\":{\\"hostname\\":\\"$(hostname)\\",\\"os\\":\\"linux\\",\\"type\\":\\"iaas\\"}}" \\
    -o "$CRED_FILE"
    
  SECRET=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['endpoint_secret'])")
  
  # 2. Register
  curl -s -X POST "$HUB_URL/api/endpoints/register" \\
    -H "Authorization: Bearer $SECRET" \\
    -H "Content-Type: application/json" \\
    -d "{\\"hostname\\":\\"$(hostname)\\",\\"label\\":\\"Bash SDK\\",\\"type\\":\\"iaas\\",\\"capabilities\\":[\\"telemetry\\"],\\"agent_version\\":\\"1.0\\",\\"os\\":\\"linux\\",\\"region\\":\\"local\\"}"
fi

SECRET=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['endpoint_secret'])")
TENANT=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['tenant_id'])")

# 3. Push Logs
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/api/v1/agent/push" \\
  -H "Authorization: Bearer $SECRET" \\
  -H "Content-Type: application/json" \\
  -H "X-Tenant-ID: $TENANT" \\
  -d '{"events":[{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","source":"bash","severity":"INFO","message":"heartbeat"}]}')

if [ "$HTTP_STATUS" == "401" ] || [ "$HTTP_STATUS" == "403" ]; then
  echo "Stale credentials detected (status=$HTTP_STATUS). Purging cache..."
  rm -f "$CRED_FILE"
  echo "Please re-run the script to re-enroll securely."
  exit 1
fi
echo "Telemetry successfully pushed to backend (HTTP $HTTP_STATUS)."`}</code></pre>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
