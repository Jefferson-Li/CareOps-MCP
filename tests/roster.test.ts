import { beforeEach, describe, expect, it, vi } from "vitest";
import { careos } from "../src/careos/client.js";
import { optimizeWeeklyRoster } from "../src/pipelines/roster.js";
import { makeVisit } from "./fixtures.js";

vi.mock("../src/careos/client.js", () => ({
  careos: {
    listVisits: vi.fn(),
  },
}));

describe("optimizeWeeklyRoster", () => {
  beforeEach(() => {
    vi.mocked(careos.listVisits).mockResolvedValue({
      items: [
        makeVisit({ slot_id: "A", carer_nm: "Priya", start_ts: "2026-05-01T09:00:00.000Z", end_ts: "2026-05-01T10:00:00.000Z", zone: "Eastwood" }),
        makeVisit({ slot_id: "B", carer_nm: "Priya", start_ts: "2026-05-01T09:30:00.000Z", end_ts: "2026-05-01T10:30:00.000Z", zone: "Eastwood" }),
        makeVisit({ slot_id: "C", carer_nm: "Priya", start_ts: "2026-05-01T12:00:00.000Z", end_ts: "2026-05-01T13:00:00.000Z", zone: "Eastwood" }),
        makeVisit({ slot_id: "D", carer_nm: "Tom", start_ts: "2026-05-01T09:00:00.000Z", end_ts: "2026-05-01T10:00:00.000Z", zone: "Ryde" }),
        makeVisit({ slot_id: "E", carer_nm: "Priya", start_ts: "2026-05-02T10:00:00.000Z", end_ts: "2026-05-02T11:00:00.000Z", zone: "Eastwood" }),
        makeVisit({ slot_id: "F", carer_nm: "Priya", start_ts: "2026-05-02T08:00:00.000Z", end_ts: "2026-05-02T09:00:00.000Z", zone: "Eastwood" }),
      ],
    });
  });

  it("suggests a one-hour shift for overlapping visits and ignores non-overlaps", async () => {
    const report = await optimizeWeeklyRoster();
    expect(report.zone).toBe("all");
    expect(report.visit_count).toBe(6);
    expect(report.dry_run).toBe(true);
    expect(report.conflict_count).toBe(1);
    expect(report.suggestions).toHaveLength(1);
    const suggestion = report.suggestions[0];
    expect(suggestion.conflict).toEqual({ a: "A", b: "B", carer: "Priya" });
    expect(suggestion.suggestion).toMatchObject({
      slot_id: "B",
      action: "shift_start_by_60m",
      new_start_ts: "2026-05-01T10:30:00.000Z",
      new_end_ts: "2026-05-01T11:30:00.000Z",
    });
    expect(suggestion.suggestion.rationale).toContain("Priya");
    expect(suggestion.suggestion.rationale).toContain("A");
    expect(report.note).toMatch(/does not mutate/);
  });

  it("filters by zone case-insensitively", async () => {
    const eastwood = await optimizeWeeklyRoster("eastwood");
    expect(eastwood.zone).toBe("eastwood");
    expect(eastwood.visit_count).toBe(5);
    expect(eastwood.conflict_count).toBe(1);

    vi.mocked(careos.listVisits).mockResolvedValue({
      items: [makeVisit({ zone: "Ryde", slot_id: "only" })],
    });
    const empty = await optimizeWeeklyRoster("Eastwood");
    expect(empty.visit_count).toBe(0);
    expect(empty.conflict_count).toBe(0);
    expect(empty.suggestions).toEqual([]);
  });
});
