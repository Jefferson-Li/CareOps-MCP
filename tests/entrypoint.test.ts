import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isDirectRun } from "../src/shared/entrypoint.js";

describe("isDirectRun", () => {
  it("is false when there is no script path", () => {
    expect(isDirectRun("file:///tmp/server.ts", ["node"])).toBe(false);
  });

  it("matches the entry script and rejects other paths", () => {
    const meta = pathToFileURL("/tmp/careos/server.ts").href;
    expect(isDirectRun(meta, ["node", "/tmp/careos/server.ts"])).toBe(true);
    expect(isDirectRun(meta, ["node", "/tmp/other.ts"])).toBe(false);
  });

  it("uses process.argv by default and rejects invalid module URLs", () => {
    expect(isDirectRun(pathToFileURL("/definitely/not/vitest.ts").href)).toBe(false);
    expect(isDirectRun("not a url", ["node", "/tmp/x.ts"])).toBe(false);
  });
});
