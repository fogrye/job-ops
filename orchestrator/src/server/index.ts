/**
 * Express server entry point.
 */

import "./config/env";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { settingsRegistry } from "@shared/settings-registry";
import { createApp } from "./app";
import { getJobOpsAppConfig } from "./config/app-mode";
import { isDemoMode } from "./config/demo";
import { initializeExtractorRegistry } from "./extractors/registry";
import { deleteExpiredOrRevokedAuthSessions } from "./repositories/auth-sessions";
import * as settingsRepo from "./repositories/settings";
import { initializeActivationAnalyticsSafely } from "./services/activation-funnel";
import {
  getBackupSettings,
  setBackupSettings,
  startBackupScheduler,
} from "./services/backup/index";
import { attachChallengeViewerUpgradeProxy } from "./services/challenge-viewer";
import {
  setDailySearchSettings,
  startDailySearchScheduler,
} from "./services/daily-search/index";
import { initializeDemoModeServices } from "./services/demo-mode";
import { applyStoredEnvOverrides } from "./services/envSettings";
import { initializeHistoricalServerEventReplaySafely } from "./services/historical-product-analytics";
import {
  setMailboxSyncSettings,
  startMailboxSyncScheduler,
} from "./services/mailbox-sync/index";
import { initialize as initializeVisaSponsors } from "./services/visa-sponsors/index";

const AUTH_SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupAuthSessions(trigger: "startup" | "interval") {
  try {
    await deleteExpiredOrRevokedAuthSessions();
    logger.debug("Auth session cleanup completed", { trigger });
  } catch (error) {
    logger.warn("Auth session cleanup failed", {
      trigger,
      error: sanitizeUnknown(error),
    });
  }
}

