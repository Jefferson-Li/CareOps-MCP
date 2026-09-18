import { randomUUID } from "node:crypto";
import { saveDb, emptyDb, ensureDataDir, DB_PATH } from "../shared/db.js";
import type { CareOsDb } from "../shared/types.js";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoAt(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function buildSeedDb(): CareOsDb {
  const db = emptyDb();

  const alice = {
    cl_id: "CL-1001",
    full_nm: "Margaret Chen",
    dob: "1942-03-14",
    addr_line1: "12 Hillview Rd",
    addr_suburb: "Eastwood",
    addr_postcode: "2122",
    addr_state: "NSW",
    mrn: null,
    care_type: "inpatient" as const,
    phone_mobile: "0412 345 678",
    emergency_contact: "David Chen 0499 111 222",
    notes_internal: "Prefers Cantonese-speaking nurses. Falls risk — shower rail installed.",
    active_flg: true,
  };

  const bob = {
    cl_id: "CL-1002",
    full_nm: "James O'Brien",
    dob: "1955-11-02",
    addr_line1: "8/44 Rowe St",
    addr_suburb: "Eastwood",
    addr_postcode: "2122",
    addr_state: "NSW",
    mrn: "430001234",
    care_type: "both" as const,
    phone_mobile: "0400 987 654",
    emergency_contact: "Sarah O'Brien 0488 333 444",
    notes_internal: "Care plan review due soon. Diabetes care plan on file.",
    active_flg: true,
  };

  const cara = {
    cl_id: "CL-1003",
    full_nm: "Aisha Rahman",
    dob: "1988-07-21",
    addr_line1: "3 Blaxland Rd",
    addr_suburb: "Ryde",
    addr_postcode: "2112",
    addr_state: "NSW",
    mrn: "430009876",
    care_type: "outpatient" as const,
    phone_mobile: "0433 222 111",
    emergency_contact: "Farid Rahman 0422 555 666",
    notes_internal: "Outpatient follow-up Wed/Fri. Address may be outdated after move.",
    active_flg: true,
  };

  db.clients.push(alice, bob, cara);

  db.visits.push(
    {
      slot_id: "VS-1",
      cl_id: alice.cl_id,
      carer_nm: "Priya Nair",
      start_ts: isoAt(1, 9, 0),
      end_ts: isoAt(1, 10, 0),
      zone: "Eastwood",
      status: "planned",
    },
    {
      slot_id: "VS-2",
      cl_id: bob.cl_id,
      carer_nm: "Priya Nair",
      start_ts: isoAt(1, 9, 30),
      end_ts: isoAt(1, 10, 30),
      zone: "Eastwood",
      status: "conflict",
    },
    {
      slot_id: "VS-3",
      cl_id: cara.cl_id,
      carer_nm: "Tom Walsh",
      start_ts: isoAt(1, 14, 0),
      end_ts: isoAt(1, 16, 0),
      zone: "Ryde",
      status: "planned",
    },
    {
      slot_id: "VS-4",
      cl_id: alice.cl_id,
      carer_nm: "Tom Walsh",
      start_ts: isoAt(2, 11, 0),
      end_ts: isoAt(2, 12, 0),
      zone: "Eastwood",
      status: "planned",
    },
  );

  db.compliance.push(
    {
      item_id: "CMP-1",
      cl_id: alice.cl_id,
      checklist_cd: "HC-RISK",
      title: "Falls risk reassessment",
      due_dt: daysFromNow(-3),
      done_flg: false,
      severity: "high",
    },
    {
      item_id: "CMP-2",
      cl_id: bob.cl_id,
      checklist_cd: "HC-PLAN",
      title: "Care plan review meeting booked",
      due_dt: daysFromNow(5),
      done_flg: false,
      severity: "medium",
    },
    {
      item_id: "CMP-3",
      cl_id: bob.cl_id,
      checklist_cd: "HC-MED",
      title: "Medication chart signed by GP",
      due_dt: daysFromNow(-1),
      done_flg: false,
      severity: "high",
    },
    {
      item_id: "CMP-4",
      cl_id: cara.cl_id,
      checklist_cd: "HC-CONSENT",
      title: "Treatment consent countersigned",
      due_dt: daysFromNow(14),
      done_flg: true,
      severity: "low",
    },
  );

  db.documents.push({
    doc_id: "DOC-1",
    cl_id: cara.cl_id,
    doc_type: "gp_letter",
    filename: "gp-letter-aisha.txt",
    raw_text: [
      "Eastwood Family Medical Centre",
      "Re: Aisha Rahman",
      "Please update residential address to 19 Herring Rd, Marsfield NSW 2122.",
      "Contact mobile remains 0433 222 111.",
      "Medical record number 430009876.",
    ].join("\n"),
    ingested_at: new Date().toISOString(),
    extracted: null,
    applied_flg: false,
  });

  db.pending_changes.push({
    change_id: randomUUID(),
    tool: "seed",
    payload: { note: "initial seed" },
    status: "applied",
    created_at: new Date().toISOString(),
    applied_at: new Date().toISOString(),
  });

  return db;
}

ensureDataDir();
const db = buildSeedDb();
saveDb(db);
console.error(`Seeded CareOS database at ${DB_PATH}`);
console.error(`Clients: ${db.clients.length}, visits: ${db.visits.length}, compliance gaps: ${db.compliance.filter((c) => !c.done_flg).length}`);
