/**
 * Daily Active-Search Scheduler
 *
 * Runs the job discovery pipeline once a day (self-hosted mode only) so an
 * active search keeps picking up new postings without a manual trigger or an
 * external cron/n8n webhook. Mirrors services/backup/index.ts.
 *
 * If a saved pipeline search preset is configured (or one has been used
 * before), the run uses that preset's config; otherwise it falls back to the
 * original behavior of running against global settings.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import {
  getMostRecentlyUsedPipelineSearchPresetForTenant,
  getPipelineSearchPresetByIdForTenant,
} from "@server/repositories/pipeline-search-presets";
import * as settingsRepo from "@server/repositories/settings";
import { ensurePipelineSearchTerms } from "@server/services/pipeline-search-terms";
import { createScheduler } from "@server/utils/scheduler";
import type { PipelineSearchPreset } from "@shared/types";
import { presetConfigToPipelineConfig } from "./preset-config";

interface DailySearchSettings {
  enabled: boolean;
  hour: number;
}

let currentSettings: DailySearchSettings = {
  enabled: false,
  hour: 6,
};

/**
 * Resolves which saved pipeline search preset (if any) should drive today's
 * run: the configured preset id, falling back to the most recently used
 * preset, falling back to `null` (meaning "use global settings" — the
 * original bare `runPipeline()` behavior).
 */
async function resolveDailySearchPreset(): Promise<PipelineSearchPreset | null> {
  const presetIdSetting = await settingsRepo.getSetting("dailySearchPresetId");
  if (presetIdSetting) {
    const preset = await getPipelineSearchPresetByIdForTenant(presetIdSetting);
    if (preset) return preset;
  }
  return getMostRecentlyUsedPipelineSearchPresetForTenant();
}

const scheduler = createScheduler("daily-search", async () => {
  await runWithRequestContext({}, async () => {
    const preset = await resolveDailySearchPreset();
    logger.info("Daily search resolved run source", {
      source: preset ? "preset" : "global-settings",
      presetId: preset?.id ?? null,
      presetName: preset?.name ?? null,
    });

    if (preset) {
      await ensurePipelineSearchTerms({
        requestedSearchTerms: preset.config.searchTerms,
      });
    }
    const result = preset
      ? await runPipeline(presetConfigToPipelineConfig(preset.config))
      : await runPipeline();

    if (!result.success) {
      logger.warn("Daily search pipeline run did not complete successfully", {
        error: result.error,
        jobsDiscovered: result.jobsDiscovered,
        jobsProcessed: result.jobsProcessed,
      });
    } else {
      logger.info("Daily search pipeline run completed", {
        jobsDiscovered: result.jobsDiscovered,
        jobsProcessed: result.jobsProcessed,
      });
    }
  });
});

export function setDailySearchSettings(
  settings: Partial<DailySearchSettings>,
): void {
  const oldEnabled = currentSettings.enabled;
  const oldHour = currentSettings.hour;
  currentSettings = { ...currentSettings, ...settings };

  if (currentSettings.enabled) {
    if (!oldEnabled || oldHour !== currentSettings.hour) {
      scheduler.start(currentSettings.hour);
    }
  } else if (oldEnabled && !currentSettings.enabled) {
    scheduler.stop();
  }
}

export function getDailySearchSettings(): DailySearchSettings {
  return { ...currentSettings };
}

export function getNextDailySearchTime(): string | null {
  return scheduler.getNextRun();
}

export function isDailySearchSchedulerRunning(): boolean {
  return scheduler.isRunning();
}

export function startDailySearchScheduler(): void {
  if (currentSettings.enabled) {
    scheduler.start(currentSettings.hour);
  }
}

export function stopDailySearchScheduler(): void {
  scheduler.stop();
}
