import { beforeEach, describe, expect, it, vi } from "vitest";
import { careos } from "../src/careos/client.js";
import { ocrWorker } from "../src/workers/ocr-client.js";
import {
  ingestCareDocument,
  ocrCareDocument,
  parseAuAddress,
  proposeAddressUpdate,
} from "../src/pipelines/document-ingest.js";
import { makeChange, makeClient } from "./fixtures.js";

vi.mock("../src/careos/client.js", () => ({
  careos: {
    extractDocument: vi.fn(),
    getClient: vi.fn(),
    listClients: vi.fn(),
    createPendingChange: vi.fn(),
    listPendingChanges: vi.fn(),
    applyPendingChange: vi.fn(),
  },
}));

vi.mock("../src/workers/ocr-client.js", () => ({
  ocrWorker: {
    ocrPath: vi.fn(),
  },
}));

const address = {
  cl_id: "CL-2",
  addr_line1: "19 Herring Rd",
  addr_suburb: "Marsfield",
  addr_postcode: "2122",
};

describe("parseAuAddress", () => {
  it("parses a normalised Australian address", () => {
    expect(parseAuAddress("  19   Herring Rd,   Marsfield   nsw   2122.  ")).toEqual({
      addr_line1: "19 Herring Rd",
      addr_suburb: "Marsfield",
      addr_state: "NSW",
      addr_postcode: "2122",
    });
    expect(parseAuAddress("1 St, Melbourne VIC 3000")).toMatchObject({ addr_state: "VIC" });
  });

  it("returns null when the address does not match", () => {
    expect(parseAuAddress("not an address")).toBeNull();
    expect(parseAuAddress("")).toBeNull();
    expect(parseAuAddress("19 Herring Rd Marsfield NSW 2122")).toBeNull();
  });
});

describe("ingestCareDocument", () => {
  const client = makeClient({
    cl_id: "CL-2",
    full_nm: "Aisha Rahman",
    addr_line1: "3 Blaxland Rd",
    addr_suburb: "Ryde",
    addr_state: "NSW",
    addr_postcode: "2112",
  });

  beforeEach(() => {
    vi.mocked(careos.getClient).mockResolvedValue(client);
  });

  it("proposes an address when extraction matches a client", async () => {
    vi.mocked(careos.extractDocument).mockResolvedValue({
      doc_id: "DOC-1",
      cl_id: "CL-2",
      doc_type: "gp_letter",
      filename: "letter.txt",
      raw_text: "",
      ingested_at: "2026-01-01T00:00:00.000Z",
      extracted: { proposed_address: "19 Herring Rd, Marsfield NSW 2122" },
      applied_flg: false,
    });
    const result = await ingestCareDocument("DOC-1");
    expect(careos.getClient).toHaveBeenCalledWith("CL-2");
    expect(result.proposed_address).toEqual({
      addr_line1: "19 Herring Rd",
      addr_suburb: "Marsfield",
      addr_state: "NSW",
      addr_postcode: "2122",
    });
    expect(result.matched_client_id).toBe("CL-2");
    expect(result.matched_client_name).toBe("Aisha Rahman");
    expect(result.current_address).toBe("3 Blaxland Rd, Ryde NSW 2112");
    expect(result.next_step).toMatch(/confirm=false/);
  });

  it("does not auto-apply when the address or client is missing", async () => {
    vi.mocked(careos.extractDocument).mockResolvedValue({
      doc_id: "DOC-2",
      cl_id: null,
      doc_type: "other",
      filename: "note.txt",
      raw_text: "",
      ingested_at: "2026-01-01T00:00:00.000Z",
      extracted: null,
      applied_flg: false,
    });
    const empty = await ingestCareDocument("DOC-2");
    expect(careos.getClient).not.toHaveBeenCalled();
    expect(empty.extracted).toEqual({});
    expect(empty.proposed_address).toBeNull();
    expect(empty.matched_client_id).toBeNull();
    expect(empty.current_address).toBeNull();
    expect(empty.next_step).toMatch(/no auto-applyable/);

    vi.mocked(careos.extractDocument).mockResolvedValue({
      doc_id: "DOC-3",
      cl_id: "CL-2",
      doc_type: "gp_letter",
      filename: "bad.txt",
      raw_text: "",
      ingested_at: "2026-01-01T00:00:00.000Z",
      extracted: { proposed_address: "somewhere" },
      applied_flg: false,
    });
    const bad = await ingestCareDocument("DOC-3");
    expect(bad.proposed_address).toBeNull();
    expect(bad.matched_client_name).toBe("Aisha Rahman");
    expect(bad.next_step).toMatch(/no auto-applyable/);
  });
});

