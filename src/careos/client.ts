import type {
  CareDocument,
  ClientRecord,
  ComplianceItem,
  PendingChange,
  VisitSlot,
} from "../shared/types.js";

export function careOsBaseUrl(): string {
  return process.env.CAREOS_URL ?? "http://127.0.0.1:3847";
}

export async function careOsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${careOsBaseUrl()}${path}`, {
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
  health: () => careOsRequest<{ ok: boolean }>("/health"),
  listClients: () => careOsRequest<{ items: ClientRecord[] }>("/v1/clients"),
  getClient: (id: string) =>
    careOsRequest<ClientRecord>(`/v1/clients/${encodeURIComponent(id)}`),
  listVisits: () => careOsRequest<{ items: VisitSlot[] }>("/v1/visits"),
  listCompliance: (openOnly = true) =>
    careOsRequest<{ items: ComplianceItem[] }>(`/v1/compliance${openOnly ? "?open=1" : ""}`),
  listDocuments: () => careOsRequest<{ items: CareDocument[] }>("/v1/documents"),
  getDocument: (id: string) =>
    careOsRequest<CareDocument>(`/v1/documents/${encodeURIComponent(id)}`),
  extractDocument: (id: string) =>
    careOsRequest<CareDocument>(`/v1/documents/${encodeURIComponent(id)}/extract`, {
      method: "POST",
      body: "{}",
    }),
  createPendingChange: (tool: string, payload: Record<string, unknown>) =>
    careOsRequest<PendingChange>("/v1/pending-changes", {
      method: "POST",
      body: JSON.stringify({ tool, payload }),
    }),
  applyPendingChange: (id: string) =>
    careOsRequest<{ change: PendingChange }>(
      `/v1/pending-changes/${encodeURIComponent(id)}/apply`,
      { method: "POST", body: "{}" },
    ),
  listPendingChanges: () =>
    careOsRequest<{ items: PendingChange[] }>("/v1/pending-changes"),
};
