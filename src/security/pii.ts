/** Lightweight PII helpers for healthcare demo data. */

const PHONE_RE = /(\+?61|0)\s?\d[\d\s-]{7,}/g;
const MRN_RE = /\b4\d{8}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function redactPii(text: string): string {
  return text
    .replace(PHONE_RE, "[REDACTED_PHONE]")
    .replace(MRN_RE, "[REDACTED_MRN]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]");
}

export function maskClientForLlm(client: {
  cl_id: string;
  full_nm: string;
  addr_suburb: string;
  addr_postcode: string;
  care_type: string;
  active_flg: boolean;
  phone_mobile?: string;
  mrn?: string | null;
  notes_internal?: string;
}): Record<string, unknown> {
  return {
    cl_id: client.cl_id,
    full_nm: client.full_nm,
    addr_suburb: client.addr_suburb,
    addr_postcode: client.addr_postcode,
    care_type: client.care_type,
    active_flg: client.active_flg,
    phone_mobile: client.phone_mobile ? "[REDACTED_PHONE]" : undefined,
    mrn: client.mrn ? "[REDACTED_MRN]" : null,
    notes_internal: client.notes_internal
      ? redactPii(client.notes_internal).slice(0, 200)
      : undefined,
  };
}

export function assertToken(requiredEnv = "CAREOPS_MCP_TOKEN"): void {
  const expected = process.env[requiredEnv];
  if (!expected) return; // local demo mode without token
  const got = process.env.MCP_AUTH_TOKEN;
  if (got !== expected) {
    throw new Error("Unauthorized: invalid MCP_AUTH_TOKEN");
  }
}
