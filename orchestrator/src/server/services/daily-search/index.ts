/**
 * Daily Active-Search Scheduler
 *
 * Runs the job discovery pipeline once a day (self-hosted mode only) so an
 * active search keeps picking up new postings without a manual trigger or an
 * external cron/n8n webhook. Mirrors services/backup/index.ts.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import { createScheduler } from "@server/utils/scheduler";

interface DailySearchSettings {
  enabled: boolean;
  hour: number;
}

let currentSettings: DailySearchSettings = {
  enabled: false,
  hour: 6,
};

const scheduler = createScheduler("daily-search", async () => {
  await runWithRequestContext({}, async () => {
    const result = await runPipeline();
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
