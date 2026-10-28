import { beforeEach, describe, expect, it, vi } from "vitest";
import { careos } from "../src/careos/client.js";
import { checkComplianceGaps, searchClientContext } from "../src/pipelines/compliance.js";
import { makeClient, makeCompliance } from "./fixtures.js";

vi.mock("../src/careos/client.js", () => ({
  careos: {
    listCompliance: vi.fn(),
    listClients: vi.fn(),
  },
}));

describe("checkComplianceGaps", () => {
  beforeEach(() => {
    vi.mocked(careos.listClients).mockResolvedValue({
      items: [makeClient({ cl_id: "CL-1", full_nm: "Margaret Chen", phone_mobile: "0412 111 222" })],
    });
  });

  it("sorts by severity then due date and counts overdue items", async () => {
    vi.mocked(careos.listCompliance).mockResolvedValue({
      items: [
        makeCompliance({ item_id: "low", severity: "low", due_dt: "2099-05-01", cl_id: "missing" }),
        makeCompliance({ item_id: "high-late", severity: "high", due_dt: "2099-01-01", cl_id: "CL-1" }),
        makeCompliance({ item_id: "high-early", severity: "high", due_dt: "2020-01-01", cl_id: "CL-1" }),
        makeCompliance({ item_id: "med", severity: "medium", due_dt: "2020-06-01", cl_id: "CL-1" }),
      ],
    });

    const report = await checkComplianceGaps();
    expect(careos.listCompliance).toHaveBeenCalledWith(true);
    expect(report.items.map((item) => item.item_id)).toEqual(["high-early", "high-late", "med", "low"]);
    expect(report.open_count).toBe(4);
    expect(report.overdue_count).toBe(2);
    expect(report.items[0].overdue).toBe(true);
    expect(report.items[1].overdue).toBe(false);
    expect(report.items[0].client).toMatchObject({ full_nm: "Margaret Chen", phone_mobile: "[REDACTED_PHONE]" });
    expect(report.items[3].client).toEqual({ cl_id: "missing", full_nm: "unknown" });
    expect(report.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("filters by severity and orders equal severities by date", async () => {
    vi.mocked(careos.listCompliance).mockResolvedValue({
      items: [
        makeCompliance({ item_id: "b", severity: "medium", due_dt: "2024-02-02", cl_id: "CL-1" }),
        makeCompliance({ item_id: "a", severity: "medium", due_dt: "2024-01-01", cl_id: "CL-1" }),
      ],
    });
    const report = await checkComplianceGaps("medium");
    expect(report.items.map((item) => item.item_id)).toEqual(["a", "b"]);
    expect(report.items.every((item) => item.severity === "medium")).toBe(true);
  });
});

describe("searchClientContext", () => {
  const clients = [
    makeClient({ cl_id: "CL-A", full_nm: "Alpha Unique", addr_suburb: "North", notes_internal: "quiet" }),
    makeClient({ cl_id: "CL-BETA", full_nm: "Other", addr_suburb: "North", notes_internal: "quiet" }),
    makeClient({ cl_id: "CL-C", full_nm: "Other", addr_suburb: "Zedtown", notes_internal: "quiet" }),
    makeClient({ cl_id: "CL-D", full_nm: "Other", addr_suburb: "North", notes_internal: "special-keyword" }),
    makeClient({ cl_id: "CL-E", full_nm: "Other", addr_suburb: "North", notes_internal: "quiet" }),
  ];

  beforeEach(() => {
    vi.mocked(careos.listClients).mockResolvedValue({ items: clients });
  });

  it.each([
    ["alpha", "CL-A"],
    ["beta", "CL-BETA"],
    ["zedtown", "CL-C"],
    ["special-keyword", "CL-D"],
  ])("matches %s", async (query, id) => {
    const result = await searchClientContext(query);
    expect(result.clients.map((c) => c.cl_id)).toEqual([id]);
    expect(result.count).toBe(1);
  });

  it("redacts PII in the query and returns no hits when nothing matches", async () => {
    const result = await searchClientContext("User@mail.test");
    expect(result.query).toBe("[REDACTED_EMAIL]");
    expect(result.count).toBe(0);
    expect(result.clients).toEqual([]);
  });
});
