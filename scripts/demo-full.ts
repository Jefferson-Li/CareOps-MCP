/**
 * End-to-end demo that exercises the same logic MCP tools expose.
 * Requires CareOS (:3847) and OCR worker (:3850) to be running.
 */
import { careos } from "../src/careos/client.js";
import { ocrWorker } from "../src/workers/ocr-client.js";
import { checkComplianceGaps, searchClientContext } from "../src/pipelines/compliance.js";
import { ingestCareDocument, ocrCareDocument, proposeAddressUpdate } from "../src/pipelines/document-ingest.js";
import { optimizeWeeklyRoster } from "../src/pipelines/roster.js";
import { appendAudit, hashArgs } from "../src/shared/db.js";

function step(title: string, data: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log("CareOps full demo starting…");

  const careHealth = await careos.health();
  const ocrHealth = await ocrWorker.health();
  step("1. Health", { careos: careHealth, ocr: ocrHealth });

  await ocrWorker.ensureSample();
  step("2. Compliance gaps", await checkComplianceGaps("high"));
  step("3. Search client", await searchClientContext("Eastwood"));
  step("4. Ingest DOC-1 (CareOS text)", await ingestCareDocument("DOC-1"));
  step("5. OCR sample letter (Python worker)", await ocrCareDocument("samples/gp-letter-aisha.png"));

  const pending = await proposeAddressUpdate({
    cl_id: "CL-1003",
    addr_line1: "19 Herring Rd",
    addr_suburb: "Marsfield",
    addr_postcode: "2122",
    addr_state: "NSW",
    doc_id: "DOC-1",
    confirm: false,
  });
  step("6. Pending address change", pending);

  const applied = await proposeAddressUpdate({
    cl_id: "CL-1003",
    addr_line1: "19 Herring Rd",
    addr_suburb: "Marsfield",
    addr_postcode: "2122",
    addr_state: "NSW",
    doc_id: "DOC-1",
    confirm: true,
  });
  step("7. Apply address change", applied);

  const client = await careos.getClient("CL-1003");
  step("8. Client after update", {
    cl_id: client.cl_id,
    full_nm: client.full_nm,
    address: `${client.addr_line1}, ${client.addr_suburb} ${client.addr_state} ${client.addr_postcode}`,
  });

  step("9. Roster dry-run (Eastwood)", await optimizeWeeklyRoster("Eastwood"));

  appendAudit({
    actor: "demo-full",
    tool: "demo_full",
    args_hash: hashArgs({ ok: true }),
    status: "ok",
    detail: "full walkthrough completed",
  });

  console.log("\nDemo complete. Audit appended to data/audit.jsonl");
  console.log("In Cursor: enable the `careops` MCP server from .cursor/mcp.json, then ask:");
  console.log('  "Use check_compliance_gaps and ocr_care_document on samples/gp-letter-aisha.png"');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
