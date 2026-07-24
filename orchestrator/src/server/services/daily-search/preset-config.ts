/**
 * Maps a saved pipeline search preset config onto pipeline run args.
 *
 * Mirrors the request->pipeline mapping in api/routes/pipeline.ts (POST
 * /run). `searchTerms` is intentionally omitted: PipelineConfig has no such
 * field — search terms are persisted as a global settings side effect via
 * ensurePipelineSearchTerms, which the caller invokes separately.
 */

import { createLocationIntent } from "@shared/location-intelligence.js";
import type { PipelineConfig, PipelineSearchPresetConfig } from "@shared/types";

export function presetConfigToPipelineConfig(
  config: PipelineSearchPresetConfig,
): Partial<PipelineConfig> {
  const locationIntent = createLocationIntent({
    selectedCountry: config.country,
    cityLocations: config.cityLocations,
    proximity: config.proximity,
    workplaceTypes: config.workplaceTypes,
    geoScope: config.searchScope,
    matchStrictness: config.matchStrictness,
  });

  return {
    topN: config.topN,
    minSuitabilityScore: config.minSuitabilityScore,
    sources: config.sources,
    scoringInstructions: config.scoringInstructions,
    runBudget: config.runBudget,
    locationIntent,
    watchlistSelectedSourceIds: config.watchlistSelectedSourceIds,
  };
}
