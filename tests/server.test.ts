import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Server, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedDb } from "../src/careos/seed.js";
import {
  createCareOsServer,
  errorMessage,
  handleCareOsRequest,
  listenUrl,
  routes,
  startCareOsServer,
  tryServeStatic,
} from "../src/careos/server.js";
import { DB_PATH, loadDb, saveDb } from "../src/shared/db.js";
import { makeClient, makeDocument, makeVisit } from "./fixtures.js";

const webRoot = join(process.cwd(), "web");

class FakeRes {
  statusCode = 0;
  headers: Record<string, unknown> = {};
  body: string | Buffer = "";
  writeHead(status: number, headers?: Record<string, unknown>) {
    this.statusCode = status;
    this.headers = headers ?? {};
    return this;
  }
  end(body?: string | Buffer) {
    this.body = body ?? "";
    return this;
  }
}

function asRes(res: FakeRes): ServerResponse {
  return res as unknown as ServerResponse;
}

function fakeReq(opts: { method: string; url: string | undefined; chunks?: Buffer[]; error?: unknown }): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = opts.method;
  req.url = opts.url as string;
  queueMicrotask(() => {
    if (opts.error !== undefined) {
      req.emit("error", opts.error);
      return;
    }
    for (const chunk of opts.chunks ?? []) req.emit("data", chunk);
    req.emit("end");
  });
  return req;
}

