import { describe, expect, it } from "vitest";
import { getShortcutsForTab } from "./shortcut-map";

describe("shortcut map", () => {
  it("does not expose the removed archive tab shortcut", () => {
    const labels = getShortcutsForTab("all").map(({ label }) => label);
    const keys = getShortcutsForTab("all").map(({ key }) => key);

    expect(labels).not.toContain("Archive tab");
    expect(keys).not.toContain("5");
  });
});
