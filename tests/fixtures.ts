import type {
  CareDocument,
  ClientRecord,
  ComplianceItem,
  PendingChange,
  VisitSlot,
} from "../src/shared/types.js";

export function makeClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    cl_id: "CL-1001",
    full_nm: "Margaret Chen",
    dob: "1942-03-14",
    addr_line1: "12 Hillview Rd",
    addr_suburb: "Eastwood",
    addr_postcode: "2122",
    addr_state: "NSW",
    mrn: null,
    care_type: "inpatient",
    phone_mobile: "0412 345 678",
    emergency_contact: "David Chen 0499 111 222",
    notes_internal: "Prefers Cantonese-speaking nurses.",
    active_flg: true,
    ...overrides,
  };
}

export function makeVisit(overrides: Partial<VisitSlot> = {}): VisitSlot {
  return {
    slot_id: "VS-1",
    cl_id: "CL-1001",
    carer_nm: "Priya Nair",
    start_ts: "2026-05-01T09:00:00.000Z",
    end_ts: "2026-05-01T10:00:00.000Z",
    zone: "Eastwood",
    status: "planned",
    ...overrides,
  };
}

export function makeCompliance(overrides: Partial<ComplianceItem> = {}): ComplianceItem {
  return {
    item_id: "CMP-1",
    cl_id: "CL-1001",
    checklist_cd: "HC-RISK",
    title: "Falls risk reassessment",
    due_dt: "2020-01-01",
    done_flg: false,
    severity: "high",
    ...overrides,
  };
}

export function makeDocument(overrides: Partial<CareDocument> = {}): CareDocument {
  return {
    doc_id: "DOC-1",
    cl_id: "CL-1003",
    doc_type: "gp_letter",
    filename: "gp-letter-aisha.txt",
    raw_text: "Re: Aisha Rahman\nPlease update residential address to 19 Herring Rd, Marsfield NSW 2122.",
    ingested_at: "2026-01-01T00:00:00.000Z",
    extracted: null,
    applied_flg: false,
    ...overrides,
  };
}

export function makeChange(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    change_id: "11111111-1111-1111-1111-111111111111",
    tool: "update_client_address",
    payload: { cl_id: "CL-1003" },
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    applied_at: null,
    ...overrides,
  };
}
