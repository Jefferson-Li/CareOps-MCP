/** Domain types for the mock CareOS platform (deliberately messy field names). */

export type ClientRecord = {
  cl_id: string;
  full_nm: string;
  dob: string;
  addr_line1: string;
  addr_suburb: string;
  addr_postcode: string;
  addr_state: string;
  mrn: string | null;
  care_type: "inpatient" | "outpatient" | "both";
  phone_mobile: string;
  emergency_contact: string;
  notes_internal: string;
  active_flg: boolean;
};

export type VisitSlot = {
  slot_id: string;
  cl_id: string;
  carer_nm: string;
  start_ts: string;
  end_ts: string;
  zone: string;
  status: "planned" | "completed" | "cancelled" | "conflict";
};

export type ComplianceItem = {
  item_id: string;
  cl_id: string;
  checklist_cd: string;
  title: string;
  due_dt: string;
  done_flg: boolean;
  severity: "low" | "medium" | "high";
};

export type CareDocument = {
  doc_id: string;
  cl_id: string | null;
  doc_type: "gp_letter" | "care_plan" | "incident" | "other";
  filename: string;
  raw_text: string;
  ingested_at: string;
  extracted: Record<string, string> | null;
  applied_flg: boolean;
};

export type PendingChange = {
  change_id: string;
  tool: string;
  payload: Record<string, unknown>;
  status: "pending" | "applied" | "rejected";
  created_at: string;
  applied_at: string | null;
};

export type CareOsDb = {
  clients: ClientRecord[];
  visits: VisitSlot[];
  compliance: ComplianceItem[];
  documents: CareDocument[];
  pending_changes: PendingChange[];
};

export type AuditEntry = {
  ts: string;
  actor: string;
  tool: string;
  args_hash: string;
  status: "ok" | "error" | "denied";
  detail?: string;
};
