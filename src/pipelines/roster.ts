import { careos } from "../careos/client.js";
import type { VisitSlot } from "../shared/types.js";

function overlaps(a: VisitSlot, b: VisitSlot): boolean {
  if (a.carer_nm !== b.carer_nm) return false;
  const as = Date.parse(a.start_ts);
  const ae = Date.parse(a.end_ts);
  const bs = Date.parse(b.start_ts);
  const be = Date.parse(b.end_ts);
  return as < be && bs < ae;
}

export async function optimizeWeeklyRoster(zone?: string) {
  const { items } = await careos.listVisits();
  const visits = zone ? items.filter((v) => v.zone.toLowerCase() === zone.toLowerCase()) : items;

  const conflicts: { a: string; b: string; carer: string }[] = [];
  for (let i = 0; i < visits.length; i++) {
    for (let j = i + 1; j < visits.length; j++) {
      if (overlaps(visits[i], visits[j])) {
        conflicts.push({
          a: visits[i].slot_id,
          b: visits[j].slot_id,
          carer: visits[i].carer_nm,
        });
      }
    }
  }

  const suggestions = conflicts.map((c) => {
    const slotB = visits.find((v) => v.slot_id === c.b)!;
    const shifted = new Date(Date.parse(slotB.start_ts) + 60 * 60 * 1000);
    const shiftedEnd = new Date(Date.parse(slotB.end_ts) + 60 * 60 * 1000);
    return {
      conflict: c,
      suggestion: {
        slot_id: slotB.slot_id,
        action: "shift_start_by_60m",
        new_start_ts: shifted.toISOString(),
        new_end_ts: shiftedEnd.toISOString(),
        rationale: `Avoid overlap for carer ${c.carer} between ${c.a} and ${c.b}`,
      },
    };
  });

  return {
    zone: zone ?? "all",
    visit_count: visits.length,
    conflict_count: conflicts.length,
    dry_run: true,
    suggestions,
    note: "Suggestions only — CareOps does not mutate roster without a separate apply tool (safety).",
  };
}
