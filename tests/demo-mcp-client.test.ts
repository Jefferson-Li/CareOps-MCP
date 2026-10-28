import { beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => ({
  transportOpts: [] as Array<{ command: string; args: string[]; env: Record<string, string>; stderr: string }>,
  connect: vi.fn(async () => {}),
  listTools: vi.fn(async () => ({ tools: [{ name: "check_compliance_gaps" }, { name: "ocr_care_document" }] })),
  callTool: vi.fn(async () => ({ content: [] })),
  close: vi.fn(async () => {}),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = ctor.connect;
    listTools = ctor.listTools;
    callTool = ctor.callTool;
    close = ctor.close;
  },
}));

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    constructor(opts: { command: string; args: string[]; env: Record<string, string>; stderr: string }) {
      ctor.transportOpts.push(opts);
    }
  },
}));

import { cleanEnv, main, reportCliError } from "../scripts/demo-mcp-client.js";

describe("cleanEnv", () => {
  it("copies string env values and lets extras win", () => {
    const result = cleanEnv(
      { CAREOS_URL: "http://example", MCP_ACTOR: "demo" },
      { KEEP: "yes", SKIP: 1 as unknown as string, GONE: undefined, CAREOS_URL: "old" },
    );
    expect(result.KEEP).toBe("yes");
    expect(result.SKIP).toBeUndefined();
    expect("GONE" in result).toBe(false);
    expect(result.CAREOS_URL).toBe("http://example");
    expect(result.MCP_ACTOR).toBe("demo");
  });

  it("defaults to process.env", () => {
    const result = cleanEnv({ ADDED: "1" });
    expect(result.ADDED).toBe("1");
    expect(result.PATH).toBe(process.env.PATH);
  });
});

describe("demo-mcp client", () => {
  beforeEach(() => {
    ctor.transportOpts.length = 0;
    ctor.connect.mockClear();
    ctor.listTools.mockClear();
    ctor.callTool.mockClear();
    ctor.close.mockClear();
    delete process.env.CAREOS_URL;
    delete process.env.OCR_URL;
  });

  it("launches the stdio server and calls the demo tools", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();
    expect(ctor.transportOpts[0]).toMatchObject({
      command: "npx",
      args: ["tsx", "src/mcp/index.ts"],
      stderr: "pipe",
    });
    expect(ctor.transportOpts[0].env.CAREOS_URL).toBe("http://127.0.0.1:3847");
    expect(ctor.transportOpts[0].env.OCR_URL).toBe("http://127.0.0.1:3850");
    expect(ctor.transportOpts[0].env.MCP_ACTOR).toBe("mcp-client-demo");
    expect(ctor.connect).toHaveBeenCalled();
    expect(ctor.callTool).toHaveBeenCalledWith({
      name: "check_compliance_gaps",
      arguments: { severity: "high" },
    });
    expect(ctor.callTool).toHaveBeenCalledWith({
      name: "ocr_care_document",
      arguments: { image_path: "samples/gp-letter-aisha.png" },
    });
    expect(ctor.close).toHaveBeenCalled();
    expect(log.mock.calls.map((call) => String(call[0])).join("\n")).toContain("MCP stdio demo OK");

    process.env.CAREOS_URL = "http://careos:3847";
    process.env.OCR_URL = "http://ocr:3850";
    await main();
    expect(ctor.transportOpts.at(-1)?.env.CAREOS_URL).toBe("http://careos:3847");
    expect(ctor.transportOpts.at(-1)?.env.OCR_URL).toBe("http://ocr:3850");
    log.mockRestore();
  });

  it("reports CLI errors by exiting", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    reportCliError(new Error("mcp"));
    expect(exit).toHaveBeenCalledWith(1);
    error.mockRestore();
    exit.mockRestore();
  });
});
