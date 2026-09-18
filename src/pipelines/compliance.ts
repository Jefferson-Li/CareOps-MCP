import { careos } from "../careos/client.js";
import { maskClientForLlm, redactPii } from "../security/pii.js";

export async function checkComplianceGaps(severity?: "low" | "medium" | "high") {
  const [{ items: gaps }, { items: clients }] = await Promise.all([
    careos.listCompliance(true),
    careos.listClients(),
  ]);
  const byId = new Map(clients.map((c) => [c.cl_id, c]));
  const filtered = severity ? gaps.filter((g) => g.severity === severity) : gaps;
  const today = new Date().toISOString().slice(0, 10);

  const report = filtered
    .map((g) => {
      const client = byId.get(g.cl_id);
      const overdue = g.due_dt < today;
      return {
        item_id: g.item_id,
        checklist_cd: g.checklist_cd,
        title: g.title,
        severity: g.severity,
        due_dt: g.due_dt,
        overdue,
        client: client
          ? maskClientForLlm(client)
          : { cl_id: g.cl_id, full_nm: "unknown" },
      };
    })
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[a.severity] - rank[b.severity] || a.due_dt.localeCompare(b.due_dt);
    });

  return {
    generated_at: new Date().toISOString(),
    open_count: report.length,
    overdue_count: report.filter((r) => r.overdue).length,
    items: report,
  };
}

export async function searchClientContext(query: string) {
  const q = query.toLowerCase();
  const { items } = await careos.listClients();
  const hits = items
    .filter(
      (c) =>
        c.full_nm.toLowerCase().includes(q) ||
        c.cl_id.toLowerCase().includes(q) ||
        c.addr_suburb.toLowerCase().includes(q) ||
        c.notes_internal.toLowerCase().includes(q),
    )
    .map((c) => maskClientForLlm(c));

  return {
    query: redactPii(query),
    count: hits.length,
    clients: hits,
  };
}
