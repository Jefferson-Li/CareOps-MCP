import { careos } from "../careos/client.js";
import { ocrWorker } from "../workers/ocr-client.js";

/** Heuristic address parse for AU-ish "12 Foo St, Suburb NSW 2000" strings. */
export function parseAuAddress(raw: string): {
  addr_line1: string;
  addr_suburb: string;
  addr_state: string;
  addr_postcode: string;
} | null {
  const cleaned = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const m = cleaned.match(/^(.+?),\s*([^,]+?)\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})$/i);
  if (!m) return null;
  return {
    addr_line1: m[1].trim(),
    addr_suburb: m[2].trim(),
    addr_state: m[3].toUpperCase(),
    addr_postcode: m[4],
  };
}

export async function ingestCareDocument(docId: string) {
  const doc = await careos.extractDocument(docId);
  const extracted = doc.extracted ?? {};
  let proposedAddress = null as ReturnType<typeof parseAuAddress>;
  if (extracted.proposed_address) {
    proposedAddress = parseAuAddress(extracted.proposed_address);
  }

  let matchedClient = null;
  if (doc.cl_id) {
    matchedClient = await careos.getClient(doc.cl_id);
  }

  return {
    doc_id: doc.doc_id,
    filename: doc.filename,
    doc_type: doc.doc_type,
    extracted,
    proposed_address: proposedAddress,
    matched_client_id: matchedClient?.cl_id ?? null,
    matched_client_name: matchedClient?.full_nm ?? null,
    current_address: matchedClient
      ? `${matchedClient.addr_line1}, ${matchedClient.addr_suburb} ${matchedClient.addr_state} ${matchedClient.addr_postcode}`
      : null,
    next_step:
      proposedAddress && matchedClient
        ? "Call update_client_address with confirm=false to create a pending change, then confirm=true (or apply_pending_change) after human review."
        : "Review extraction; no auto-applyable address found.",
  };
}

/** Call the Python OCR worker on a scanned letter image, then map to address fields. */
export async function ocrCareDocument(imagePath: string) {
  const ocr = await ocrWorker.ocrPath(imagePath);
  let proposedAddress = null as ReturnType<typeof parseAuAddress>;
  if (ocr.fields.proposed_address) {
    proposedAddress = parseAuAddress(ocr.fields.proposed_address);
  }

  let matchedClient = null;
  if (ocr.fields.client_name) {
    const { items } = await careos.listClients();
    matchedClient =
      items.find((c) =>
        c.full_nm.toLowerCase().includes(ocr.fields.client_name.toLowerCase()),
      ) ?? null;
  }

  return {
    source: "python-ocr-worker",
    image_path: imagePath,
    engine: ocr.engine,
    image_size: ocr.image_size,
    notes: ocr.notes,
    raw_text: ocr.text,
    fields: ocr.fields,
    proposed_address: proposedAddress,
    matched_client_id: matchedClient?.cl_id ?? null,
    matched_client_name: matchedClient?.full_nm ?? null,
    current_address: matchedClient
      ? `${matchedClient.addr_line1}, ${matchedClient.addr_suburb} ${matchedClient.addr_state} ${matchedClient.addr_postcode}`
      : null,
    next_step:
      proposedAddress && matchedClient
        ? "Call update_client_address with confirm=false to queue a pending change for human review."
        : "Review OCR output; no auto-applyable address found.",
  };
}

export async function proposeAddressUpdate(input: {
  cl_id: string;
  addr_line1: string;
  addr_suburb: string;
  addr_postcode: string;
  addr_state?: string;
  doc_id?: string;
  confirm: boolean;
}) {
  const payload = {
    cl_id: input.cl_id,
    addr_line1: input.addr_line1,
    addr_suburb: input.addr_suburb,
    addr_postcode: input.addr_postcode,
    addr_state: input.addr_state ?? "NSW",
    doc_id: input.doc_id,
  };

  if (!input.confirm) {
    const change = await careos.createPendingChange("update_client_address", payload);
    return {
      status: "pending_confirmation",
      change_id: change.change_id,
      payload,
      message: "Pending change created. Re-run with confirm=true or call apply_pending_change.",
    };
  }

  const existing = await careos.listPendingChanges();
  let change = existing.items.find(
    (c) =>
      c.status === "pending" &&
      c.tool === "update_client_address" &&
      c.payload.cl_id === input.cl_id,
  );
  if (!change) {
    change = await careos.createPendingChange("update_client_address", payload);
  }
  const applied = await careos.applyPendingChange(change.change_id);
  return { status: "applied", change: applied.change };
}
