import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEntry, CareOsDb } from "./types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = join(root, "data");
export const DB_PATH = join(DATA_DIR, "careos.json");
export const AUDIT_PATH = join(DATA_DIR, "audit.jsonl");

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function emptyDb(): CareOsDb {
  return {
    clients: [],
    visits: [],
    compliance: [],
    documents: [],
    pending_changes: [],
  };
}

export function loadDb(): CareOsDb {
  ensureDataDir();
  if (!existsSync(DB_PATH)) {
    const db = emptyDb();
    saveDb(db);
    return db;
  }
  return JSON.parse(readFileSync(DB_PATH, "utf8")) as CareOsDb;
}

export function saveDb(db: CareOsDb): void {
  ensureDataDir();
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 16);
}

export function appendAudit(entry: Omit<AuditEntry, "ts"> & { ts?: string }): void {
  ensureDataDir();
  const row: AuditEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    actor: entry.actor,
    tool: entry.tool,
    args_hash: entry.args_hash,
    status: entry.status,
    detail: entry.detail,
  };
  appendFileSync(AUDIT_PATH, `${JSON.stringify(row)}\n`);
}
