# Principal Engineer Investigation: Why the New PaaS Endpoint Still Shows `pending_register`

## 0. Executive Summary — The Real Root Cause

```text
Your own hypothesis (backend enforces a 3-step lifecycle and rejects push if status
!= 'active') is CORRECT as a general architecture fact, confirmed directly in
agent_routes.py's verify_endpoint_secret dependency. However, it does NOT explain
why THIS specific run failed, because the Quick Launch bash snippet you are now
running (from the current HostManagementPage.tsx) ALREADY CONTAINS Step 2:

    if [ ! -f "$CRED_FILE" ]; then
      # Step 1: Enroll
      curl ... /api/endpoints/enroll ... -o "$CRED_FILE"
      SECRET=$(python -c "...")
      # Step 2: Register
      curl ... /api/endpoints/register ...
    fi
    SECRET=$(python -c "...")
    TENANT=$(python -c "...")
    # Step 3: Push Logs
    curl ... /api/v1/agent/push ...

The template is structurally correct. The failure is caused by something else
entirely: an INTERPRETER/SHELL-LEVEL bug combined with a STALE LOCAL FILE, not a
missing backend call.
```

---

## 1. Primary Root Cause: Stale `.siem_credentials.json` Short-Circuits the Register Step

```text
Look closely at your own terminal transcript:

  LOQ@RAYMUND-PC03 .../deploy (Development)
  $ #!/usr/bin/env bash
  ...
  if [ ! -f "$CRED_FILE" ]; then
    # Step 1: Enroll
    curl -s -X POST "$HUB_URL/api/endpoints/enroll" ...
    SECRET=$(python -c "...")
  rce":"bash","severity":"INFO","message":"heartbeat"}]}'%M:%SZ)'","sou
  {"detail":{"error":"Endpoint not active (status=pending_register)", ...}}

Notice: the visible echo of the script body STOPS right after the enroll SECRET=
line, and the terminal jumps straight into a fragment of the Step 3 push payload
("...heartbeat"...) followed immediately by the 401 error, printed TWICE.

This is the signature of the `if [ ! -f "$CRED_FILE" ]; then ... fi` GUARD BEING
SKIPPED ENTIRELY. If ".siem_credentials.json" already exists in the working
directory (D:\Hybrid LLM with SOAR and SIEM\deploy) from an EARLIER test run —
including your very first test using the OLD, broken 2-step script from before
Step 2 was added to the template — bash will:

  1. See the file already exists -> skip the entire enroll+register block
     (Step 1 AND Step 2 both silently skipped, no curl calls made at all).
  2. Fall through to the two lines that run unconditionally:
       SECRET=$(python -c "...")   <- reads the OLD, already-cached secret
       TENANT=$(python -c "...")   <- reads the OLD, already-cached tenant_id
  3. Immediately call /api/v1/agent/push using that stale secret.
  4. Because that endpoint_id was only ever enrolled (never registered) in an
     earlier run, its status in endpoint_inventory is PERMANENTLY 'pending_register'
     until you explicitly call /register for THAT SAME endpoint_id — which never
     happens because the script logic assumes "file exists" == "fully onboarded".

This is why inserting a brand-new enrollment token into this same working directory
"did not do anything": the script never even looks at the new token, because the
presence of the OLD credentials file bypasses Step 1 and Step 2 completely.
The new token you generated was never consumed at all.
```

### Why This Is Deterministic, Not Intermittent

```text
This is not a network flake or timing race condition. Every single execution
against a machine/directory that already has a stale .siem_credentials.json
will reproduce the exact same 401, because:

  - The file existence check is the ONLY gate for re-running enrollment.
  - There is no logic anywhere in the script that checks whether the CACHED
    endpoint is actually 'active' before deciding to skip Step 1/Step 2.
  - Once cached, a 'pending_register' secret is permanently reused for push,
    forever failing, until the file is manually deleted or the script is fixed.
```

---

## 2. Confirming Evidence From the Backend Code

```text
agent_routes.py defines two DIFFERENT dependency checks that make this
diagnosis unambiguous:

  verify_endpoint_secret(endpoint):
      if endpoint["status"] != "active":
          raise HTTPException(401, detail={
              "error": f"Endpoint not active (status={endpoint['status']})",
              "remediation": "Call POST /api/endpoints/register with your
                               endpoint_secret before pushing logs.",
              "docs_url": "/documentation#lifecycle"
          })

  verify_endpoint_secret_for_registration(endpoint):
      if endpoint["status"] not in ("active", "pending_register"):
          raise HTTPException(401, ...)

This proves:
  - /api/v1/agent/push is gated ONLY by verify_endpoint_secret (strict: must be
    'active'). This is working exactly as designed — it is NOT the bug.
  - /api/endpoints/register is gated by the more permissive
    verify_endpoint_secret_for_registration, which explicitly ALLOWS
    'pending_register' endpoints through, specifically so Step 2 can succeed.
  - Since /register was never actually invoked for this endpoint_id (because
    the shell script skipped it via the stale-file short-circuit), the row in
    endpoint_inventory never transitions out of 'pending_register'.

There is no bug in agent_routes.py. The lifecycle enforcement is correct and
intentional. The defect is entirely in the operational habit of re-running a
Quick Launch script inside a directory that retains state from a previous,
now-obsolete enrollment attempt.
```

---

## 3. Secondary Confirmed Finding: Nginx Duplicate `Date` Header on WebSocket Upgrade

