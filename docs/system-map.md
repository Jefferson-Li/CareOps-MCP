# CareOS system map (reverse-engineered)

This document simulates the **Rapid System Onboarding** deliverable for a healthcare provider:
enter an unfamiliar clinical platform, map entities/APIs/data flows, then sit an AI layer on top.

## Context

CareOS is the mock "primary software platform". CareOps MCP never talks to the JSON store
directly for production paths — it goes through the CareOS HTTP API so integrations stay
non-disruptive and auditable.

## Entity relationship

```
clients (cl_id)
  ├─ visits (slot_id, carer_nm, zone, start/end)
  ├─ compliance (checklist_cd, due_dt, severity)
  └─ documents (doc_type, raw_text → extracted)
         └─ pending_changes (human confirm before mutate)
```

## Field naming quirks (legacy)

| CareOS field | Meaning |
|---|---|
| `cl_id` | Client / patient id |
| `full_nm` | Display name |
| `addr_*` | Residential address parts |
| `mrn` | Medical record number (demo: 9 digits starting with 4) |
| `care_type` | `inpatient` / `outpatient` / `both` |
| `done_flg` / `active_flg` | Boolean flags |

## HTTP API

Base URL: `http://127.0.0.1:3847`

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/` | Browser Test Console |
| GET | `/v1/clients` | List |
| GET | `/v1/clients/:id` | Detail |
| PATCH | `/v1/clients/:id` | Limited address/phone/notes patch |
| GET | `/v1/visits` | Roster slots |
| GET | `/v1/compliance?open=1` | Open checklist items |
| GET | `/v1/documents` | Inbound docs |
| POST | `/v1/documents/:id/extract` | Heuristic extraction |
| POST | `/v1/pending-changes` | Queue mutation |
| POST | `/v1/pending-changes/:id/apply` | Apply after confirm |
| GET | `/v1/demo/status` | CareOS + OCR health for Test Console |
| POST | `/v1/demo/ocr` | Proxy OCR for Test Console |

## Operational bottlenecks addressed

1. **Document processing** — GP letters arrive as free text; staff re-type addresses.
2. **Scheduling** — clinicians double-booked across nearby clients.
3. **Compliance tracking** — overdue healthcare checklist items.
4. **Client address updates** — stale addresses break visit routing.

## Trust boundary

```
Claude / Cursor
    │  MCP stdio
    ▼
CareOps MCP (tool allowlist + audit.jsonl + optional token)
    │  HTTP
    ▼
CareOS mock API  ←→  OCR worker
    │
    ▼
data/careos.json
```

Mutating tools default to **pending confirmation**. Roster optimisation is **dry-run only**.
