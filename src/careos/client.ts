const BASE = process.env.CAREOS_URL ?? "http://127.0.0.1:3847";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `CareOS HTTP ${res.status}`);
  }
  return data;
}

export const careos = {
  health: () => request<{ ok: boolean }>("/health"),
  listClients: () => request<{ items: import("../shared/types.js").ClientRecord[] }>("/v1/clients"),
  getClient: (id: string) =>
    request<import("../shared/types.js").ClientRecord>(`/v1/clients/${encodeURIComponent(id)}`),
  listVisits: () => request<{ items: import("../shared/types.js").VisitSlot[] }>("/v1/visits"),
  listCompliance: (openOnly = true) =>
    request<{ items: import("../shared/types.js").ComplianceItem[] }>(
      `/v1/compliance${openOnly ? "?open=1" : ""}`,
    ),
  listDocuments: () =>
    request<{ items: import("../shared/types.js").CareDocument[] }>("/v1/documents"),
  getDocument: (id: string) =>
    request<import("../shared/types.js").CareDocument>(`/v1/documents/${encodeURIComponent(id)}`),
  extractDocument: (id: string) =>
    request<import("../shared/types.js").CareDocument>(
      `/v1/documents/${encodeURIComponent(id)}/extract`,
      { method: "POST", body: "{}" },
    ),
  createPendingChange: (tool: string, payload: Record<string, unknown>) =>
    request<import("../shared/types.js").PendingChange>("/v1/pending-changes", {
      method: "POST",
      body: JSON.stringify({ tool, payload }),
    }),
  applyPendingChange: (id: string) =>
    request<{ change: import("../shared/types.js").PendingChange }>(
      `/v1/pending-changes/${encodeURIComponent(id)}/apply`,
      { method: "POST", body: "{}" },
    ),
  listPendingChanges: () =>
    request<{ items: import("../shared/types.js").PendingChange[] }>("/v1/pending-changes"),
};