async function withServer(run: (base: string) => Promise<void>) {
  const server = createCareOsServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function api(base: string, method: string, path: string, body?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, text, headers: res.headers };
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("careos server helpers", () => {
  it("formats errors and listen URLs", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(listenUrl("0.0.0.0", 3847)).toBe("http://127.0.0.1:3847/");
    expect(listenUrl("127.0.0.1", 9)).toBe("http://127.0.0.1:9/");
  });

  it("logs loopback and wildcard bind addresses without opening a port", () => {
    const logs: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
    const listen = vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, ...args: unknown[]) {
      const cb = args.find((arg) => typeof arg === "function") as (() => void) | undefined;
      cb?.();
      return this;
    });
    try {
      delete process.env.CAREOS_HOST;
      delete process.env.CAREOS_PORT;
      startCareOsServer();
      expect(listen).toHaveBeenLastCalledWith(3847, "127.0.0.1", expect.any(Function));
      expect(logs.join("\n")).toContain("http://127.0.0.1:3847");

      logs.length = 0;
      process.env.CAREOS_HOST = "0.0.0.0";
      process.env.CAREOS_PORT = "4123";
      startCareOsServer();
      expect(listen).toHaveBeenLastCalledWith(4123, "0.0.0.0", expect.any(Function));
      expect(logs.join("\n")).toContain("listening on http://0.0.0.0:4123");
      expect(logs.join("\n")).toContain("http://127.0.0.1:4123/");
    } finally {
      delete process.env.CAREOS_HOST;
      delete process.env.CAREOS_PORT;
      listen.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("static files", () => {
  afterEach(() => {
    rmSync(join(webRoot, "unit-probe.bin"), { force: true });
    rmSync(join(webRoot, "unit-empty-dir"), { recursive: true, force: true });
  });

  it("serves known types, rejects traversal, and skips directories", () => {
    const index = new FakeRes();
    expect(tryServeStatic("/", asRes(index))).toBe(true);
    expect(index.body.toString()).toContain("Test Console");
    expect(String(index.headers["Content-Type"])).toContain("text/html");

    const css = new FakeRes();
    expect(tryServeStatic("/web/styles.css", asRes(css))).toBe(true);
    expect(String(css.headers["Content-Type"])).toContain("text/css");

    const js = new FakeRes();
    expect(tryServeStatic("/app.js", asRes(js))).toBe(true);
    expect(String(js.headers["Content-Type"])).toContain("javascript");

    writeFileSync(join(webRoot, "unit-probe.bin"), "abc");
    const bin = new FakeRes();
    expect(tryServeStatic("/unit-probe.bin", asRes(bin))).toBe(true);
    expect(bin.headers["Content-Type"]).toBe("application/octet-stream");
    expect(bin.body.toString()).toBe("abc");

    expect(tryServeStatic("/../../package.json", asRes(new FakeRes()))).toBe(false);
    expect(tryServeStatic("/missing-file.html", asRes(new FakeRes()))).toBe(false);
    expect(tryServeStatic("", asRes(new FakeRes()))).toBe(false);
    mkdirSync(join(webRoot, "unit-empty-dir"));
    expect(tryServeStatic("/unit-empty-dir", asRes(new FakeRes()))).toBe(false);
  });
});

describe("careos http api", () => {
  beforeEach(() => {
    const db = buildSeedDb();
    db.clients.push(makeClient({ cl_id: "A B", full_nm: "Space Name" }));
    saveDb(db);
    delete process.env.OCR_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OCR_URL;
  });

  it("serves health, options, static pages, and unknown routes", async () => {
    await withServer(async (base) => {
      const health = await api(base, "GET", "/health");
      expect(health.status).toBe(200);
      expect(health.data).toEqual({ ok: true, service: "careos-mock" });

      const options = await fetch(`${base}/health`, { method: "OPTIONS" });
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe("*");
      expect(options.headers.get("access-control-allow-methods")).toContain("PATCH");

      const page = await api(base, "GET", "/");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.text).toContain("Test Console");

      const css = await api(base, "GET", "/styles.css");
      expect(css.headers.get("content-type")).toContain("text/css");
      const script = await api(base, "GET", "/app.js");
      expect(script.headers.get("content-type")).toContain("javascript");

      const missing = await api(base, "GET", "/no-such");
      expect(missing.status).toBe(404);
      expect(missing.data).toMatchObject({ error: "not_found", path: "/no-such" });
      expect((await api(base, "POST", "/health", "{}")).status).toBe(404);
      expect((await api(base, "GET", "/../../package.json")).status).toBe(404);
    });
  });

  it("lists and updates clients, including decoded ids", async () => {
    await withServer(async (base) => {
      const list = await api(base, "GET", "/v1/clients");
      expect(list.status).toBe(200);
      expect((list.data as { items: unknown[] }).items.length).toBeGreaterThan(1);

      const one = await api(base, "GET", "/v1/clients/CL-1001");
      expect(one.status).toBe(200);
      expect(one.data).toMatchObject({ full_nm: "Margaret Chen" });
      expect((await api(base, "GET", "/v1/clients/missing")).status).toBe(404);
      expect((await api(base, "GET", "/v1/clients/A%20B")).data).toMatchObject({ full_nm: "Space Name" });

      const patched = await api(
        base,
        "PATCH",
        "/v1/clients/CL-1003",
        JSON.stringify({
          addr_line1: "19 Herring Rd",
          addr_suburb: "Marsfield",
          addr_postcode: "2122",
          addr_state: "NSW",
          phone_mobile: "0400 000 000",
          notes_internal: "moved",
          full_nm: "Hacker",
        }),
      );
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({
        full_nm: "Aisha Rahman",
        addr_line1: "19 Herring Rd",
        notes_internal: "moved",
      });

      const untouched = await api(base, "PATCH", "/v1/clients/CL-1001", "null");
      expect(untouched.status).toBe(200);
      expect(untouched.data).toMatchObject({ addr_line1: "12 Hillview Rd" });
      expect((await api(base, "PATCH", "/v1/clients/missing", "{}")).status).toBe(404);
      expect((await api(base, "PATCH", "/v1/clients/CL-1001")).data).toMatchObject({ cl_id: "CL-1001" });
    });
  });

  it("filters compliance, lists visits, and reports roster conflicts", async () => {
    const db = buildSeedDb();
    db.visits = [
      makeVisit({ slot_id: "LATE", carer_nm: "Priya", start_ts: "2026-05-03T09:00:00.000Z", end_ts: "2026-05-03T10:00:00.000Z", zone: "Eastwood" }),
      makeVisit({ slot_id: "A", carer_nm: "Priya", start_ts: "2026-05-01T09:00:00.000Z", end_ts: "2026-05-01T10:00:00.000Z", zone: "Eastwood" }),
      makeVisit({ slot_id: "B", carer_nm: "Priya", start_ts: "2026-05-01T09:30:00.000Z", end_ts: "2026-05-01T10:30:00.000Z", zone: "Eastwood" }),
      makeVisit({ slot_id: "C", carer_nm: "Priya", start_ts: "2026-05-01T12:00:00.000Z", end_ts: "2026-05-01T13:00:00.000Z", zone: "Eastwood" }),
      makeVisit({ slot_id: "D", carer_nm: "Tom", start_ts: "2026-05-01T09:00:00.000Z", end_ts: "2026-05-01T10:00:00.000Z", zone: "Ryde" }),
      makeVisit({ slot_id: "E", carer_nm: "Priya", start_ts: "2026-05-02T08:00:00.000Z", end_ts: "2026-05-02T09:00:00.000Z", zone: "Eastwood" }),
    ];
    saveDb(db);

    await withServer(async (base) => {
      const open = await api(base, "GET", "/v1/compliance?open=1");
      const all = await api(base, "GET", "/v1/compliance");
      const other = await api(base, "GET", "/v1/compliance?open=0");
      expect((open.data as { items: unknown[] }).items.length).toBe(3);
      expect((all.data as { items: unknown[] }).items.length).toBe(4);
      expect((other.data as { items: unknown[] }).items).toHaveLength(4);

      expect((await api(base, "GET", "/v1/visits")).status).toBe(200);

      const conflicts = await api(base, "GET", "/v1/demo/roster?zone=Eastwood");
      expect(conflicts.data).toMatchObject({ zone: "Eastwood", visit_count: 5, suggestion: expect.stringMatching(/Dry-run/) });
      expect((conflicts.data as { conflicts: unknown[] }).conflicts).toHaveLength(1);

      const clear = await api(base, "GET", "/v1/demo/roster?zone=Ryde");
      expect(clear.data).toMatchObject({ visit_count: 1, suggestion: "No carer overlaps detected." });
      expect((await api(base, "GET", "/v1/demo/roster?zone=eastwood")).data).toMatchObject({ visit_count: 0 });
      expect((await api(base, "GET", "/v1/demo/roster")).data).toMatchObject({ zone: "all", visit_count: 6 });
      expect((await api(base, "GET", "/v1/demo/roster?zone=")).data).toMatchObject({ zone: "all" });
    });
  });

  it("extracts document fields and stores them", async () => {
    const db = buildSeedDb();
    db.documents.push(
      makeDocument({ doc_id: "DOC-EMPTY", raw_text: "Nothing structured here.", cl_id: null }),
    );
    saveDb(db);
    await withServer(async (base) => {
      expect((await api(base, "GET", "/v1/documents")).status).toBe(200);
      expect((await api(base, "GET", "/v1/documents/DOC-1")).data).toMatchObject({ doc_id: "DOC-1" });
      expect((await api(base, "GET", "/v1/documents/missing")).status).toBe(404);

      const extracted = await api(base, "POST", "/v1/documents/DOC-1/extract", "{}");
      expect(extracted.status).toBe(200);
      expect(extracted.data).toMatchObject({
        extracted: {
          proposed_address: "19 Herring Rd, Marsfield NSW 2122",
          phone: "0433 222 111",
          mrn: "430009876",
          client_name: "Aisha Rahman",
        },
      });
      const empty = await api(base, "POST", "/v1/documents/DOC-EMPTY/extract", "{}");
      expect((empty.data as { extracted: object }).extracted).toEqual({});
      expect((await api(base, "POST", "/v1/documents/missing/extract", "{}")).status).toBe(404);
    });
  });

  it("creates and applies pending changes, including partial and failed applies", async () => {
    await withServer(async (base) => {
      const created = await api(
        base,
        "POST",
        "/v1/pending-changes",
        JSON.stringify({
          tool: "update_client_address",
          payload: {
            cl_id: "CL-1003",
            addr_line1: "19 Herring Rd",
            addr_suburb: "Marsfield",
            addr_postcode: "2122",
            addr_state: "NSW",
            doc_id: "DOC-1",
          },
        }),
      );
      expect(created.status).toBe(201);
      const id = (created.data as { change_id: string }).change_id;
      const applied = await api(base, "POST", `/v1/pending-changes/${encodeURIComponent(id)}/apply`, "{}");
      expect(applied.status).toBe(200);
      expect(applied.data).toMatchObject({
        change: { status: "applied" },
        client: { addr_line1: "19 Herring Rd", addr_suburb: "Marsfield" },
      });
      expect(loadDb().documents.find((d) => d.doc_id === "DOC-1")?.applied_flg).toBe(true);
      expect((await api(base, "POST", `/v1/pending-changes/${id}/apply`, "{}")).status).toBe(409);
      expect((await api(base, "POST", "/v1/pending-changes/missing/apply", "{}")).status).toBe(404);

      const partial = await api(
        base,
        "POST",
        "/v1/pending-changes",
        JSON.stringify({
          tool: "update_client_address",
          payload: { cl_id: "CL-1001", addr_line1: "99 New St", addr_suburb: "", doc_id: "" },
        }),
      );
      const partialId = (partial.data as { change_id: string }).change_id;
      expect((await api(base, "POST", `/v1/pending-changes/${partialId}/apply`, "{}")).status).toBe(200);
      const updated = loadDb().clients.find((c) => c.cl_id === "CL-1001");
      expect(updated?.addr_line1).toBe("99 New St");
      expect(updated?.addr_suburb).toBe("Eastwood");

      const missingDoc = await api(
        base,
        "POST",
        "/v1/pending-changes",
        JSON.stringify({
          tool: "update_client_address",
          payload: { cl_id: "CL-1002", doc_id: "DOC-MISSING" },
        }),
      );
      expect(
        (await api(base, "POST", `/v1/pending-changes/${(missingDoc.data as { change_id: string }).change_id}/apply`, "{}"))
          .status,
      ).toBe(200);

      const missingClient = await api(
        base,
        "POST",
        "/v1/pending-changes",
        JSON.stringify({ tool: "update_client_address", payload: { cl_id: "NOPE", addr_line1: "1" } }),
      );
      const missingClientRes = await api(
        base,
        "POST",
        `/v1/pending-changes/${(missingClient.data as { change_id: string }).change_id}/apply`,
        "{}",
      );
      expect(missingClientRes.status).toBe(400);
      expect(missingClientRes.data).toEqual({ error: "client_not_found" });

      const badTool = await api(
        base,
        "POST",
        "/v1/pending-changes",
        JSON.stringify({ tool: "delete_everything", payload: { cl_id: "CL-1001" } }),
      );
      const badToolRes = await api(
        base,
        "POST",
        `/v1/pending-changes/${(badTool.data as { change_id: string }).change_id}/apply`,
        "{}",
      );
      expect(badToolRes.status).toBe(400);
      expect(badToolRes.data).toEqual({ error: "unsupported_tool:delete_everything" });

      const listed = await api(base, "GET", "/v1/pending-changes");
      expect((listed.data as { items: unknown[] }).items.length).toBeGreaterThan(1);
    });
  });

  it("returns config, proxies OCR, and reports worker failures", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://ocr.test") || url.startsWith("http://127.0.0.1:3850")) {
        if (url.endsWith("/health")) return jsonResponse(200, { ok: true, tesseract: false });
        const body = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
        if (body.path === "detail") return jsonResponse(500, { detail: 7 });
        if (body.path === "nodetail") return jsonResponse(500, { error: "x" });
        if (body.path === "null") return jsonResponse(500, null);
        if (body.path === "text") return jsonResponse(500, "bad");
        if (body.path === "throw-error") throw new Error("ocr down");
        if (body.path === "throw-string") throw "ocr string";
        return jsonResponse(200, { engine: "demo", text: body.path ?? "" });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    await withServer(async (base) => {
      process.env.OCR_URL = "http://ocr.test";
      const config = await api(base, "GET", "/v1/ui-config");
      expect(config.data).toMatchObject({ ocr_url: "http://ocr.test", service: "careos-mock" });

      const status = await api(base, "GET", "/v1/demo/status");
      expect(status.data).toMatchObject({ careos: { ok: true }, ocr: { ok: true }, ocr_url: "http://ocr.test" });

      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "samples/a.png" }))).data).toMatchObject({
        text: "samples/a.png",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", "null")).data).toMatchObject({
        text: "samples/gp-letter-aisha.png",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", "{}")).data).toMatchObject({
        text: "samples/gp-letter-aisha.png",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", "[]")).data).toMatchObject({
        text: "samples/gp-letter-aisha.png",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: 5 }))).data).toMatchObject({ text: "5" });

      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "detail" }))).data).toEqual({
        error: "7",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "nodetail" }))).status).toBe(502);
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "null" }))).data).toMatchObject({
        error: expect.stringMatching(/OCR HTTP 500/),
      });
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "text" }))).data).toMatchObject({
        error: expect.stringMatching(/OCR HTTP 500/),
      });
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "throw-error" }))).data).toEqual({
        error: "ocr down",
      });
      expect((await api(base, "POST", "/v1/demo/ocr", JSON.stringify({ path: "throw-string" }))).data).toEqual({
        error: "ocr string",
      });

      delete process.env.OCR_URL;
      const fallback = await api(base, "GET", "/v1/demo/status");
      expect(fallback.data).toMatchObject({ ocr_url: "http://127.0.0.1:3850" });
      expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith("http://127.0.0.1:3850/health"))).toBe(true);
    });
  });

  it("reports a non-error OCR health failure", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(":3850/health")) throw "socket gone";
      return realFetch(input, init);
    });
    await withServer(async (base) => {
      const status = await api(base, "GET", "/v1/demo/status");
      expect(status.data).toMatchObject({ ocr: { ok: false, error: "socket gone" } });
    });
  });

  it("rejects invalid JSON, request errors, and a missing URL", async () => {
    await withServer(async (base) => {
      expect((await api(base, "POST", "/v1/pending-changes", "{")).status).toBe(400);
    });

    const bad = new FakeRes();
    await handleCareOsRequest(fakeReq({ method: "POST", url: "/v1/pending-changes", error: new Error("reset") }), asRes(bad));
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(String(bad.body))).toEqual({ error: "invalid_json" });

    const split = new FakeRes();
    const raw = Buffer.from(JSON.stringify({ tool: "seed", payload: { note: "x" } }));
    await handleCareOsRequest(
      fakeReq({
        method: "POST",
        url: "/v1/pending-changes",
        chunks: [raw.subarray(0, 4), raw.subarray(4)],
      }),
      asRes(split),
    );
    expect(split.statusCode).toBe(201);

    const noUrl = new FakeRes();
    await handleCareOsRequest(fakeReq({ method: "POST", url: undefined, chunks: [] }), asRes(noUrl));
    expect(noUrl.statusCode).toBe(404);
  });

  it("falls back when roster and compliance requests have no URL", async () => {
    const roster = routes.find((route) => route.pattern === "/v1/demo/roster");
    const compliance = routes.find((route) => route.pattern === "/v1/compliance");
    const rosterRes = new FakeRes();
    const complianceRes = new FakeRes();
    await roster?.handler({ url: undefined } as IncomingMessage, asRes(rosterRes), {}, undefined);
    await compliance?.handler({ url: undefined } as IncomingMessage, asRes(complianceRes), {}, undefined);
    expect(rosterRes.statusCode).toBe(200);
    expect(JSON.parse(String(rosterRes.body)).zone).toBe("all");
    expect(complianceRes.statusCode).toBe(200);
    expect(JSON.parse(String(complianceRes.body)).items.length).toBeGreaterThan(0);
  });

  it("returns 500 when the database file is corrupt", async () => {
    writeFileSync(DB_PATH, "{not json");
    await withServer(async (base) => {
      const res = await api(base, "GET", "/v1/clients");
      expect(res.status).toBe(500);
      expect((res.data as { error: string }).error.length).toBeGreaterThan(0);
    });
  });
});
