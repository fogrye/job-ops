import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/run", () => ({
  runJobsCz: vi.fn(),
}));

describe("Jobs.cz manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs only for Czechia and forwards terms and requested cities", async () => {
    const { manifest } = await import("../src/manifest");
    const { runJobsCz } = await import("../src/run");
    vi.mocked(runJobsCz).mockResolvedValue({ success: true, jobs: [] });

    await manifest.run({
      source: "jobs-cz",
      selectedSources: ["jobs-cz"],
      selectedCountry: "Czech Republic",
      searchTerms: ["platform engineer"],
      settings: { jobspyResultsWanted: "25" },
      sourceLocationPlan: { requestedCities: ["Prague"] } as never,
    });

    expect(runJobsCz).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["platform engineer"],
        cityLocations: ["Prague"],
        maxJobsPerTerm: 25,
      }),
    );
  });

  it("skips non-Czech countries before fetching", async () => {
    const { manifest } = await import("../src/manifest");
    const { runJobsCz } = await import("../src/run");

    const result = await manifest.run({
      source: "jobs-cz",
      selectedSources: ["jobs-cz"],
      selectedCountry: "Denmark",
      searchTerms: ["engineer"],
      settings: {},
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runJobsCz).not.toHaveBeenCalled();
  });
});
