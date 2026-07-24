import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/pipeline/index", () => ({
  runPipeline: vi.fn(),
}));

import { runPipeline } from "@server/pipeline/index";
import * as dailySearch from "./index";

describe("Daily Search Scheduler", () => {
  beforeEach(() => {
    vi.mocked(runPipeline).mockReset();
    dailySearch.setDailySearchSettings({ enabled: false, hour: 6 });
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
  });
});