describe("ocrCareDocument", () => {
  beforeEach(() => {
    vi.mocked(careos.listClients).mockResolvedValue({
      items: [
        makeClient({ cl_id: "CL-1", full_nm: "Other Person" }),
        makeClient({
          cl_id: "CL-2",
          full_nm: "Aisha Rahman",
          addr_line1: "3 Blaxland Rd",
          addr_suburb: "Ryde",
          addr_state: "NSW",
          addr_postcode: "2112",
        }),
      ],
    });
  });

  it("matches a client from OCR fields and proposes the address", async () => {
    vi.mocked(ocrWorker.ocrPath).mockResolvedValue({
      engine: "tesseract",
      text: "raw letter",
      fields: {
        proposed_address: "19 Herring Rd, Marsfield NSW 2122",
        client_name: "aisha",
      },
      image_size: [900, 360],
      notes: null,
    });
    const result = await ocrCareDocument("samples/gp-letter-aisha.png");
    expect(result).toMatchObject({
      source: "python-ocr-worker",
      image_path: "samples/gp-letter-aisha.png",
      engine: "tesseract",
      image_size: [900, 360],
      notes: null,
      raw_text: "raw letter",
      matched_client_id: "CL-2",
      matched_client_name: "Aisha Rahman",
      current_address: "3 Blaxland Rd, Ryde NSW 2112",
    });
    expect(result.proposed_address?.addr_suburb).toBe("Marsfield");
    expect(result.next_step).toMatch(/confirm=false/);
  });

  it("asks for review when the name or address cannot be applied", async () => {
    vi.mocked(ocrWorker.ocrPath).mockResolvedValue({
      engine: "demo",
      text: "raw",
      fields: { client_name: "Nobody" },
      image_size: null,
      notes: "demo",
    });
    const unmatched = await ocrCareDocument("letter.png");
    expect(unmatched.matched_client_id).toBeNull();
    expect(unmatched.proposed_address).toBeNull();
    expect(unmatched.current_address).toBeNull();
    expect(unmatched.next_step).toMatch(/no auto-applyable/);

    vi.mocked(ocrWorker.ocrPath).mockResolvedValue({
      engine: "demo",
      text: "raw",
      fields: { proposed_address: "not valid" },
    });
    const noName = await ocrCareDocument("letter.png");
    expect(careos.listClients).toHaveBeenCalledTimes(1);
    expect(noName.matched_client_id).toBeNull();
    expect(noName.proposed_address).toBeNull();
  });
});

describe("proposeAddressUpdate", () => {
  beforeEach(() => {
    vi.mocked(careos.createPendingChange).mockReset();
    vi.mocked(careos.applyPendingChange).mockReset();
  });

  it("queues a pending change when confirm is false", async () => {
    vi.mocked(careos.createPendingChange).mockResolvedValue(makeChange({ change_id: "new" }));
    const result = await proposeAddressUpdate({ ...address, confirm: false });
    expect(careos.createPendingChange).toHaveBeenCalledWith("update_client_address", {
      ...address,
      addr_state: "NSW",
      doc_id: undefined,
    });
    expect(result).toMatchObject({ status: "pending_confirmation", change_id: "new" });
  });

  it("applies an existing pending change when confirm is true", async () => {
    const pending = makeChange({ change_id: "pending-id", payload: { cl_id: "CL-2" } });
    vi.mocked(careos.listPendingChanges).mockResolvedValue({
      items: [
        makeChange({ status: "applied", payload: { cl_id: "CL-2" } }),
        makeChange({ status: "pending", tool: "other", payload: { cl_id: "CL-2" } }),
        makeChange({ status: "pending", payload: { cl_id: "CL-OTHER" } }),
        pending,
      ],
    });
    vi.mocked(careos.applyPendingChange).mockResolvedValue({
      change: { ...pending, status: "applied" },
    });
    const result = await proposeAddressUpdate({
      ...address,
      addr_state: "VIC",
      doc_id: "DOC-9",
      confirm: true,
    });
    expect(careos.createPendingChange).not.toHaveBeenCalled();
    expect(careos.applyPendingChange).toHaveBeenCalledWith("pending-id");
    expect(result).toMatchObject({ status: "applied" });
  });

  it("creates a pending change before applying when none matches", async () => {
    vi.mocked(careos.listPendingChanges).mockResolvedValue({
      items: [makeChange({ status: "rejected", payload: { cl_id: "CL-2" } })],
    });
    vi.mocked(careos.createPendingChange).mockResolvedValue(makeChange({ change_id: "created" }));
    vi.mocked(careos.applyPendingChange).mockResolvedValue({
      change: makeChange({ change_id: "created", status: "applied" }),
    });
    const result = await proposeAddressUpdate({ ...address, confirm: true });
    expect(careos.createPendingChange).toHaveBeenCalled();
    expect(careos.applyPendingChange).toHaveBeenCalledWith("created");
    expect(result.status).toBe("applied");
  });
});
