# Principal Security Engineer Prompt — Eliminating Hardcoded Endpoint Credentials & Secure Spoke Onboarding

## Vulnerability Statement (Confirmed)

The Hybrid Orchestration Guide instructs operators to hardcode `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` directly into shell commands, Python scripts, and — critically — the guide's own examples imply these same values could end up embedded in `soc-frontend` React code or `.env` files bundled into the browser build. Any secret placed in frontend source, including values referenced via `import.meta.env`/`process.env` in a Vite/CRA build, is compiled into the static JS bundle and is fully visible to anyone who opens browser DevTools or views the page source — this is not obfuscation, it is public distribution of the credential[web:156][web:157][web:159][web:162][web:167]. Given this credential authenticates a Cloudflare Access service token capable of triggering SOAR actions like `isolate_host` or `block_user`, its exposure means any visitor to the dashboard could extract it and impersonate an authenticated spoke or the hub itself when calling ingest/control endpoints.

This is a critical-severity finding: it defeats the entire Zero-Trust model built in the prior ADRs, because Cloudflare Access enforcement becomes meaningless once the credential it relies on is publicly readable.

---

## Root Cause Analysis

```text
You are a Principal Security Engineer performing root cause analysis on why the endpoint credential ended up exposed in the frontend.

Investigate and document:
1. Confirm whether CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (or any per-endpoint equivalent) exists anywhere under soc-frontend/src, including .env, .env.production, vite.config.ts define blocks, or any hardcoded string literal in a .tsx/.ts file.
2. Confirm whether these values are referenced via import.meta.env.VITE_* or process.env.REACT_APP_* — both patterns are compiled into the client bundle at build time and are NOT secret once shipped, regardless of .gitignore hygiene on the source repo[web:156][web:159][web:165][web:167].
3. Determine how this happened: was a backend-only secret copy-pasted into a frontend env file for "convenience" during a demo/testing phase (the most common root cause of this class of vulnerability), or is the frontend itself directly calling https://siem.yourdomain.com/api/endpoints/register or /agent/execute with these headers attached client-side?
4. Search git history (not just the current working tree) for any commit that ever contained these values in frontend paths — if found, treat the credential as permanently compromised even if later removed, since git history and any CDN/build cache may retain it.

Return a written root cause statement identifying exactly where and how the secret entered frontend-reachable code.
```

---

## Immediate Remediation (Do This Before Anything Else)

```text
You are a Principal Security Engineer executing emergency remediation for an exposed Cloudflare Access service token.

Immediate actions, in order:
1. Revoke and regenerate every Cloudflare Access service token that may have been exposed, via the Cloudflare Zero Trust dashboard (Access > Service Auth). Assume ALL existing tokens are compromised, not just the one you found in the frontend — do not attempt to selectively decide which tokens are "probably fine."
2. Remove the hardcoded/env-embedded credential from every frontend file, commit the removal, and rewrite git history (git filter-repo or BFG Repo-Cleaner) if the secret was ever committed, then force-push and rotate any other secret that may have been co-located in the same commit.
3. Audit Cloudflare Access logs and soc-backend audit logs for the exposure window to check whether the leaked token was actually used maliciously (unexpected endpoint registrations, unexpected SOAR actions, unfamiliar IP ranges calling /agent/execute or /api/endpoints/register).
4. Notify anyone with repo/deployment access that a credential rotation occurred, so they update their local environment files.

Return a completed remediation checklist confirming rotation, history cleanup, and audit log review.
```

---

## Correct Architecture: No Long-Lived Secrets Ever Reach the Frontend or Any Shared Script