```text
2026/07/25 14:19:08 [warn] ... upstream sent duplicate header line: "date: ...",
previous value: "Date: ...", ignored ... request: "GET /api/ws/agent/stream ..."

Root cause: BOTH the upstream Python/Uvicorn ASGI response AND an intermediate
hop (Nginx itself, or a second proxy layer such as cloudflared re-terminating
the response) are independently setting a Date header on the same response.
Nginx's header parser is case-insensitive but stores headers by their exact
byte representation internally in some code paths, so "Date:" (from Uvicorn)
and "date:" (re-added by Nginx's own response processing for the proxied
WebSocket upgrade) collide and the second one is dropped with a warning.

Impact: Non-fatal for plain HTTP REST calls (which is why /api/endpoints/enroll,
/register, and /v1/agent/push all still work over plain POST). However, for the
WebSocket upgrade specifically (/api/ws/agent/stream), some strict WebSocket
clients (certain PaaS platform's internal proxy/load balancers, e.g. Render,
Railway, Fly.io edge layers) will terminate the handshake early if they detect
malformed/duplicate headers during the 101 Switching Protocols response. This
can manifest as your external PaaS agent silently failing to establish or
maintain the live telemetry WebSocket stream, even after HTTP push calls work.

Fix: explicitly strip the header before Nginx's own layer re-adds it, using
proxy_hide_header Date; in the /api/ws/ location block of nginx.conf, so only
one authoritative Date header is emitted per response.
```

---

## 4. Concrete Remediation Steps

### Step A — Purge Stale State (Immediate Unblock)

```bash
# On the machine running the Quick Launch script:
rm -f .siem_credentials.json

# Re-run the freshly copied Quick Launch script from the Host Management modal,
# using a brand-new, unused enrollment token generated AFTER this cleanup.
```

### Step B — Harden the Script So This Can Never Happen Again

```text
Update the Quick Launch template (and all SDK language variants) generated by
HostManagementPage.tsx so the guard checks ACTUAL ENDPOINT STATE, not just file
existence. Two acceptable patterns:

Pattern 1 (Simplest — self-healing via /api/endpoints/me):
  1. If CRED_FILE exists, call GET /api/endpoints/me with the cached secret.
  2. If the response is 401 OR status != "active", delete the cached file and
     fall through to re-run enroll + register from scratch.
  3. Only skip enroll/register if /me confirms status == "active".

Pattern 2 (Defense in depth — always attempt register, tolerate 409/200):
  1. Always call /api/endpoints/register on every script run using the cached
     secret, even if CRED_FILE already exists.
  2. Treat HTTP 200 (already active, re-register is idempotent) and the
     specific "already active" case as success; only fail hard on 401 (secret
     invalid, requires full re-enroll).
  3. This makes the script tolerant of partial prior runs without needing to
     track state via file existence at all.

Apply this fix consistently to ALL language tabs (bash, python, csharp, go,
typescript, java) in HostManagementPage.tsx AND DocumentationPage.tsx so no
SDK variant can silently re-adopt a dead, pending_register credential again.
```

### Step C — Fix the Nginx Duplicate Header on the WebSocket Route

```nginx
location /api/ws/ {
    proxy_pass http://soc-python-ai-backend:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_hide_header Date;        # Strip upstream Date to avoid duplication
    add_header Date $sent_http_date always; # Re-add exactly once, deterministically
    proxy_read_timeout 3600s;
}
```

### Step D — Add a Backend Safety Net (Defense in Depth)

```text
Since local script bugs like this WILL recur across different external systems
and developers, make the backend itself more forgiving and diagnosable:

1. In POST /api/endpoints/register, if the endpoint is ALREADY 'active' (i.e.
   this is a redundant re-registration call), return 200 with the existing
   RegisterResponse instead of failing — this makes Pattern 2 above trivially
   safe to always call.

2. Add a lightweight admin-facing "Endpoint Timeline" view (via
   GET /api/admin/endpoints/{endpoint_id}/timeline) showing enrolled_at,
   registered_at (nullable), last_push_at (nullable). This immediately reveals
   "enrolled but never registered" endpoints stuck in limbo, so this class of
   incident can be diagnosed in seconds from the dashboard instead of by
   reading raw curl transcripts.

3. Log a distinct, greppable warning server-side whenever verify_endpoint_secret
   rejects a push due to pending_register, including how long the endpoint has
   been stuck in that state (now() - created_at), so operators can distinguish
   "just enrolled, register call is in flight" from "stuck for hours because of
   a broken client script."
```

---

## 5. Verification Checklist

```text
1. Confirm .siem_credentials.json does not pre-exist before testing a new token.
2. Run the Quick Launch script fresh; capture full unbuffered output (avoid the
   MINGW64/Git Bash line-wrapping that obscured your original transcript — pipe
   to `| tee run.log` for a clean, non-truncated record).
3. Confirm three distinct 2xx responses in order: enroll -> register -> push.
4. Query endpoint_inventory directly (or via /api/endpoints/agent-health) and
   confirm status = 'active' for the new endpoint_id before declaring success.
5. Re-run the SAME script a second time without deleting the credentials file,
   and confirm it still succeeds (this proves Step B's self-healing guard works
   and the script is now idempotent across repeated executions).
6. Open a WebSocket client against /api/ws/agent/stream through the Nginx proxy
   and confirm the handshake completes without the duplicate Date header warning
   reappearing in nginx logs.
