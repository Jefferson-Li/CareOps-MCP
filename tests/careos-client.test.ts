import { afterEach, describe, expect, it, vi } from "vitest";
import { careOsBaseUrl, careOsRequest, careos } from "../src/careos/client.js";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("careos client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CAREOS_URL;
  });

  it("defaults the base URL and reads CAREOS_URL", () => {
    expect(careOsBaseUrl()).toBe("http://127.0.0.1:3847");
    process.env.CAREOS_URL = "http://careos.test:9";
    expect(careOsBaseUrl()).toBe("http://careos.test:9");
  });

  it("calls each endpoint and merges headers", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true, items: [], change_id: "c" }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CAREOS_URL = "http://careos.test";

    await careos.health();
    await careos.listClients();
    await careos.getClient("a/b");
    await careos.listVisits();
    await careos.listCompliance();
    await careos.listCompliance(true);
    await careos.listCompliance(false);
    await careos.listDocuments();
    await careos.getDocument("doc id");
    await careos.extractDocument("DOC-1");
    await careos.createPendingChange("update_client_address", { cl_id: "CL-1" });
    await careos.applyPendingChange("id 1");
    await careos.listPendingChanges();
    await careOsRequest("/custom", { method: "PUT", headers: { "X-Trace": "1" } });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("http://careos.test/health");
    expect(urls).toContain("http://careos.test/v1/clients/a%2Fb");
    expect(urls).toContain("http://careos.test/v1/compliance?open=1");
    expect(urls).toContain("http://careos.test/v1/compliance");
    expect(urls).toContain("http://careos.test/v1/documents/doc%20id");
    expect(urls).toContain("http://careos.test/v1/documents/DOC-1/extract");
    expect(urls).toContain("http://careos.test/v1/pending-changes/id%201/apply");
    expect(urls).toContain("http://careos.test/custom");

    const healthInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(healthInit.headers).toMatchObject({ "Content-Type": "application/json" });
    const custom = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(custom.headers).toMatchObject({ "Content-Type": "application/json", "X-Trace": "1" });
    const create = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/v1/pending-changes"));
    expect(JSON.parse(String((create?.[1] as RequestInit).body))).toEqual({
      tool: "update_client_address",
      payload: { cl_id: "CL-1" },
    });
  });

  it("throws the CareOS error message or a status fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { error: "client_not_found" })),
    );
    await expect(careos.getClient("missing")).rejects.toThrow("client_not_found");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, {})),
    );
    await expect(careos.health()).rejects.toThrow("CareOS HTTP 500");
  });
});
