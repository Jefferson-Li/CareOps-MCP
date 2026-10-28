import * as http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const g = vi.hoisted(() => ({
  direct: false,
  serveCalls: [] as unknown[],
}));

vi.mock("../src/shared/entrypoint.js", () => ({
  isDirectRun: () => g.direct,
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: (factory: unknown) => {
    g.serveCalls.push(factory);
    return { close: async () => {} };
  },
}));

vi.mock("../src/careos/client.js", () => ({
  careos: {
    health: vi.fn(async () => ({ ok: true })),
    getClient: vi.fn(async () => ({
      cl_id: "CL-1003",
      full_nm: "Aisha Rahman",
      addr_line1: "19 Herring Rd",
      addr_suburb: "Marsfield",
      addr_state: "NSW",
      addr_postcode: "2122",
    })),
  },
}));

vi.mock("../src/workers/ocr-client.js", () => ({
  ocrWorker: {
    health: vi.fn(async () => ({ ok: true, tesseract: false, mode: "demo" })),
    ensureSample: vi.fn(async () => ({ path: "samples/gp-letter-aisha.png" })),
  },
}));

vi.mock("../src/pipelines/compliance.js", () => ({
  checkComplianceGaps: vi.fn(async () => ({ open_count: 0 })),
  searchClientContext: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("../src/pipelines/document-ingest.js", () => ({
  ingestCareDocument: vi.fn(async () => ({ doc_id: "DOC-1" })),
  ocrCareDocument: vi.fn(async () => ({ engine: "demo" })),
  proposeAddressUpdate: vi.fn(async () => ({ status: "pending_confirmation" })),
}));

vi.mock("../src/pipelines/roster.js", () => ({
  optimizeWeeklyRoster: vi.fn(async () => ({ conflict_count: 0 })),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    async connect() {}
    async listTools() {
      return { tools: [{ name: "check_compliance_gaps" }] };
    }
    async callTool() {
      return { content: [] };
    }
    async close() {}
  },
}));

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    constructor(_opts: unknown) {}
  },
}));

describe("direct-run entrypoints", () => {
  beforeEach(() => {
    g.direct = false;
    g.serveCalls.length = 0;
    vi.resetModules();
  });

  it("does not boot on import and boots when the file is the entrypoint", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
    const listen = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (
      this: http.Server,
      ...args: unknown[]
    ) {
      const cb = args.find((arg) => typeof arg === "function") as (() => void) | undefined;
      cb?.();
      return this;
    });

    g.direct = false;
    await import("../src/careos/server.ts");
    await import("../src/careos/seed.ts");
    await import("../src/mcp/index.ts");
    await import("../scripts/demo-compliance.ts");
    await import("../scripts/demo-full.ts");
    await import("../scripts/demo-mcp-client.ts");
    expect(listen).not.toHaveBeenCalled();
    expect(g.serveCalls).toHaveLength(0);

    g.direct = true;
    vi.resetModules();
    await import("../src/careos/server.ts");
    await import("../src/careos/seed.ts");
    await import("../src/mcp/index.ts");
    await import("../scripts/demo-compliance.ts");
    await import("../scripts/demo-full.ts");
    await import("../scripts/demo-mcp-client.ts");

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
      expect(g.serveCalls.length).toBeGreaterThan(0);
      expect(logs.join("\n")).toContain("Seeded CareOS database");
      expect(logs.join("\n")).toContain("stdio");
      expect(logs.join("\n")).toContain("Demo complete");
      expect(logs.join("\n")).toContain("MCP stdio demo OK");
    });
    expect(typeof g.serveCalls[0]).toBe("function");
    listen.mockRestore();
  });
});
