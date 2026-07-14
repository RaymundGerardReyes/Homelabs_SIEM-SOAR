# AI Safety & Multi-Agent Architecture

This document outlines the safety guardrails and multi-agent topology for the Agentic SOC Platform, designed from a Principal Security Engineer perspective. It addresses the requirements from **Prompt 3 (Safety & Guardrails)** and **Prompt 5 (Agent Framework Design)**.

---

## Part 1: Safety & Guardrails Layer

### 1. Action Classification & Risk Scoring

Every available SOAR tool and playbook action must be rigidly classified.

| Classification | Description | Risk Criteria | Examples |
| :--- | :--- | :--- | :--- |
| **Read-Only** | Queries that do not mutate state. | Zero blast radius, fully reversible. | Query logs, get user details, fetch threat intel. |
| **Low-Impact Write** | Minor state mutations that do not disrupt operations. | Small blast radius, easily reversible. | Tag an alert, update a ticket, send a Slack notification. |
| **High-Impact Write** | State mutations that could impact availability or users. | Medium blast radius, reversible with effort, compliance sensitive. | Disable user account, block external IP on firewall. |
| **Destructive** | State mutations that destroy data or sever critical access. | High blast radius, irreversible or high effort to recover. | Wipe a device, isolate a Tier-0 server, drop a database table. |

### 2. Execution Policies

An independent Policy Engine (e.g., OPA/Rego) evaluates every tool call request made by the Python playbooks or LLM agents.

*   **Auto-Execution Allowed:** Read-Only and Low-Impact Write actions (if confidence score > 90%).
*   **Dry-Run / Simulated Only:** High-Impact Write actions on sensitive assets (e.g., attempting to disable a CEO's account will only output what *would* happen).
*   **Strict Human Approval:** High-Impact Write and Destructive actions. The engine halts execution, persists state, and notifies the React console.

### 3. Sandboxing and Isolation

*   **Python Playbooks:** Executed via short-lived, gVisor or Firecracker-backed sandboxes.
    *   *Network:* Outbound access restricted to a tightly controlled proxy. No internal lateral movement allowed.
    *   *Runtime:* No arbitrary file system writes. CPU/Memory quotas enforced. Execution timeout capped at 60 seconds.
*   **LLM Tool Calling:**
    *   *Validation:* All tool parameters are strictly validated against a JSON schema *before* execution.
    *   *Rate Limits:* Agents are restricted to a maximum number of API calls per investigation to prevent runaway loops.

### 4. Auditing and Explainability

*   **The Audit Ledger:** Every state change is recorded in an immutable ledger.
*   **Required Fields:** Timestamp, Agent ID, Original Trigger Alert, Context/Prompt provided to LLM, Raw LLM JSON Response, Policy Engine Decision (Allow/Deny), and Execution Result.
*   **Reconstruction:** An analyst must be able to click an action in the SOC console and view the exact LLM thought process and policy rule that authorized it.

### 5. Fallback and Rollback

*   **Fallback:** If the LLM returns invalid JSON or hallucinates a non-existent tool 3 times consecutively, the agent is halted, the alert is tagged "AI Failure", and routed directly to a human triage queue.
*   **Rollback:** Every High-Impact Write tool must have a corresponding `undo_` tool implemented. If an agent blocks an IP and subsequently discovers the IP is benign, it must be capable of calling `undo_block_ip`.

---

## Part 2: Agent Framework Topology

We employ a Graph-based state machine (e.g., LangGraph) to strictly control how information flows between specialized, narrowly-scoped agents.

### 1. Agent Roles and Tool Allotment

By adhering to Least Privilege, no single agent possesses the keys to the entire kingdom.

1.  **Triage Agent:**
    *   *Responsibility:* Initial assessment of raw alerts, determining if they are false positives or require further investigation.
    *   *Allowed Tools:* `query_logs`, `get_alert_context`.
2.  **Enrichment Agent:**
    *   *Responsibility:* Gathers additional context on entities (IPs, Hashes, Users).
    *   *Allowed Tools:* `query_threat_intel`, `query_asset_inventory`, `query_identity_provider`.
3.  **Investigation Agent:**
    *   *Responsibility:* Correlates enriched data to build an attack narrative and hypotheses.
    *   *Allowed Tools:* `query_logs` (deep search). Cannot mutate state.
4.  **Response Proposer Agent:**
    *   *Responsibility:* Formulates a containment and remediation plan.
    *   *Allowed Tools:* `propose_action` (creates a pending state). Cannot execute directly.
5.  **Analyst-Assist Agent (Frontend):**
    *   *Responsibility:* Interfaces directly with the human analyst, summarizing the investigation and explaining the proposed response.

### 2. State Flow and Persistence

*   **Workflow:** Alert -> Triage -> (if true positive) Enrichment -> Investigation -> Response Proposer -> Halt for Human.
*   **Persistence:** The graph state (messages, hypotheses, pending actions) is persisted to a PostgreSQL database at every node transition. This allows long-running investigations to be paused and resumed seamlessly.

### 3. Preventing Tool Abuse

*   **Depth Bounds:** The LangGraph executor is configured with a strict recursion limit (e.g., max 15 total steps per alert).
*   **Overly Broad Queries:** The `query_logs` tool requires mandatory time-bound parameters (`start_time`, `end_time`) and enforces a maximum return limit (e.g., 500 rows) to prevent the agent from extracting the entire database.

### 4. Human-in-the-Loop (HITL) Interaction

*   **Overrides:** Analysts can inject messages directly into the graph state. If an agent concludes a file is benign, the analyst can append: "Override: I confirmed via sandbox this is malicious, proceed to response planning."
*   **Surfacing Suggestions:** The React console polls the graph state. When the graph reaches the `Response Proposer` node, the UI renders the proposed actions as interactive widgets with "Approve" and "Reject" buttons.