```text
You are a Principal Backend/Security Architect redesigning endpoint credential distribution so that no long-lived Cloudflare Access secret is ever placed in soc-frontend, in shell history, in a shared onboarding script, or copy-pasted between operators.

Core principle: the browser-facing soc-frontend must NEVER hold Cloudflare Access service token credentials, and no endpoint's permanent credential should ever be typed manually into a terminal command or committed to a shared file. Apply the following redesign:

1. Frontend (soc-frontend) authentication is entirely separate from spoke authentication:
   - Analysts authenticate to soc-frontend via their own session (existing login flow, HttpOnly cookie/JWT) — this has nothing to do with Cloudflare Access service tokens.
   - soc-frontend never calls https://siem.yourdomain.com/ingest/, /api/agents/tasks, or /agent/execute directly with a spoke's CF_ACCESS_CLIENT_ID/SECRET. Those calls only ever originate from soc-backend (server-to-server) or from the spoke's own agent process — never from code that runs in a user's browser[web:157][web:167].
   - If soc-frontend needs to display endpoint status, it calls soc-backend's own authenticated API (using the analyst's session), and soc-backend internally looks up and uses the spoke credentials server-side — the browser never sees them.

2. Spoke credentials are never manually typed by an operator. Replace the "export CF_ACCESS_CLIENT_ID=... / export CF_ACCESS_CLIENT_SECRET=..." pattern with a one-time bootstrap enrollment flow:
   a. An operator generates a short-lived, single-use "enrollment token" from the soc-frontend UI (requesting it from soc-backend, which creates it server-side and returns only the enrollment token — not the final service credential — to the browser for the operator to copy).
   b. The operator runs a single bootstrap command on the new endpoint, passing only the enrollment token: `curl -fsSL https://siem.yourdomain.com/bootstrap/install.sh | sh -s -- --enroll-token <one-time-token>`.
   c. The bootstrap script calls soc-backend's `/api/endpoints/enroll` using the one-time enrollment token; soc-backend validates it (checking expiry and single-use), then generates a permanent Cloudflare Access service token for this specific endpoint and returns it directly to the bootstrap script, which writes it to a locked-down local secrets file (e.g., /etc/soc-agent/credentials.env, mode 600, owned by a dedicated non-root service account) — never displayed on screen, never typed by a human, never present in shell history.
   d. The enrollment token expires after a short window (e.g., 15 minutes) and is invalidated after first use, so even if it leaks in a screen-share or terminal log, it cannot be reused.

3. Store the final per-endpoint service credential only in:
   - The local endpoint's own restricted secrets file (Section 2c), read only by the Fluent Bit/agent process at startup.
   - soc-backend's own secrets store (see Section 4) — never in soc-frontend, never in a shared onboarding document, never in Slack/chat during setup.

Return the redesigned enrollment flow as a sequence diagram (operator → soc-frontend → soc-backend → endpoint bootstrap script) and the /api/endpoints/enroll route specification.
```

---

## Secrets Storage on soc-backend (Server-Side)

```text
You are a Principal Backend Engineer defining how soc-backend stores and retrieves the per-endpoint Cloudflare Access service token credentials it needs to call spoke webhooks (Option B) — since soc-backend itself now holds these secrets server-side, not the frontend.

Your tasks:
1. Do not store cf_client_secret as plaintext in the Postgres endpoint inventory table. Use one of, in order of preference given your current PaaS-first constraints:
   a. A dedicated secrets manager (HashiCorp Vault, or a lighter-weight managed option such as Doppler or Infisical, both of which integrate cleanly with GitHub Actions and Docker deployments without requiring self-hosted Vault operational overhead).
   b. If a secrets manager is not yet feasible, store the credential encrypted at rest in Postgres using application-level encryption (e.g., a KMS-derived key or a locally-held encryption key injected via a deploy-time secret, never committed) rather than plaintext columns.
2. Ensure soc-backend's runtime environment variables (its own Cloudflare Access credentials, database URL, etc.) are injected exclusively via GitHub Actions encrypted secrets or the PaaS platform's own secret/environment variable manager at deploy time — never committed to the repository, never placed in a Dockerfile ENV instruction with a literal value[web:161][web:162][web:165].
3. Implement credential rotation support: each endpoint's service token should be rotatable on demand from the Asset Inventory UI ("Rotate Credential" button), triggering soc-backend to request a new Cloudflare Access service token, push it to the endpoint via a still-valid channel (or require a fresh short bootstrap re-enrollment if the old channel is already compromised), and revoke the old one.
4. Log every credential read/use (not the credential value itself) to the audit log, so credential misuse is detectable even without exposing the secret in logs.

