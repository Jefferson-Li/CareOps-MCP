// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const HTML = `
  <span class="pill" id="careosPill">CareOS …</span>
  <span class="pill" id="ocrPill">OCR …</span>
  <button type="button" data-action="health">Check services</button>
  <button type="button" data-action="clients">Load lists</button>
  <button type="button" data-action="ocr">Run OCR</button>
  <button type="button" data-action="address">Propose</button>
  <button type="button" data-action="roster">Roster</button>
  <button type="button" data-action="all">All</button>
  <button type="button" data-action="nope">Nope</button>
  <pre id="log">Ready.</pre>
  <div id="clientsView" class="table-wrap empty">—</div>
  <div id="complianceView" class="table-wrap empty">—</div>
  <button type="button" id="clearLog">Clear</button>
`;

function jsonResponse(status: number, data: unknown): Response {
  const body = data === undefined ? "" : JSON.stringify(data);
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function logText(): string {
  return document.getElementById("log")?.textContent ?? "";
}

const populated = {
  careos: { ok: true },
  ocr: { ok: true },
  clients: {
    items: [
      {
        cl_id: "CL-1",
        full_nm: `A & B <c> "d"`,
        addr_line1: "1 St",
        addr_suburb: "Ryde",
        addr_state: "NSW",
        addr_postcode: "2112",
        care_type: "outpatient",
      },
    ],
  },
  compliance: { items: [{ severity: "high", cl_id: "CL-1", title: "Falls", due_dt: "2020-01-01" }] },
};

function route(url: string): Response {
  if (url.includes("/v1/demo/status")) return jsonResponse(200, { careos: populated.careos, ocr: populated.ocr });
  if (url.includes("/v1/clients/CL-1003")) {
    return jsonResponse(200, {
      full_nm: "Aisha Rahman",
      addr_line1: "19 Herring Rd",
      addr_suburb: "Marsfield",
      addr_state: "NSW",
      addr_postcode: "2122",
    });
  }
  if (url.includes("/v1/clients")) return jsonResponse(200, populated.clients);
  if (url.includes("/v1/compliance")) return jsonResponse(200, populated.compliance);
  if (url.includes("/v1/demo/ocr")) return jsonResponse(200, { engine: "demo" });
  if (url.includes("/apply")) return jsonResponse(200, { change: { status: "applied" } });
  if (url.includes("/v1/pending-changes")) return jsonResponse(201, { change_id: "abc-123" });
  if (url.includes("/v1/demo/roster")) return jsonResponse(200, { conflict_count: 1 });
  return jsonResponse(404, { error: "not_found" });
}

async function loadApp(fetchImpl: typeof fetch) {
  document.body.innerHTML = HTML;
  vi.resetModules();
  vi.stubGlobal("fetch", fetchImpl);
  return import("../web/app.js");
}

async function waitForLog(fragment: string) {
  await vi.waitFor(() => {
    expect(logText()).toContain(fragment);
  });
}

describe("test console", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the checklist and escapes client text", async () => {
    const app = await loadApp(vi.fn(async (input: RequestInfo | URL) => route(String(input))));
    await waitForLog("Health");
    expect(document.getElementById("careosPill")?.textContent).toBe("CareOS OK");
    expect(document.getElementById("careosPill")?.classList.contains("ok")).toBe(true);
    expect(document.getElementById("ocrPill")?.textContent).toBe("OCR OK");

    (document.querySelector('[data-action="clients"]') as HTMLButtonElement).click();
    await waitForLog("Open compliance");
    expect(document.getElementById("clientsView")?.textContent).toContain(`A & B <c> "d"`);
    expect(document.getElementById("clientsView")?.innerHTML).toContain("&amp;");
    expect(document.getElementById("clientsView")?.innerHTML).toContain("&lt;");
    expect(document.getElementById("complianceView")?.innerHTML).toContain("Falls");

    (document.querySelector('[data-action="ocr"]') as HTMLButtonElement).click();
    await waitForLog("OCR result");
    (document.querySelector('[data-action="address"]') as HTMLButtonElement).click();
    await waitForLog("Client CL-1003 after update");
    (document.querySelector('[data-action="roster"]') as HTMLButtonElement).click();
    await waitForLog("Roster overlaps");
    (document.querySelector('[data-action="all"]') as HTMLButtonElement).click();
    await waitForLog("All customer test steps completed.");

    document.getElementById("clearLog")?.click();
    expect(logText()).toBe("Log cleared.");

    const before = logText();
    (document.querySelector('[data-action="nope"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(logText()).toBe(before);
    expect((document.querySelector('[data-action="nope"]') as HTMLButtonElement).disabled).toBe(false);

    app.renderClients([]);
    app.renderCompliance([]);
    expect(document.getElementById("clientsView")?.textContent).toBe("No clients");
    expect(document.getElementById("complianceView")?.textContent).toBe("No open items");
    app.renderClients(undefined as never);
    app.renderCompliance([{ severity: "low", cl_id: null, title: "T", due_dt: "2020-01-01" }] as never);
    app.renderClients([
      {
        cl_id: null,
        full_nm: null,
        addr_line1: null,
        addr_suburb: null,
        addr_state: null,
        addr_postcode: null,
        care_type: null,
      },
    ] as never);

    const traced = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", traced);
    await app.api("/v1/demo/status");
    await app.api("/v1/demo/ocr", { method: "POST", body: "{}" });
    await app.api("/custom", { method: "POST", headers: { "X-Trace": "1" }, body: "{}" });
    const headers = traced.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.headers);
    expect(headers[0]).toMatchObject({ "Content-Type": "application/json" });
    expect(headers[1]).toMatchObject({ "Content-Type": "application/json" });
    expect(headers[2]).toEqual({ "X-Trace": "1" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await expect(app.api("/empty")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(app.api("/raw")).resolves.toEqual({ raw: "not-json" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { error: "bad" })));
    await expect(app.api("/err")).rejects.toThrow("bad");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { detail: "nope" })));
    await expect(app.api("/err")).rejects.toThrow("nope");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, {})));
    await expect(app.api("/err")).rejects.toThrow("HTTP 500");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(app.api("/err")).rejects.toThrow("HTTP 503");
  });

  it("disables buttons while a request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await loadApp(async (input) => {
      const url = String(input);
      if (url.includes("/v1/clients")) await gate;
      return route(url);
    });
    await waitForLog("Health");
    const button = document.querySelector('[data-action="clients"]') as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    release();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await waitForLog("Clients");
  });

  it("shows down pills and logs click and startup failures", async () => {
    await loadApp(async () => jsonResponse(200, { careos: { ok: false }, ocr: {} }));
    await waitForLog("Health");
    expect(document.getElementById("careosPill")?.textContent).toBe("CareOS down");
    expect(document.getElementById("careosPill")?.classList.contains("bad")).toBe(true);
    expect(document.getElementById("ocrPill")?.textContent).toBe("OCR down");

    await loadApp(async () => jsonResponse(200, {}));
    await waitForLog("Health");
    expect(document.getElementById("careosPill")?.textContent).toBe("CareOS down");
    expect(document.getElementById("ocrPill")?.textContent).toBe("OCR down");

    let started = false;
    await loadApp(async () => {
      if (!started) {
        started = true;
        return jsonResponse(200, { careos: { ok: true }, ocr: { ok: true } });
      }
      throw new Error("click-failed");
    });
    await waitForLog("Health");
    (document.querySelector('[data-action="health"]') as HTMLButtonElement).click();
    await waitForLog("click-failed");
    expect(document.getElementById("careosPill")?.textContent).toBe("CareOS error");
    expect((document.querySelector('[data-action="health"]') as HTMLButtonElement).disabled).toBe(false);

    started = false;
    await loadApp(async () => {
      if (!started) {
        started = true;
        return jsonResponse(200, { careos: { ok: true }, ocr: { ok: true } });
      }
      throw "boom";
    });
    await waitForLog("Health");
    (document.querySelector('[data-action="roster"]') as HTMLButtonElement).click();
    await waitForLog("boom");

    await loadApp(async () => {
      throw new Error("startup-down");
    });
    await waitForLog("startup-down");
    expect(document.getElementById("careosPill")?.textContent).toBe("CareOS down");
    expect(document.getElementById("ocrPill")?.textContent).toBe("OCR unknown");

    await loadApp(async () => {
      throw "startup-string";
    });
    await waitForLog("startup-string");
  });
});
