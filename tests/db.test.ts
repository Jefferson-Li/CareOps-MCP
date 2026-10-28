import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_PATH, appendAudit, emptyDb, ensureDataDir, hashArgs, loadDb, saveDb } from "../src/shared/db.js";

describe("json database", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty", () => {
    expect(emptyDb()).toEqual({
      clients: [],
      visits: [],
      compliance: [],
      documents: [],
      pending_changes: [],
    });
  });

  it("creates the data directory and round-trips a database", () => {
    rmSync(process.env.CAREOS_DATA_DIR!, { recursive: true, force: true });
    ensureDataDir();
    const db = emptyDb();
    db.clients.push({
      cl_id: "CL-1",
      full_nm: "Pat",
      dob: "2000-01-01",
      addr_line1: "1 St",
      addr_suburb: "Ryde",
      addr_postcode: "2112",
      addr_state: "NSW",
      mrn: null,
      care_type: "outpatient",
      phone_mobile: "0400000000",
      emergency_contact: "Sam",
      notes_internal: "",
      active_flg: true,
    });
    saveDb(db);
    expect(loadDb()).toEqual(db);
  });

  it("creates an empty database when the file is missing", () => {
    rmSync(process.env.CAREOS_DATA_DIR!, { recursive: true, force: true });
    const db = loadDb();
    expect(db.clients).toEqual([]);
    expect(loadDb()).toEqual(db);
  });

  it("hashes arguments stably", () => {
    const first = hashArgs({ b: 1, a: "x" });
    const second = hashArgs({ b: 1, a: "x" });
    expect(first).toHaveLength(16);
    expect(first).toMatch(/^[0-9a-f]+$/);
    expect(second).toBe(first);
    expect(hashArgs({ b: 2 })).not.toBe(first);
  });

  it("appends audit rows with a generated or explicit timestamp", () => {
    appendAudit({ actor: "claude", tool: "search", args_hash: "abc", status: "ok" });
    appendAudit({
      ts: "2020-01-01T00:00:00.000Z",
      actor: "ops",
      tool: "apply",
      args_hash: "def",
      status: "error",
      detail: "nope",
    });
    const lines = readFileSync(AUDIT_PATH, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].actor).toBe("claude");
    expect(lines[0].status).toBe("ok");
    expect(lines[0].detail).toBeUndefined();
    expect(lines[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lines[1]).toMatchObject({
      ts: "2020-01-01T00:00:00.000Z",
      actor: "ops",
      status: "error",
      detail: "nope",
    });
  });

  it("uses the repo data directory when CAREOS_DATA_DIR is unset", async () => {
    const previous = process.env.CAREOS_DATA_DIR;
    delete process.env.CAREOS_DATA_DIR;
    try {
      vi.resetModules();
      const db = await import("../src/shared/db.ts");
      expect(db.DATA_DIR.replace(/\\/g, "/")).toMatch(/\/data$/);
    } finally {
      process.env.CAREOS_DATA_DIR = previous;
    }
  });

  it("honours an explicit data directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "careos-explicit-"));
    const previous = process.env.CAREOS_DATA_DIR;
    process.env.CAREOS_DATA_DIR = dir;
    try {
      vi.resetModules();
      const db = await import("../src/shared/db.ts");
      expect(db.DATA_DIR).toBe(dir);
      db.saveDb(db.emptyDb());
      expect(db.loadDb().visits).toEqual([]);
    } finally {
      process.env.CAREOS_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
