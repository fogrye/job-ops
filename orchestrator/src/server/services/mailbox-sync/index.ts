/**
 * Daily Mailbox-Sync Scheduler
 *
 * Runs the Gmail ingestion sync once a day for every connected account
 * (self-hosted mode only), so recruiter replies get classified without a
 * manual "Sync now" click. Mirrors services/backup/index.ts.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { listConnectedPostApplicationIntegrations } from "@server/repositories/post-application-integrations";
import { runGmailIngestionSync } from "@server/services/post-application/ingestion/gmail-sync";
import { createScheduler } from "@server/utils/scheduler";

interface MailboxSyncSettings {
  enabled: boolean;
  hour: number;
  weekendEnabled: boolean;
}

let currentSettings: MailboxSyncSettings = {
  enabled: false,
  hour: 7,
  weekendEnabled: true,
};

function isWeekendUtc(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

const scheduler = createScheduler("mailbox-sync", async () => {
  if (!currentSettings.weekendEnabled && isWeekendUtc()) {
    logger.info("Mailbox sync skipped on weekend");
    return;
  }
  await runWithRequestContext({}, async () => {
    const integrations =
      await listConnectedPostApplicationIntegrations("gmail");

    for (const integration of integrations) {
      try {
        const summary = await runGmailIngestionSync({
          accountKey: integration.accountKey,
        });
        logger.info("Daily mailbox sync completed for account", {
          accountKey: integration.accountKey,
          discovered: summary.discovered,
          relevant: summary.relevant,
          classified: summary.classified,
          errored: summary.errored,
        });
      } catch (error) {
        // One account's failure (expired token, API outage) must not stop
        // the rest of the connected mailboxes from syncing.
        logger.warn("Daily mailbox sync failed for account", {
          accountKey: integration.accountKey,
          error,
        });
      }
    }
  });
});

export function setMailboxSyncSettings(
  settings: Partial<MailboxSyncSettings>,
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

export function getMailboxSyncSettings(): MailboxSyncSettings {
  return { ...currentSettings };
}

export function getNextMailboxSyncTime(): string | null {
  return scheduler.getNextRun();
}

export function isMailboxSyncSchedulerRunning(): boolean {
  return scheduler.isRunning();
}

export function startMailboxSyncScheduler(): void {
  if (currentSettings.enabled) {
    scheduler.start(currentSettings.hour);
  }
}

export function stopMailboxSyncScheduler(): void {
  scheduler.stop();
}
