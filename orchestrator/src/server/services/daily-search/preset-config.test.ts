import {
  LOCATION_MATCH_STRICTNESS_VALUES,
  LOCATION_SEARCH_SCOPE_VALUES,
} from "@shared/location-intelligence.js";
import type { PipelineSearchPresetConfig } from "@shared/types";
import { describe, expect, it } from "vitest";
import { presetConfigToPipelineConfig } from "./preset-config";

describe("presetConfigToPipelineConfig", () => {
  it("maps a fully-populated preset config to pipeline run args", () => {
    const config: PipelineSearchPresetConfig = {
      searchTerms: ["backend engineer", "platform engineer"],
      sources: ["linkedin", "indeed"],
      country: "united kingdom",
      cityLocations: ["London"],
      locationMode: "cities",
      proximity: null,
      workplaceTypes: ["remote", "hybrid"],
      searchScope: LOCATION_SEARCH_SCOPE_VALUES[0],
      matchStrictness: LOCATION_MATCH_STRICTNESS_VALUES[0],
      topN: 15,
      minSuitabilityScore: 60,
      runBudget: 500,
      scoringInstructions: "prioritize remote",
      watchlistSelectedSourceIds: ["wl-1"],
    };

    const result = presetConfigToPipelineConfig(config);

    expect(result).not.toHaveProperty("searchTerms");
    expect(result.topN).toBe(15);
    expect(result.minSuitabilityScore).toBe(60);
    expect(result.sources).toEqual(["linkedin", "indeed"]);
    expect(result.scoringInstructions).toBe("prioritize remote");
    expect(result.runBudget).toBe(500);
    expect(result.watchlistSelectedSourceIds).toEqual(["wl-1"]);
    expect(result.locationIntent).toBeTruthy();
    expect(result.locationIntent?.country).toBeTruthy();
  });
});