async function startServer() {
  await applyStoredEnvOverrides();
  try {
    await initializeExtractorRegistry();
  } catch (error) {
    const sanitizedError = sanitizeUnknown(error);
    logger.error("Failed to initialize extractor registry", {
      error: sanitizedError,
    });
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "Extractor registry initialization failed in production. Shutting down server.",
      );
      process.exit(1);
    }

    logger.error(
      "Extractor registry initialization failed outside production. Server startup aborted.",
    );
    return;
  }

  const app = createApp();
  const PORT = Number(process.env.PORT) || 3001;
  const listenHost = process.env.JOBOPS_LISTEN_HOST?.trim() || "0.0.0.0";

  // Start server
  const server = app.listen(PORT, listenHost, async () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Job Ops Orchestrator                                 ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   API:     http://localhost:${PORT}/api                     ║
║   Health:  http://localhost:${PORT}/health                  ║
║   PDFs:    http://localhost:${PORT}/pdfs                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

    // Initialize visa sponsors service (downloads data if needed, starts scheduler)
    try {
      if (process.env.DEMO_MODE === "true") {
        console.log(
          "ℹ️ Demo mode enabled. Skipping visa sponsors initialization.",
        );
      } else {
        await initializeVisaSponsors();
      }
    } catch (error) {
      logger.warn("Failed to initialize visa sponsors service", {
        error: sanitizeUnknown(error),
      });
    }

    // Initialize backup service (load settings and start scheduler if enabled)
    try {
      const backupEnabled = await settingsRepo.getSetting("backupEnabled");
      const backupHour = await settingsRepo.getSetting("backupHour");
      const backupMaxCount = await settingsRepo.getSetting("backupMaxCount");

      const parsedHour = backupHour ? parseInt(backupHour, 10) : NaN;
      const parsedMaxCount = backupMaxCount
        ? parseInt(backupMaxCount, 10)
        : NaN;
      const safeHour = Number.isNaN(parsedHour)
        ? 2
        : Math.min(23, Math.max(0, parsedHour));
      const safeMaxCount = Number.isNaN(parsedMaxCount)
        ? 5
        : Math.min(5, Math.max(1, parsedMaxCount));

      setBackupSettings({
        enabled: backupEnabled === "true" || backupEnabled === "1",
        hour: safeHour,
        maxCount: safeMaxCount,
      });

      startBackupScheduler();

      const settings = getBackupSettings();
      if (settings.enabled) {
        console.log(
          `✅ Backup scheduler started (hour: ${settings.hour}, max: ${settings.maxCount})`,
        );
      } else {
        console.log(
          "ℹ️ Backups disabled. Enable in settings to schedule automatic backups.",
        );
      }
    } catch (error) {
      logger.warn("Failed to initialize backup service", {
        error: sanitizeUnknown(error),
      });
    }

    // Initialize daily active-search + mailbox-sync schedulers. Both need a
    // resolved private-data scope (tenant/user), which only exists inside a
    // request — unsupported in hosted multi-tenant mode, same restriction as
    // the manual webhook trigger (see api/routes/webhook.ts).
    if (!isDemoMode() && getJobOpsAppConfig().appMode !== "hosted") {
      try {
        const dailySearchEnabled =
          settingsRegistry.dailySearchEnabled.parse(
            (await settingsRepo.getSetting("dailySearchEnabled")) ?? undefined,
          ) ?? settingsRegistry.dailySearchEnabled.default();
        const dailySearchHour =
          settingsRegistry.dailySearchHour.parse(
            (await settingsRepo.getSetting("dailySearchHour")) ?? undefined,
          ) ?? settingsRegistry.dailySearchHour.default();
        const dailySearchWeekendEnabled =
          settingsRegistry.dailySearchWeekendEnabled.parse(
            (await settingsRepo.getSetting("dailySearchWeekendEnabled")) ??
              undefined,
          ) ?? settingsRegistry.dailySearchWeekendEnabled.default();

        setDailySearchSettings({
          enabled: dailySearchEnabled,
          hour: dailySearchHour,
          weekendEnabled: dailySearchWeekendEnabled,
        });
        startDailySearchScheduler();

        console.log(
          dailySearchEnabled
            ? `✅ Daily search scheduler started (hour: ${dailySearchHour})`
            : "ℹ️ Daily search disabled. Enable in settings to auto-run the pipeline daily.",
        );
      } catch (error) {
        logger.warn("Failed to initialize daily search scheduler", {
          error: sanitizeUnknown(error),
        });
      }

      try {
        const mailboxSyncEnabled =
          settingsRegistry.mailboxSyncEnabled.parse(
            (await settingsRepo.getSetting("mailboxSyncEnabled")) ?? undefined,
          ) ?? settingsRegistry.mailboxSyncEnabled.default();
        const mailboxSyncHour =
          settingsRegistry.mailboxSyncHour.parse(
            (await settingsRepo.getSetting("mailboxSyncHour")) ?? undefined,
          ) ?? settingsRegistry.mailboxSyncHour.default();
        const mailboxSyncWeekendEnabled =
          settingsRegistry.mailboxSyncWeekendEnabled.parse(
            (await settingsRepo.getSetting("mailboxSyncWeekendEnabled")) ??
              undefined,
          ) ?? settingsRegistry.mailboxSyncWeekendEnabled.default();

        setMailboxSyncSettings({
          enabled: mailboxSyncEnabled,
          hour: mailboxSyncHour,
          weekendEnabled: mailboxSyncWeekendEnabled,
        });
        startMailboxSyncScheduler();

        console.log(
          mailboxSyncEnabled
            ? `✅ Mailbox sync scheduler started (hour: ${mailboxSyncHour})`
            : "ℹ️ Mailbox sync disabled. Enable in settings to auto-sync Gmail daily.",
        );
      } catch (error) {
        logger.warn("Failed to initialize mailbox sync scheduler", {
          error: sanitizeUnknown(error),
        });
      }
    }

    try {
      await cleanupAuthSessions("startup");
      setInterval(() => {
        void cleanupAuthSessions("interval");
      }, AUTH_SESSION_CLEANUP_INTERVAL_MS);
    } catch (error) {
      logger.warn("Failed to initialize auth session cleanup", {
        error: sanitizeUnknown(error),
      });
    }

    try {
      await initializeDemoModeServices();
    } catch (error) {
      logger.warn("Failed to initialize demo mode services", {
        error: sanitizeUnknown(error),
      });
    }

    void initializeHistoricalServerEventReplaySafely();
    void initializeActivationAnalyticsSafely();
  });
  attachChallengeViewerUpgradeProxy(server);
}

void startServer();
