# Healthcare privacy notes (demo)

This project uses **synthetic** client data only. Still, the integration patterns mirror
real healthcare provider constraints.

## Principles baked into CareOps

1. **Minimise PII to the model** — `maskClientForLlm` / `redactPii` strip phones, MRNs, emails from tool results where possible.
2. **Human-in-the-loop writes** — address updates create `pending_changes` before CareOS mutation.
3. **Auditability** — every tool call appends a row to `data/audit.jsonl` (timestamp, tool, args hash, status).
4. **Least privilege** — MCP tools call a narrow CareOS API surface; no raw DB access from the LLM.
5. **Optional auth** — set `CAREOPS_MCP_TOKEN` and `MCP_AUTH_TOKEN` to the same value to require a token.

## Relevant frameworks (orientation, not legal advice)

- Australian Privacy Principles (APPs) under the Privacy Act 1988
- Healthcare information security / clinical governance themes (access control, audit, least privilege)

## Demo vs production

| Demo | Production would add |
|---|---|
| JSON file store | Managed DB + encryption at rest |
| Local stdio MCP | Network MCP + OAuth / SSO |
| Heuristic document extract | Approved OCR + clinical coding review |
| Shared audit file | Immutable, access-controlled audit stream |
