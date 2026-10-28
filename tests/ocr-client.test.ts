import { afterEach, describe, expect, it, vi } from "vitest";
import { ocrBaseUrl, ocrRequest, ocrWorker } from "../src/workers/ocr-client.js";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ocr client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OCR_URL;
  });

  it("defaults the base URL and reads OCR_URL", () => {
    expect(ocrBaseUrl()).toBe("http://127.0.0.1:3850");
    process.env.OCR_URL = "http://ocr.test";
    expect(ocrBaseUrl()).toBe("http://ocr.test");
  });

  it("calls health, ocr, and ensure-sample", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/health")) return jsonResponse(200, { ok: true, tesseract: false, mode: "demo" });
      if (String(url).endsWith("/ocr/path")) return jsonResponse(200, { engine: "demo", text: "hi", fields: {} });
      return jsonResponse(200, { path: "/tmp/sample.png" });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OCR_URL = "http://ocr.test";

    await expect(ocrWorker.health()).resolves.toEqual({ ok: true, tesseract: false, mode: "demo" });
    await expect(ocrWorker.ocrPath("samples/a.png")).resolves.toMatchObject({ engine: "demo" });
    await expect(ocrWorker.ensureSample()).resolves.toEqual({ path: "/tmp/sample.png" });
    await ocrRequest("/custom", { headers: { "X-Trace": "1" } });

    const ocrCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/ocr/path"));
    expect(JSON.parse(String((ocrCall?.[1] as RequestInit).body))).toEqual({ path: "samples/a.png" });
    const custom = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(custom.headers).toMatchObject({ "Content-Type": "application/json", "X-Trace": "1" });
  });

  it("throws detail or a status fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { detail: "missing" })));
    await expect(ocrWorker.ocrPath("nope")).rejects.toThrow("missing");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(502, { error: "no detail" })));
    await expect(ocrWorker.health()).rejects.toThrow("OCR worker HTTP 502");
  });
});
