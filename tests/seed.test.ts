import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildSeedDb, runSeed } from "../src/careos/seed.js";
import { DB_PATH, loadDb } from "../src/shared/db.js";

describe("buildSeedDb", () => {
  it("builds the synthetic healthcare dataset", () => {
    const db = buildSeedDb();
    expect(db.clients.map((c) => c.cl_id)).toEqual(["CL-1001", "CL-1002", "CL-1003"]);
    expect(db.clients.map((c) => c.care_type)).toEqual(["inpatient", "both", "outpatient"]);
    expect(db.visits).toHaveLength(4);
    expect(db.visits.every((v) => Number.isFinite(Date.parse(v.start_ts)))).toBe(true);
    expect(db.visits.every((v) => Date.parse(v.start_ts) < Date.parse(v.end_ts))).toBe(true);
    expect(db.compliance.filter((c) => c.done_flg)).toHaveLength(1);
    expect(db.compliance.filter((c) => !c.done_flg)).toHaveLength(3);
    expect(db.compliance.map((c) => c.due_dt).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(db.documents[0].raw_text).toContain("Marsfield NSW 2122");
    expect(db.documents[0].extracted).toBeNull();
    expect(db.pending_changes[0]).toMatchObject({ tool: "seed", status: "applied" });
    expect(db.pending_changes[0].applied_at).toMatch(/^\d{4}/);
  });
});

describe("runSeed", () => {
  it("writes the database and logs counts", () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
    const db = runSeed();
    expect(loadDb().clients).toHaveLength(db.clients.length);
    expect(readFileSync(DB_PATH, "utf8")).toContain("Margaret Chen");
    expect(logs.join("\n")).toContain(`Seeded CareOS database at ${DB_PATH}`);
    expect(logs.join("\n")).toContain("Clients: 3, visits: 4, compliance gaps: 3");
  });
});