Return the secrets storage design (chosen tool + fallback encryption approach) and the rotation workflow.
```

---

## Applying Zero-Trust Device Identity Principles to Spoke Onboarding

```text
You are a Principal Security Architect applying standard device-identity best practices (as used in IoT/device fleet management) to endpoint onboarding, since your spokes are conceptually the same problem as managing a fleet of IoT devices.

Apply these principles explicitly:
1. Each endpoint must have a unique, verifiable identity issued during enrollment (Section above), not a shared or hardcoded secret reused across multiple endpoints[web:158][web:166].
2. Apply least-privilege scoping per endpoint: an endpoint tagged type "paas" with capabilities ["block_user"] should receive a service token/API scope that only permits calling the tasks/result routes relevant to that capability — not a blanket credential that could also call isolate_host on unrelated endpoints[web:158].
3. Establish a decommissioning procedure: when an endpoint is retired, its Cloudflare Access service token must be explicitly revoked, its row in the endpoint inventory marked decommissioned (not deleted, for audit continuity), and any cached credential file on that host should be assumed unrecoverable/irrelevant rather than requiring cleanup on a machine you may no longer control[web:158][web:166].
4. Continuously monitor for anomalous endpoint behavior (e.g., an endpoint tagged "paas" suddenly attempting isolate_host calls, or check-ins from an unexpected IP/region) as a signal of a stolen credential, feeding this into the existing correlation logic already built in core-ingest[web:158].

Return this as an "Endpoint Identity Lifecycle" policy section for the Asset Inventory documentation.
```

---

## Orchestration Best Practice — Remote vs Local, Unified Answer

```text
You are a Principal Platform Architect providing the final, definitive answer on the best way to orchestrate endpoints regardless of whether they are remote or local, now that credential handling is fixed.

State clearly:
1. There is no meaningful architectural difference between "remote server" and "local server" once the enrollment flow (bootstrap token → server-issued credential → locked-down local secrets file) and the HTTP-agent-over-Cloudflare-Zero-Trust model are in place — both connect outbound-only, both authenticate via a credential that was never manually handled or exposed to a browser, and both appear identically in the Asset Inventory UI.
2. The only operational difference is which control option applies: Local and IaaS endpoints typically support Option B (Cloudflare Tunnel webhook) because they can run a persistent process and their own cloudflared tunnel; PaaS endpoints default to Option A (polling) because they cannot guarantee a persistent inbound-capable process. This distinction is about capability, not trust level — both are equally secured by the enrollment and credential model above.
3. This means the "best way to orchestrate it well" is: standardize the enrollment flow once, apply it uniformly to every endpoint regardless of physical location, and let the endpoint's own registered `type` and `capabilities` field (not its network location) determine which control option and which SOAR actions it is permitted to receive.

Return this as a short concluding architectural statement confirming remote and local endpoints are orchestrated identically once the credential model is corrected.
```

---

## Final Deliverables Checklist

| Deliverable | Purpose |
|---|---|
| Root cause statement identifying where the secret was exposed | Confirms scope of compromise |
| Rotated/revoked Cloudflare Access service tokens + git history cleanup | Immediate containment |
| One-time enrollment token flow (`/api/endpoints/enroll`) replacing manual env exports | Eliminates human handling of permanent secrets |
| Secrets manager or encrypted-at-rest storage on soc-backend | Removes plaintext secrets from the database |
| Credential rotation workflow in Asset Inventory UI | Ongoing security hygiene |
| Endpoint Identity Lifecycle policy (least privilege, decommissioning, anomaly monitoring) | Fleet-wide device security discipline |
| Confirmation that soc-frontend never calls spoke/ingest endpoints with service tokens | Closes the original vulnerability class permanently |

---

## Recommended Immediate Next Step

Execute the Immediate Remediation section first ��� rotate every Cloudflare Access service token now, regardless of confirmed misuse, and remove/rewrite any git history containing the exposed credential. Only after containment is complete should the enrollment-flow redesign and secrets-manager work begin, since continuing to onboard new endpoints on the old hardcoded-credential pattern while remediation is in progress would reintroduce the same vulnerability immediately.
