import { beforeEach, describe, expect, it, vi } from "vitest";
import { careos } from "../src/careos/client.js";
import { checkComplianceGaps } from "../src/pipelines/compliance.js";
import { main, reportCliError } from "../scripts/demo-compliance.js";

vi.mock("../src/careos/client.js", () => ({
  careos: { health: vi.fn() },
}));

vi.mock("../src/pipelines/compliance.js", () => ({
  checkComplianceGaps: vi.fn(),
}));

describe("demo-compliance", () => {
  beforeEach(() => {
    vi.mocked(careos.health).mockResolvedValue({ ok: true });
    vi.mocked(checkComplianceGaps).mockResolvedValue({ open_count: 2, items: [] } as never);
  });

  it("prints the compliance report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();
    expect(careos.health).toHaveBeenCalled();
    expect(checkComplianceGaps).toHaveBeenCalledWith();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ open_count: 2 });
    log.mockRestore();
  });

  it("propagates health failures", async () => {
    vi.mocked(careos.health).mockRejectedValueOnce(new Error("down"));
    await expect(main()).rejects.toThrow("down");
  });

  it("reports CLI errors by exiting", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    reportCliError(new Error("x"));
    expect(error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    error.mockRestore();
    exit.mockRestore();
  });
});
