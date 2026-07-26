import { getSetting } from "@server/repositories/settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveShowSponsorInfo } from "./sponsor-visibility";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

describe("resolveShowSponsorInfo", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<[string | null, boolean]> = [
    [null, true],
    ["1", true],
    ["0", false],
    ["invalid", false],
  ];

  it.each(cases)("resolves stored value %j to %j", async (stored, expected) => {
    vi.mocked(getSetting).mockResolvedValue(stored);

    await expect(resolveShowSponsorInfo()).resolves.toBe(expected);
  });

  it("fails closed when the setting lookup fails", async () => {
    vi.mocked(getSetting).mockRejectedValue(new Error("settings unavailable"));

    await expect(resolveShowSponsorInfo()).resolves.toBe(false);
  });
});
