import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { careos } from "../src/careos/client.js";
import { checkComplianceGaps, searchClientContext } from "../src/pipelines/compliance.js";
import { ingestCareDocument, ocrCareDocument, proposeAddressUpdate } from "../src/pipelines/document-ingest.js";
import { optimizeWeeklyRoster } from "../src/pipelines/roster.js";
import { AUDIT_PATH } from "../src/shared/db.js";
import { ocrWorker } from "../src/workers/ocr-client.js";
import { main, reportCliError } from "../scripts/demo-full.js";

vi.mock("../src/careos/client.js", () => ({
  careos: {
    health: vi.fn(),
    getClient: vi.fn(),
  },
}));

vi.mock("../src/workers/ocr-client.js", () => ({
  ocrWorker: {
    health: vi.fn(),
    ensureSample: vi.fn(),
  },
}));

vi.mock("../src/pipelines/compliance.js", () => ({
  checkComplianceGaps: vi.fn(),
  searchClientContext: vi.fn(),
}));

vi.mock("../src/pipelines/document-ingest.js", () => ({
  ingestCareDocument: vi.fn(),
  ocrCareDocument: vi.fn(),
  proposeAddressUpdate: vi.fn(),
}));

vi.mock("../src/pipelines/roster.js", () => ({
  optimizeWeeklyRoster: vi.fn(),
}));

describe("demo-full", () => {
  beforeEach(() => {
    vi.mocked(careos.health).mockResolvedValue({ ok: true });
    vi.mocked(ocrWorker.health).mockResolvedValue({ ok: true, tesseract: false, mode: "demo" });
    vi.mocked(ocrWorker.ensureSample).mockResolvedValue({ path: "samples/gp-letter-aisha.png" });
    vi.mocked(checkComplianceGaps).mockResolvedValue({ open_count: 1 } as never);
    vi.mocked(searchClientContext).mockResolvedValue({ count: 1 } as never);
    vi.mocked(ingestCareDocument).mockResolvedValue({ doc_id: "DOC-1" } as never);
    vi.mocked(ocrCareDocument).mockResolvedValue({ engine: "demo" } as never);
    vi.mocked(proposeAddressUpdate).mockResolvedValue({ status: "pending_confirmation" } as never);
    vi.mocked(careos.getClient).mockResolvedValue({
      cl_id: "CL-1003",
      full_nm: "Aisha Rahman",
      addr_line1: "19 Herring Rd",
      addr_suburb: "Marsfield",
      addr_state: "NSW",
      addr_postcode: "2122",
    } as never);
    vi.mocked(optimizeWeeklyRoster).mockResolvedValue({ conflict_count: 1 } as never);
  });

  it("walks through every demo step and writes an audit row", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("CareOps full demo starting");
    expect(output).toContain("1. Health");
    expect(output).toContain("9. Roster dry-run");
    expect(output).toContain("Demo complete");
    expect(checkComplianceGaps).toHaveBeenCalledWith("high");
    expect(searchClientContext).toHaveBeenCalledWith("Eastwood");
    expect(ingestCareDocument).toHaveBeenCalledWith("DOC-1");
    expect(ocrCareDocument).toHaveBeenCalledWith("samples/gp-letter-aisha.png");
    expect(proposeAddressUpdate).toHaveBeenCalledTimes(2);
    expect(optimizeWeeklyRoster).toHaveBeenCalledWith("Eastwood");
    const audit = readFileSync(AUDIT_PATH, "utf8");
    expect(audit).toContain("demo_full");
    expect(audit).toContain("full walkthrough completed");
    log.mockRestore();
  });

  it("propagates a failed health check", async () => {
    vi.mocked(careos.health).mockRejectedValueOnce(new Error("down"));
    await expect(main()).rejects.toThrow("down");
  });

  it("reports CLI errors by exiting", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    reportCliError("failed");
    expect(error).toHaveBeenCalledWith("failed");
    expect(exit).toHaveBeenCalledWith(1);
    error.mockRestore();
    exit.mockRestore();
  });
});
