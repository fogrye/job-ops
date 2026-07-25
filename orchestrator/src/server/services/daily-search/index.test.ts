import type { PipelineSearchPreset } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/pipeline/index", () => ({
  runPipeline: vi.fn(),
}));

vi.mock("@server/repositories/pipeline-search-presets", () => ({
  getPipelineSearchPresetByIdForTenant: vi.fn(),
  getMostRecentlyUsedPipelineSearchPresetForTenant: vi.fn(),
}));

vi.mock("@server/services/pipeline-search-terms", () => ({
  ensurePipelineSearchTerms: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import { runPipeline } from "@server/pipeline/index";
import {
  getMostRecentlyUsedPipelineSearchPresetForTenant,
  getPipelineSearchPresetByIdForTenant,
} from "@server/repositories/pipeline-search-presets";
import { getSetting } from "@server/repositories/settings";
import { ensurePipelineSearchTerms } from "@server/services/pipeline-search-terms";
import * as dailySearch from "./index";

function buildPreset(
  overrides: Partial<PipelineSearchPreset> = {},
): PipelineSearchPreset {
  return {
    id: "preset-1",
    name: "London backend",
    config: {
      searchTerms: ["backend engineer"],
      sources: ["linkedin"],
      country: "united kingdom",
      cityLocations: ["London"],
      workplaceTypes: ["remote"],
      searchScope: "selected_only",
      matchStrictness: "exact_only",
      topN: 15,
      minSuitabilityScore: 60,
      runBudget: 400,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

describe("Daily Search Scheduler", () => {
  beforeEach(() => {
    vi.mocked(runPipeline).mockReset();
    vi.mocked(getPipelineSearchPresetByIdForTenant).mockReset();
    vi.mocked(getMostRecentlyUsedPipelineSearchPresetForTenant).mockReset();
    vi.mocked(ensurePipelineSearchTerms).mockReset();
    vi.mocked(getSetting).mockReset();
    vi.mocked(getSetting).mockResolvedValue("");
    vi.mocked(getPipelineSearchPresetByIdForTenant).mockResolvedValue(null);
    vi.mocked(
      getMostRecentlyUsedPipelineSearchPresetForTenant,
    ).mockResolvedValue(null);
    vi.mocked(runPipeline).mockResolvedValue({
      success: true,
      jobsDiscovered: 0,
      jobsProcessed: 0,
    });
    dailySearch.setDailySearchSettings({
      enabled: false,
      hour: 6,
      weekendEnabled: true,
    });
    dailySearch.stopDailySearchScheduler();
  });

  describe("setDailySearchSettings", () => {
    it("updates settings", () => {
      dailySearch.setDailySearchSettings({ enabled: true, hour: 9 });

      const settings = dailySearch.getDailySearchSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.hour).toBe(9);
    });

    it("merges partial settings", () => {
      dailySearch.setDailySearchSettings({ hour: 11 });

      const settings = dailySearch.getDailySearchSettings();
      expect(settings.enabled).toBe(false); // unchanged
      expect(settings.hour).toBe(11); // updated
    });
  });

  describe("scheduler integration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts the scheduler when enabled", () => {
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      expect(dailySearch.isDailySearchSchedulerRunning()).toBe(false);
      dailySearch.setDailySearchSettings({ enabled: true, hour: 14 });

      expect(dailySearch.isDailySearchSchedulerRunning()).toBe(true);
      expect(dailySearch.getNextDailySearchTime()).not.toBeNull();
    });

    it("stops the scheduler when disabled", () => {
      dailySearch.setDailySearchSettings({ enabled: true, hour: 14 });
      expect(dailySearch.isDailySearchSchedulerRunning()).toBe(true);

      dailySearch.setDailySearchSettings({ enabled: false });
      expect(dailySearch.isDailySearchSchedulerRunning()).toBe(false);
      expect(dailySearch.getNextDailySearchTime()).toBeNull();
    });

    it("runs the pipeline when the scheduled hour elapses", async () => {
      vi.mocked(runPipeline).mockResolvedValue({
        success: true,
        jobsDiscovered: 3,
        jobsProcessed: 3,
      });
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runPipeline).toHaveBeenCalledTimes(1);
    });

    it("skips the scheduled pipeline on weekends when disabled", async () => {
      vi.setSystemTime(new Date("2026-01-17T10:00:00Z"));

      dailySearch.setDailySearchSettings({
        enabled: true,
        hour: 11,
        weekendEnabled: false,
      });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runPipeline).not.toHaveBeenCalled();
    });

    it("runs the scheduled pipeline on weekends when enabled", async () => {
      vi.setSystemTime(new Date("2026-01-17T10:00:00Z"));

      dailySearch.setDailySearchSettings({
        enabled: true,
        hour: 11,
        weekendEnabled: true,
      });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runPipeline).toHaveBeenCalledTimes(1);
    });

    it("does not throw when the pipeline run reports failure", async () => {
      vi.mocked(runPipeline).mockResolvedValue({
        success: false,
        jobsDiscovered: 0,
        jobsProcessed: 0,
        error: "Pipeline is already running",
      });
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await expect(
        vi.advanceTimersByTimeAsync(60 * 60 * 1000),
      ).resolves.not.toThrow();

      expect(runPipeline).toHaveBeenCalledTimes(1);
    });

    it("uses the most recently used preset when no preset id is configured", async () => {
      const preset = buildPreset();
      vi.mocked(getSetting).mockResolvedValue("");
      vi.mocked(
        getMostRecentlyUsedPipelineSearchPresetForTenant,
      ).mockResolvedValue(preset);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(ensurePipelineSearchTerms).toHaveBeenCalledWith({
        requestedSearchTerms: preset.config.searchTerms,
      });
      expect(runPipeline).toHaveBeenCalledTimes(1);
      const [runArgs] = vi.mocked(runPipeline).mock.calls[0];
      expect(runArgs).toEqual(
        expect.objectContaining({
          sources: preset.config.sources,
          topN: preset.config.topN,
          locationIntent: expect.any(Object),
        }),
      );
    });

    it("uses the preset configured by dailySearchPresetId, without checking the most-recently-used preset", async () => {
      const preset = buildPreset({ id: "preset-configured" });
      vi.mocked(getSetting).mockResolvedValue("preset-configured");
      vi.mocked(getPipelineSearchPresetByIdForTenant).mockResolvedValue(preset);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(getPipelineSearchPresetByIdForTenant).toHaveBeenCalledWith(
        "preset-configured",
      );
      expect(
        getMostRecentlyUsedPipelineSearchPresetForTenant,
      ).not.toHaveBeenCalled();
      expect(ensurePipelineSearchTerms).toHaveBeenCalledWith({
        requestedSearchTerms: preset.config.searchTerms,
      });
      const [runArgs] = vi.mocked(runPipeline).mock.calls[0];
      expect(runArgs).toEqual(
        expect.objectContaining({
          sources: preset.config.sources,
          topN: preset.config.topN,
        }),
      );
    });

    it("falls back to the most recently used preset when the configured preset id is stale", async () => {
      const fallbackPreset = buildPreset({ id: "fallback-preset" });
      vi.mocked(getSetting).mockResolvedValue("deleted-preset");
      vi.mocked(getPipelineSearchPresetByIdForTenant).mockResolvedValue(null);
      vi.mocked(
        getMostRecentlyUsedPipelineSearchPresetForTenant,
      ).mockResolvedValue(fallbackPreset);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(getPipelineSearchPresetByIdForTenant).toHaveBeenCalledWith(
        "deleted-preset",
      );
      expect(
        getMostRecentlyUsedPipelineSearchPresetForTenant,
      ).toHaveBeenCalled();
      const [runArgs] = vi.mocked(runPipeline).mock.calls[0];
      expect(runArgs).toEqual(
        expect.objectContaining({ sources: fallbackPreset.config.sources }),
      );
    });

    it("runs the bare pipeline call when no presets exist at all", async () => {
      vi.mocked(getSetting).mockResolvedValue("");
      vi.mocked(getPipelineSearchPresetByIdForTenant).mockResolvedValue(null);
      vi.mocked(
        getMostRecentlyUsedPipelineSearchPresetForTenant,
      ).mockResolvedValue(null);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      dailySearch.setDailySearchSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(ensurePipelineSearchTerms).not.toHaveBeenCalled();
      expect(runPipeline).toHaveBeenCalledTimes(1);
      expect(runPipeline).toHaveBeenCalledWith();
    });
  });
});
