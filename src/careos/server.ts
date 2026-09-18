import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDb, saveDb } from "../shared/db.js";
import type { CareOsDb, ClientRecord, PendingChange, VisitSlot } from "../shared/types.js";

const PORT = Number(process.env.CAREOS_PORT ?? 3847);
const HOST = process.env.CAREOS_HOST ?? "127.0.0.1";
const OCR_URL = process.env.OCR_URL ?? "http://127.0.0.1:3850";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_ROOT = join(ROOT, "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  body: unknown,
) => void | Promise<void>;

function send(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const sp = path.split("/").filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function overlaps(a: VisitSlot, b: VisitSlot): boolean {
  return a.start_ts < b.end_ts && b.start_ts < a.end_ts;
}

function findRosterConflicts(zone?: string) {
  const visits = loadDb().visits.filter((v) => (zone ? v.zone === zone : true));
  const conflicts: { a: VisitSlot; b: VisitSlot; reason: string }[] = [];
  for (let i = 0; i < visits.length; i++) {
    for (let j = i + 1; j < visits.length; j++) {
      const a = visits[i];
      const b = visits[j];
      if (a.carer_nm === b.carer_nm && overlaps(a, b)) {
        conflicts.push({
          a,
          b,
          reason: `Carer ${a.carer_nm} double-booked`,
        });
      }
    }
  }
  return {
    zone: zone ?? "all",
    visit_count: visits.length,
    conflicts,
    suggestion:
      conflicts.length > 0
        ? "Dry-run only: shift one overlapping slot or assign another carer."
        : "No carer overlaps detected.",
  };
}

async function fetchOcrHealth(): Promise<unknown> {
  try {
    const res = await fetch(`${OCR_URL}/health`);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function proxyOcrPath(path: string): Promise<unknown> {
  const res = await fetch(`${OCR_URL}/ocr/path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `OCR HTTP ${res.status}`,
    );
  }
  return data;
}

function tryServeStatic(pathname: string, res: ServerResponse): boolean {
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel.startsWith("web/")) rel = rel.slice(4);
  const full = normalize(join(WEB_ROOT, rel));
  if (!full.startsWith(WEB_ROOT + sep) && full !== WEB_ROOT) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const body = readFileSync(full);
  res.writeHead(200, {
    "Content-Type": MIME[extname(full)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(body);
  return true;
}

const routes: { method: string; pattern: string; handler: RouteHandler }[] = [
  {
    method: "GET",
    pattern: "/health",
    handler: (_req, res) => send(res, 200, { ok: true, service: "careos-mock" }),
  },
  {
    method: "GET",
    pattern: "/v1/ui-config",
    handler: (_req, res) =>
      send(res, 200, {
        service: "careos-mock",
        test_console: "/",
        ocr_url: OCR_URL,
        sample_image: "samples/gp-letter-aisha.png",
        notes: "Open / in a browser for the customer test console.",
      }),
  },
  {
    method: "GET",
    pattern: "/v1/demo/status",
    handler: async (_req, res) => {
      const ocr = await fetchOcrHealth();
      send(res, 200, {
        careos: { ok: true, service: "careos-mock" },
        ocr,
        ocr_url: OCR_URL,
      });
    },
  },
  {
    method: "POST",
    pattern: "/v1/demo/ocr",
    handler: async (_req, res, _params, body) => {
      const path =
        typeof body === "object" && body && "path" in body
          ? String((body as { path: unknown }).path)
          : "samples/gp-letter-aisha.png";
      try {
        const result = await proxyOcrPath(path);
        send(res, 200, result);
      } catch (err) {
        send(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  },
  {
    method: "GET",
    pattern: "/v1/demo/roster",
    handler: (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const zone = url.searchParams.get("zone") ?? undefined;
      send(res, 200, findRosterConflicts(zone || undefined));
    },
  },
  {
    method: "GET",
    pattern: "/v1/clients",
    handler: (_req, res) => {
      const db = loadDb();
      send(res, 200, { items: db.clients });
    },
  },
  {
    method: "GET",
    pattern: "/v1/clients/:id",
    handler: (_req, res, params) => {
      const db = loadDb();
      const client = db.clients.find((c) => c.cl_id === params.id);
      if (!client) return send(res, 404, { error: "client_not_found" });
      send(res, 200, client);
    },
  },
  {
    method: "PATCH",
    pattern: "/v1/clients/:id",
    handler: (_req, res, params, body) => {
      const db = loadDb();
      const idx = db.clients.findIndex((c) => c.cl_id === params.id);
      if (idx < 0) return send(res, 404, { error: "client_not_found" });
      const patch = (body ?? {}) as Partial<ClientRecord>;
      const allowed = [
        "addr_line1",
        "addr_suburb",
        "addr_postcode",
        "addr_state",
        "phone_mobile",
        "notes_internal",
      ] as const;
      for (const key of allowed) {
        if (patch[key] !== undefined) {
          (db.clients[idx] as Record<string, unknown>)[key] = patch[key];
        }
      }
      saveDb(db);
      send(res, 200, db.clients[idx]);
    },
  },
  {
    method: "GET",
    pattern: "/v1/visits",
    handler: (_req, res) => send(res, 200, { items: loadDb().visits }),
  },
  {
    method: "GET",
    pattern: "/v1/compliance",
    handler: (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const openOnly = url.searchParams.get("open") === "1";
      const db = loadDb();
      const items = openOnly ? db.compliance.filter((c) => !c.done_flg) : db.compliance;
      send(res, 200, { items });
    },
  },
  {
    method: "GET",
    pattern: "/v1/documents",
    handler: (_req, res) => send(res, 200, { items: loadDb().documents }),
  },
  {
    method: "GET",
    pattern: "/v1/documents/:id",
    handler: (_req, res, params) => {
      const doc = loadDb().documents.find((d) => d.doc_id === params.id);
      if (!doc) return send(res, 404, { error: "document_not_found" });
      send(res, 200, doc);
    },
  },
  {
    method: "POST",
    pattern: "/v1/documents/:id/extract",
    handler: (_req, res, params) => {
      const db = loadDb();
      const doc = db.documents.find((d) => d.doc_id === params.id);
      if (!doc) return send(res, 404, { error: "document_not_found" });
      doc.extracted = extractFromText(doc.raw_text);
      saveDb(db);
      send(res, 200, doc);
    },
  },
  {
    method: "POST",
    pattern: "/v1/pending-changes",
    handler: (_req, res, _params, body) => {
      const db = loadDb();
      const input = body as { tool: string; payload: Record<string, unknown> };
      const change: PendingChange = {
        change_id: randomUUID(),
        tool: input.tool,
        payload: input.payload,
        status: "pending",
        created_at: new Date().toISOString(),
        applied_at: null,
      };
      db.pending_changes.push(change);
      saveDb(db);
      send(res, 201, change);
    },
  },
  {
    method: "POST",
    pattern: "/v1/pending-changes/:id/apply",
    handler: (_req, res, params) => {
      const db = loadDb();
      const change = db.pending_changes.find((c) => c.change_id === params.id);
      if (!change) return send(res, 404, { error: "change_not_found" });
      if (change.status !== "pending") return send(res, 409, { error: "not_pending" });

      try {
        applyChange(db, change);
        change.status = "applied";
        change.applied_at = new Date().toISOString();
        saveDb(db);
        send(res, 200, { change, client: db.clients.find((c) => c.cl_id === change.payload.cl_id) });
      } catch (err) {
        send(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  },
  {
    method: "GET",
    pattern: "/v1/pending-changes",
    handler: (_req, res) => send(res, 200, { items: loadDb().pending_changes }),
  },
];

function extractFromText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const addr = text.match(/address to\s+(.+?)(?:\.|$)/i);
  if (addr) out.proposed_address = addr[1].trim();
  const phone = text.match(/(?:\+?61|0)\s?\d[\d\s-]{7,}/);
  if (phone) out.phone = phone[0].trim();
  const mrn = text.match(/\b4\d{8}\b/);
  if (mrn) out.mrn = mrn[0];
  const name = text.match(/Re:\s*(.+)/i);
  if (name) out.client_name = name[1].trim();
  return out;
}

function applyChange(db: CareOsDb, change: PendingChange): void {
  if (change.tool === "update_client_address") {
    const clId = String(change.payload.cl_id);
    const client = db.clients.find((c) => c.cl_id === clId);
    if (!client) throw new Error("client_not_found");
    if (change.payload.addr_line1) client.addr_line1 = String(change.payload.addr_line1);
    if (change.payload.addr_suburb) client.addr_suburb = String(change.payload.addr_suburb);
    if (change.payload.addr_postcode) client.addr_postcode = String(change.payload.addr_postcode);
    if (change.payload.addr_state) client.addr_state = String(change.payload.addr_state);
    const docId = change.payload.doc_id ? String(change.payload.doc_id) : null;
    if (docId) {
      const doc = db.documents.find((d) => d.doc_id === docId);
      if (doc) doc.applied_flg = true;
    }
    return;
  }
  throw new Error(`unsupported_tool:${change.tool}`);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && tryServeStatic(url.pathname, res)) {
    return;
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const params = matchPath(route.pattern, url.pathname);
    if (!params) continue;
    try {
      return await route.handler(req, res, params, body);
    } catch (err) {
      return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  send(res, 404, { error: "not_found", path: url.pathname });
});

server.listen(PORT, HOST, () => {
  console.error(`CareOS mock API listening on http://${HOST}:${PORT}`);
  console.error(`Test console: http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/`);
});
