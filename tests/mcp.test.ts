import { readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { careos } from "../src/careos/client.js";
import { createServer } from "../src/mcp/index.js";
import { checkComplianceGaps, searchClientContext } from "../src/pipelines/compliance.js";
import { ingestCareDocument, ocrCareDocument, proposeAddressUpdate } from "../src/pipelines/document-ingest.js";
import { optimizeWeeklyRoster } from "../src/pipelines/roster.js";
import { AUDIT_PATH } from "../src/shared/db.js";

vi.mock("../src/careos/client.js", () => ({
  careos: {
    health: vi.fn(),
    listClients: vi.fn(),
    listVisits: vi.fn(),
    listCompliance: vi.fn(),
    listDocuments: vi.fn(),
    applyPendingChange: vi.fn(),
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

function textOf(result: { content?: unknown }): string {
  const content = result.content as Array<{ text?: string }>;
  return content[0]?.text ?? "";
}

async function connect() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "careops-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    server,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe("CareOps MCP server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(AUDIT_PATH, { force: true });
    delete process.env.CAREOPS_MCP_TOKEN;
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_ACTOR;
  });

  afterEach(() => {
    delete process.env.CAREOPS_MCP_TOKEN;
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_ACTOR;
  });

  it("lists tools and serves the system map", async () => {
    const session = await connect();
    const tools = await session.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "apply_pending_change",
      "check_compliance_gaps",
      "ingest_care_document",
      "ocr_care_document",
      "optimize_weekly_roster",
      "run_sync_pipeline",
      "search_client_context",
      "update_client_address",
    ]);
    const resource = await session.client.readResource({ uri: "careops://docs/system-map" });
    expect(JSON.stringify(resource)).toContain("pending_changes");
    await session.close();
  });

  it("audits successful tool calls and forwards arguments", async () => {
    vi.mocked(searchClientContext).mockResolvedValue({ query: "Chen", count: 1, clients: [] });
    vi.mocked(checkComplianceGaps).mockResolvedValue({ generated_at: "t", open_count: 0, overdue_count: 0, items: [] });
    vi.mocked(ingestCareDocument).mockResolvedValue({ doc_id: "DOC-1" } as never);
    vi.mocked(ocrCareDocument).mockResolvedValue({ engine: "demo" } as never);
    vi.mocked(proposeAddressUpdate).mockResolvedValue({ status: "pending_confirmation" } as never);
    vi.mocked(careos.applyPendingChange).mockResolvedValue({ change: { change_id: "abc" } } as never);
    vi.mocked(optimizeWeeklyRoster).mockResolvedValue({ conflict_count: 2 } as never);
    process.env.MCP_ACTOR = "ops";

    const session = await connect();
    const search = await session.client.callTool({ name: "search_client_context", arguments: { query: "Chen" } });
    expect(JSON.parse(textOf(search))).toMatchObject({ count: 1 });
    expect(searchClientContext).toHaveBeenCalledWith("Chen");

    await session.client.callTool({ name: "check_compliance_gaps", arguments: { severity: "high" } });
    expect(checkComplianceGaps).toHaveBeenCalledWith("high");
    await session.client.callTool({ name: "check_compliance_gaps", arguments: {} });
    expect(checkComplianceGaps).toHaveBeenCalledWith(undefined);

    await session.client.callTool({ name: "ingest_care_document", arguments: { doc_id: "DOC-1" } });
    expect(ingestCareDocument).toHaveBeenCalledWith("DOC-1");
    await session.client.callTool({ name: "ocr_care_document", arguments: { image_path: "samples/a.png" } });
    expect(ocrCareDocument).toHaveBeenCalledWith("samples/a.png");

    await session.client.callTool({
      name: "update_client_address",
      arguments: { cl_id: "C", addr_line1: "1", addr_suburb: "S", addr_postcode: "2000" },
    });
    expect(proposeAddressUpdate).toHaveBeenCalledWith({
      cl_id: "C",
      addr_line1: "1",
      addr_suburb: "S",
      addr_postcode: "2000",
      addr_state: "NSW",
      confirm: false,
    });
    await session.client.callTool({
      name: "update_client_address",
      arguments: {
        cl_id: "C",
        addr_line1: "1",
        addr_suburb: "S",
        addr_postcode: "2000",
        addr_state: "VIC",
        doc_id: "DOC-9",
        confirm: true,
      },
    });

    await session.client.callTool({
      name: "apply_pending_change",
      arguments: { change_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(careos.applyPendingChange).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    await session.client.callTool({ name: "optimize_weekly_roster", arguments: { zone: "Eastwood" } });
    expect(optimizeWeeklyRoster).toHaveBeenCalledWith("Eastwood");

    const lines = readFileSync(AUDIT_PATH, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ actor: "ops", tool: "search_client_context", status: "ok" });
    expect(lines[0].args_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(lines[0].detail).toBeUndefined();
    await session.close();
  });

  it("audits tool failures for Error and non-Error throws", async () => {
    vi.mocked(searchClientContext).mockRejectedValueOnce(new Error("boom"));
    const session = await connect();
    const errorResult = await session.client.callTool({ name: "search_client_context", arguments: { query: "x" } });
    expect(errorResult.isError).toBe(true);
    expect(textOf(errorResult)).toBe("boom");

    vi.mocked(searchClientContext).mockRejectedValueOnce("plain");
    const plain = await session.client.callTool({ name: "search_client_context", arguments: { query: "y" } });
    expect(textOf(plain)).toBe("plain");

    const lines = readFileSync(AUDIT_PATH, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.detail)).toEqual(["boom", "plain"]);
    expect(lines.every((line) => line.actor === "claude" && line.status === "error")).toBe(true);
    await session.close();
  });

  it("rejects a bad token before writing an audit row", async () => {
    process.env.CAREOPS_MCP_TOKEN = "secret";
    process.env.MCP_AUTH_TOKEN = "nope";
    vi.mocked(searchClientContext).mockResolvedValue({ query: "x", count: 0, clients: [] });
    const session = await connect();
    const result = await session.client.callTool({ name: "search_client_context", arguments: { query: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unauthorized/);
    expect(searchClientContext).not.toHaveBeenCalled();
    await session.close();

    process.env.MCP_AUTH_TOKEN = "secret";
    const ok = await connect();
    const allowed = await ok.client.callTool({ name: "search_client_context", arguments: { query: "x" } });
    expect(allowed.isError).toBeFalsy();
    await ok.close();
  });

  it("runs the sync pipeline as a dry run and as a live check", async () => {
    vi.mocked(careos.health).mockResolvedValue({ ok: true });
    vi.mocked(careos.listClients).mockResolvedValue({ items: [{}, {}] } as never);
    vi.mocked(careos.listVisits).mockResolvedValue({ items: [{}] } as never);
    vi.mocked(careos.listCompliance).mockResolvedValue({ items: [{}, {}, {}] } as never);
    vi.mocked(careos.listDocuments).mockResolvedValue({ items: [] } as never);

    const session = await connect();
    const dry = JSON.parse(textOf(await session.client.callTool({ name: "run_sync_pipeline", arguments: {} })));
    expect(dry).toMatchObject({
      dry_run: true,
      careos: { ok: true },
      counts: { clients: 2, visits: 1, open_compliance: 3, documents: 0 },
      actions_taken: [],
    });
    expect(careos.listCompliance).toHaveBeenCalledWith(true);

    const live = JSON.parse(
      textOf(await session.client.callTool({ name: "run_sync_pipeline", arguments: { dry_run: false } })),
    );
    expect(live.dry_run).toBe(false);
    expect(live.actions_taken[0]).toMatch(/Would enqueue/);
    await session.close();
  });
});
