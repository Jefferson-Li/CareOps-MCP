import { describe, expect, it } from "vitest";
import { assertToken, maskClientForLlm, redactPii } from "../src/security/pii.js";
import { makeClient } from "./fixtures.js";

describe("redactPii", () => {
  it("redacts phones, MRNs, and emails", () => {
    const text = [
      "Call 0412 345 678 or 0412-345-678 or 0412345678",
      "intl +61 412 345 678 and +61412345678 and 61 412 345 678",
      "MRN 430009876 and 430000000",
      "a@b.co and User.Name+tag@mail.example.org",
    ].join(" ");
    const redacted = redactPii(text);
    expect(redacted).not.toMatch(/0412/);
    expect(redacted).not.toMatch(/\+61/);
    expect(redacted).not.toContain("430009876");
    expect(redacted).not.toContain("a@b.co");
    expect(redacted).toContain("[REDACTED_PHONE]");
    expect(redacted).toContain("[REDACTED_MRN]");
    expect(redacted).toContain("[REDACTED_EMAIL]");
  });

  it("leaves text without PII unchanged", () => {
    expect(redactPii("Falls risk — shower rail installed.")).toBe(
      "Falls risk — shower rail installed.",
    );
  });
});

describe("maskClientForLlm", () => {
  it("masks phone, MRN, and truncates notes after redaction", () => {
    const notes = `Email nurse@care.test about 0412 345 678. ${"x".repeat(250)}`;
    const masked = maskClientForLlm(
      makeClient({ mrn: "430009876", notes_internal: notes, phone_mobile: "0400 111 222" }),
    );
    expect(masked.phone_mobile).toBe("[REDACTED_PHONE]");
    expect(masked.mrn).toBe("[REDACTED_MRN]");
    expect(masked.full_nm).toBe("Margaret Chen");
    expect(String(masked.notes_internal)).not.toContain("nurse@care.test");
    expect(String(masked.notes_internal)).not.toContain("0412");
    expect(String(masked.notes_internal).length).toBeLessThanOrEqual(200);
  });

  it("omits empty contact fields and null MRN", () => {
    const masked = maskClientForLlm(
      makeClient({ phone_mobile: "", mrn: null, notes_internal: "" }),
    );
    expect(masked.phone_mobile).toBeUndefined();
    expect(masked.mrn).toBeNull();
    expect(masked.notes_internal).toBeUndefined();
  });

  it("treats missing phone, MRN, and notes as empty", () => {
    const masked = maskClientForLlm(
      makeClient({ phone_mobile: undefined, mrn: undefined, notes_internal: undefined }),
    );
    expect(masked.phone_mobile).toBeUndefined();
    expect(masked.mrn).toBeNull();
    expect(masked.notes_internal).toBeUndefined();
  });
});

describe("assertToken", () => {
  it("allows requests when the required token is unset", () => {
    delete process.env.CAREOPS_MCP_TOKEN;
    delete process.env.MCP_AUTH_TOKEN;
    expect(() => assertToken()).not.toThrow();
    expect(() => assertToken("OTHER_TOKEN")).not.toThrow();
  });

  it("allows a matching MCP_AUTH_TOKEN", () => {
    process.env.CAREOPS_MCP_TOKEN = "secret";
    process.env.MCP_AUTH_TOKEN = "secret";
    expect(() => assertToken()).not.toThrow();
  });

  it("rejects a missing or different MCP_AUTH_TOKEN", () => {
    process.env.CAREOPS_MCP_TOKEN = "secret";
    delete process.env.MCP_AUTH_TOKEN;
    expect(() => assertToken()).toThrow(/Unauthorized/);
    process.env.MCP_AUTH_TOKEN = "other";
    expect(() => assertToken()).toThrow(/invalid MCP_AUTH_TOKEN/);
  });
});
