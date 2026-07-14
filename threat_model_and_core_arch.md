# Architecture & Threat Model: Agentic SOC Platform

This document serves as the foundational security assessment and architecture review for the Agentic SOC Platform, written from the perspective of a Principal Security Engineer. It addresses both the **Threat Modeling** (Prompt 2) and the **Ingestion & Processing Core Review** (Prompt 4).

---

## Part 1: Ingestion & Processing Core Architecture Review

**Component Overview:**
- Collectors (syslog, HTTP, Kafka) written in Go/Rust.
- Normalization and enrichment pipeline.
- Correlation engine emitting alerts.
- OpenSearch/ClickHouse as the primary log store.

### 1. Issues and Risks

*   **Throughput & Back-Pressure Handling (Resource Exhaustion)**
    *   *Risk:* Ingestion spikes (e.g., during a widespread malware outbreak or a DDoS attack) can overwhelm Go/Rust collectors or the underlying data store (OpenSearch/ClickHouse).
    *   *Impact:* Dropped logs, delayed correlation (blind spots during an active incident), and potential OOM crashes in collectors.
*   **Data Poisoning & Malformed Payloads**
    *   *Risk:* Attackers inject crafted log payloads designed to exploit parsers (e.g., regex DOS) or poison the downstream LLM context (Prompt Injection via logs).
    *   *Impact:* Arbitrary code execution in log parsers, disruption of ML models, or manipulation of the LLM agents into taking unsafe actions based on spoofed "malicious" events.
*   **Lack of Multi-Tenant/Environment Isolation**
    *   *Risk:* A compromised endpoint in one environment floods the system, exhausting quotas for all environments.
    *   *Impact:* Cross-environment interference and noisy-neighbor issues leading to critical alerts being delayed.
*   **Correlation Engine Abuse**
    *   *Risk:* Lack of segregation of duties allows an insider or compromised analyst account to disable or modify correlation rules stealthily.
    *   *Impact:* Attackers can blind the SIEM before executing their primary objective.

### 2. Recommended Hardening Tactics

*   **Rate Limiting, Quotas, and Per-Tenant Isolation**
    *   Implement strict, configurable rate limits per log source/tenant at the collector edge.
    *   Use Kafka with separate topics per tenant or environment to ensure physical isolation of the message queue.
*   **Schema Validation and Reject Policies**
    *   Enforce rigid schema validation (e.g., JSON Schema, Protobuf) at the edge. Any payload not conforming to the schema must be dropped to a dead-letter queue (DLQ) rather than processed.
    *   Implement strict bounds on field lengths to prevent buffer overflows and regex DOS.
*   **Signed/Log-Attested Ingestion**
    *   Require mutual TLS (mTLS) for all log forwarders.
    *   For critical sources (e.g., audit logs, EDR), implement cryptographic signing of log payloads at the source to prevent spoofing and tampering in transit.
*   **Segregation of Duties for Correlation Rules**
    *   Treat correlation rules as Code (Detection-as-Code). Changes must be made via CI/CD, requiring peer review and automated testing before deployment to the correlation engine.

### 3. Required Dashboards and Alerts (Pre-Production)

Before moving to production, the following observability must be in place:
- **Collector Health Dashboard:** CPU/Memory usage, active connections, and restart counts per collector pod.
- **Ingestion Pipeline Dashboard:** Events/sec ingested vs. Events/sec written to OpenSearch/ClickHouse, queue depth (Kafka lag), and DLQ growth rate.
- **Data Quality Alerts:** Alerts on high volumes of schema validation failures or dropped events.
- **Latency Alerts:** Alerts if the time from log generation to correlation engine ingestion exceeds *X* seconds (e.g., > 30s).

---

## Part 2: Agentic SOC Threat Model

**Context:** The system includes a Go/Rust core, a Python automation layer (LLMs and Playbooks), and a React/TypeScript console.

### 1. Assets and Trust Boundaries

**Assets:**
- Raw Log Data (OpenSearch/ClickHouse)
- Correlation Rules and AI Prompts
- Playbook Code and Secrets (API Keys for SOAR actions)
- Analyst Identity and Sessions

**Trust Boundaries:**
- *External vs. Collectors:* Untrusted raw data entering the system.
- *Core vs. Python Automation Layer:* Highly structured data crossing into a dynamic, LLM-driven execution environment.
- *Automation Layer vs. External APIs (SOAR):* The boundary where the platform mutates state in external systems (firewalls, EDR, IAM).
- *Frontend vs. Backend:* Untrusted client interacting with the SOC API.

### 2. Threats (STRIDE) & Mitigations

#### Spoofing
- **Threat:** An attacker spoofs log events to trigger false positive SOAR playbooks (e.g., locking out a legitimate user).
- **Mitigation:** mTLS and log signing (as defined in Part 1). Require multiple distinct signals before triggering high-impact playbooks.

#### Tampering
- **Threat:** An attacker tampers with the LLM's context window by embedding prompt injection payloads within a username or user-agent field in a log.
- **Mitigation:**
  - *Input Sanitization:* Strip or escape control characters in log data before passing to the LLM.
  - *Architectural:* Use separate LLM calls (e.g., an extraction model that cannot execute tools) to parse untrusted text before passing summaries to the execution agent.

#### Repudiation
- **Threat:** An LLM agent takes an action, but it is unclear *why* the action was taken or *which* policy allowed it.
- **Mitigation:** Immutable audit logging of every LLM prompt, response, and tool invocation. Cryptographically sign audit logs and store them in a WORM (Write Once Read Many) drive.

#### Information Disclosure
- **Threat:** The Python playbook sandbox is escaped, allowing an attacker to read SOAR integration secrets.
- **Mitigation:** Execute playbooks in ephemeral, highly restricted microVMs (e.g., Firecracker). Inject secrets purely via environment variables at runtime, restricted by strictly scoped IAM roles.

#### Denial of Service
- **Threat:** The LLM agents get stuck in an infinite loop of tool calling, exhausting API quotas and compute resources.
- **Mitigation:** Implement strict depth limits (e.g., max 5 tool calls per agent invocation) and hard timeouts on the Python runtime.

#### Elevation of Privilege
- **Threat:** A mis-scoped playbook or overly permissive LLM tool allows an agent to perform destructive actions (e.g., wiping a server instead of isolating it).
- **Mitigation:** Implement a strict **Action Classification & Risk Scoring** framework (detailed in the Safety & Guardrails design). Use least privilege for all API keys provided to the SOAR layer.

### 3. Residual Risk and Human-In-The-Loop (HITL) Checkpoints

Despite mitigations, the unpredictable nature of LLMs introduces residual risk regarding hallucinated actions or subtle logic errors.

**Mandatory HITL Checkpoints:**
- **Any Write Action to Critical Infrastructure:** Modifying firewall rules, disabling privileged IAM accounts, or isolating critical tier-0 assets *must* require explicit analyst approval via the React console.
- **Playbook Modification:** Modifying or deploying new Python playbooks requires human peer review and approval.
- **Mass Actions:** Any SOAR action targeting more than a threshold of assets (e.g., > 5 machines) automatically pauses for human review.
