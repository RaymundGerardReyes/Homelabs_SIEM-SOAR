# Principal Engineer Prompt — Fix Quick Launch 3‑Step Flow & Rewrite SDK/API Documentation

## 0. Root Cause Diagnosis (Read First)

```text
Your terminal output shows the exact failure:

  {"detail":"Endpoint not active (status=pending_register); re-registration required"}

This is NOT a bug in the backend. verify_endpoint_secret is working exactly as designed —
it correctly rejects any endpoint that has not completed Step 2 (Register).

The real defect is in the "Quick Launch Command" generator inside HostManagementPage.tsx.

Compare the two Bash snippets in your codebase:

1. DocumentationPage.tsx (bash tab) — CORRECT:
   Step 1: POST /api/endpoints/enroll   -> writes .siem_credentials.json
   Step 2: POST /api/endpoints/register -> flips status pending_register -> active
   Step 3: POST /api/v1/agent/push      -> succeeds because endpoint is active

2. HostManagementPage.tsx (Quick Launch modal, ALL language tabs: curl, python,
   csharp, go, typescript) — BROKEN:
   Step 1: POST /api/endpoints/enroll   -> writes .siem_credentials.json
   Step 3: POST /api/v1/agent/push      -> FAILS with 401, because Step 2 was
                                            never called anywhere in the snippet.

This is why your terminal test failed twice in a row: the copy-pasted Quick Launch
command from the Host Management modal skips /api/endpoints/register entirely.
The agent enrolls, gets a secret, and immediately tries to push logs while still
stuck in 'pending_register'. There is no code path that ever calls /register,
so the endpoint can never become active — the failure is 100% deterministic,
not intermittent.

This explains why "curl API testing was insufficient": the tool you were testing
with was generated from an incomplete template, not a transient network or auth issue.
```

---

## 1. Immediate Fix: Restore the Missing Register Step

```text
Update every language tab inside HostManagementPage.tsx's "Quick Launch Command"
section (curl, python, csharp, go, typescript — Java already omitted, add if desired)
so each snippet performs the full, mandatory 3-step lifecycle, with NO step skipped:

  Step 1 — POST /api/endpoints/enroll
    Body: { enrollment_token, initial_metadata: { hostname, os, type } }
    Result: persist { endpoint_id, endpoint_secret, tenant_id } to local credential
             storage (.siem_credentials.json or in-memory equivalent).
    Endpoint status after this call: 'pending_register' (NOT usable for push yet).

  Step 2 — POST /api/endpoints/register   <-- THE STEP THAT WAS MISSING
    Headers: Authorization: Bearer <endpoint_secret>
    Body: { hostname, label, type, capabilities[], agent_version, os, region }
    Result: backend flips endpoint_inventory.status -> 'active'.
    This call MUST happen before any call to /api/v1/agent/push.

  Step 3 — POST /api/v1/agent/push
    Headers: Authorization: Bearer <endpoint_secret>, X-Tenant-ID: <tenant_id>
    Body: { events: [...] }
    This call will now succeed because the endpoint is active.

Apply this fix identically across ALL five tabs so that no matter which language
a user copies, the generated script is functionally complete and self-consistent
with the backend's verify_endpoint_secret contract (status must be 'active').

Reference implementation for parity: use DocumentationPage.tsx's existing
Python/C#/Go/TypeScript/Bash snippets as the source of truth — they already
implement Step 2 correctly. Port that same enroll -> register -> push sequence
into HostManagementPage.tsx's Quick Launch generator so both surfaces of the
UI (Docs page and Host Management modal) never diverge again.
```

---

## 2. Make the Fix Structurally Impossible to Regress

```text
Do not just patch the string templates — eliminate the class of bug entirely:

1. Extract a single source of truth for command generation:
   - Create one shared function/module, e.g. generateQuickLaunchSnippet(lang, token, tenantId),
     used by BOTH DocumentationPage.tsx and HostManagementPage.tsx.
   - Never maintain two independent copies of the same 3-step logic in two files —
     that duplication is exactly how Step 2 silently disappeared from one of them.

2. Add a lightweight contract test (even a simple string-match unit test) that asserts:
   - Every generated snippet, for every language, contains all three endpoint paths:
     '/api/endpoints/enroll', '/api/endpoints/register', '/api/v1/agent/push'
   - Fail the build if any language snippet is missing one of the three.

3. Add a visible UI safeguard in the Quick Launch panel:
   - A small "3-Step Lifecycle" checklist rendered above the code block
     (Enroll -> Register -> Push) so operators can visually verify all three
     calls exist in whichever snippet they copy, before pasting it into a terminal.
```

---

## 3. Backend Defensive Improvement (Optional but Recommended)

