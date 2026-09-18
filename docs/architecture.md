# CareOps architecture

See the Mermaid diagrams in [`README.md`](../README.md#architecture-scenario).

This repo layers an MCP + OCR automation surface on a mock **healthcare** CareOS API:

1. **Actors** — reviewers use the browser Test Console; agents use MCP stdio.
2. **CareOps MCP** — allowlisted tools, PII masking, audit log, optional token.
3. **CareOS** — legacy-shaped HTTP API + JSON store (`mrn`, messy field names).
4. **OCR worker** — Python FastAPI extracts address / MRN from scanned letters.
5. **Human-in-the-loop** — mutating writes go through `pending_changes` before apply.