```text
Even with the SDKs fixed, make the failure mode more actionable for future integrators:

1. In agent_routes.py's verify_endpoint_secret, when status != 'active', return a
   structured error body instead of plain text, e.g.:
     {
       "detail": "Endpoint not active (status=pending_register)",
       "remediation": "Call POST /api/endpoints/register with your endpoint_secret
                        before pushing logs.",
       "docs_url": "https://socanalyst.raymundgerardestaca.dev/docs#step-2"
     }
   This turns a confusing 401 into a self-documenting, actionable error for anyone
   testing with curl, Postman, or a custom script.

2. Add a lightweight /api/endpoints/me status check recommendation in every SDK's
   error handler: on 401 with 'pending_register', automatically call /register
   using the locally cached metadata before giving up — this makes the SDKs
   self-healing for this exact class of mistake.
```

---

## 4. Rewrite the Documentation to Explain Purpose, Not Just Syntax

```text
Your current SIEM Integration SDK Reference and DocumentationPage.tsx describe
WHAT to call, but not clearly enough WHY each call exists, WHAT problem it solves,
and HOW data actually flows into the SIEM/SOAR pipeline once ingested. Rewrite the
documentation with the following structure and content:

1. "Why This API Exists" (new top section):
   - One paragraph explaining the architectural principle: external systems are
     zero-processing telemetry conduits; the platform is a centralized SIEM/SOAR
     hub with a single internal AI Agent as the sole intelligence layer.
   - Explicitly state the problem being solved: heterogeneous systems (Windows,
     Linux, cloud services, custom apps) all need one uniform, secure way to
     stream raw activity data into a central hub without each system needing to
     understand threat detection.

2. "How Enrollment and Registration Work" (expand existing lifecycle section):
   - For each of the 3 steps, explicitly answer:
     a) What problem does this step solve?
     b) What state does the system transition through (pending_register -> active)?
     c) What happens if this step is skipped? (Show the exact 401 error your
        terminal produced, as a concrete "common failure" callout box.)
   - Add a state diagram description in prose:
     "no credentials" -> [enroll] -> "pending_register" -> [register] -> "active"
     -> [push] -> "streaming telemetry"

3. "How Logs Reach the SIEM/SOAR Pipeline" (new section — currently missing):
   - Explain, in plain language, the path an event takes after /api/v1/agent/push:
     1. FastAPI validates identity (endpoint_secret) and tenant (X-Tenant-ID).
     2. Events are enriched with endpoint_id, tenant_id, and a correlation_id.
     3. Enriched events are forwarded internally to the Go ingestion service
        (core-ingest) over the internal Docker network — never exposed publicly.
     4. core-ingest persists events into ClickHouse (the analytical data lake)
        and/or streams them to the internal AI Agent for real-time correlation.
     5. The internal AI Agent performs anomaly detection, correlation, and
        (if malicious activity is confirmed) creates alerts/incidents and SOAR
        tasks — entirely inside the trusted backend, never on the edge SDK.
   - Include a simple ASCII or textual pipeline diagram, e.g.:
     [Your App/Server] --push--> [FastAPI Ingress] --> [core-ingest/Go] -->
     [ClickHouse] --> [Internal AI Agent] --> [Alerts / SOAR Playbooks]

4. "Common Failure Reference" (new section):
   - Document known error responses with cause + fix, starting with the one
     you just hit:
     | HTTP Status | Detail | Cause | Fix |
     |---|---|---|---|
     | 401 | Endpoint not active (status=pending_register) | Step 2 /register was
       never called | Call POST /api/endpoints/register with your endpoint_secret |
     | 401 | Invalid endpoint secret | Secret was rotated or never issued | Re-run
       enrollment with a fresh token |
     | 403 | Tenant ID mismatch | X-Tenant-ID header does not match the endpoint's
       tenant | Use the tenant_id returned during enrollment, unmodified |
     | 413 | Batch too large | More than 500 events in one push | Split into
       multiple smaller batches |
     | 422 | No events provided | Empty events array in request body | Include at
       least one event object |

5. Keep the existing Security Contract table, but add a row:
   | Lifecycle Enforcement | /api/v1/agent/push always requires prior successful
     /api/endpoints/register; there is no bypass path. |
```

---

## 5. Verification Checklist Before Calling This "Done"

```text
After applying the fixes above, verify end-to-end for EVERY language SDK:

1. Delete any existing .siem_credentials.json (or language-equivalent cache).
2. Generate a brand-new enrollment token from the Host Management UI.
3. Run the Quick Launch command exactly as copied, with no manual edits.
4. Confirm three consecutive successful HTTP responses in order:
   a) 200 from /api/endpoints/enroll
   b) 200 from /api/endpoints/register  <-- must now be present in the transcript
   c) 200 (or 202) from /api/v1/agent/push
5. Confirm endpoint_inventory.status == 'active' in the database after step (b).
6. Repeat for curl, Python, C#, Go, and TypeScript — all five must show identical
   pass/fail behavior. Any language that fails while another succeeds indicates
   the shared-template refactor in Section 2 was not applied consistently.
7. Only mark this issue resolved once ALL five language Quick Launch commands work
   identically and simultaneously against the same live tenant/token, and the
   documentation reflects the full architecture from token issuance through
   AI Agent correlation.
```
