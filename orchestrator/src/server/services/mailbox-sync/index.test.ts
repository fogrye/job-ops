import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/post-application-integrations", () => ({
  listConnectedPostApplicationIntegrations: vi.fn(),
}));
vi.mock("@server/services/post-application/ingestion/gmail-sync", () => ({
  runGmailIngestionSync: vi.fn(),
}));

import { listConnectedPostApplicationIntegrations } from "@server/repositories/post-application-integrations";
import { runGmailIngestionSync } from "@server/services/post-application/ingestion/gmail-sync";
import type { PostApplicationIntegration } from "@shared/types";
import * as mailboxSync from "./index";

function integration(accountKey: string): PostApplicationIntegration {
  return {
    id: `integration-${accountKey}`,
    provider: "gmail",
    accountKey,
    displayName: null,
    status: "connected",
    credentials: null,
    lastConnectedAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const emptySummary = {
  discovered: 0,
  relevant: 0,
  classified: 0,
  errored: 0,
};

describe("Mailbox Sync Scheduler", () => {
  beforeEach(() => {
    vi.mocked(listConnectedPostApplicationIntegrations).mockReset();
    vi.mocked(runGmailIngestionSync).mockReset();
    mailboxSync.setMailboxSyncSettings({
      enabled: false,
      hour: 7,
      weekendEnabled: true,
    });
    mailboxSync.stopMailboxSyncScheduler();
  });

  describe("setMailboxSyncSettings", () => {
    it("updates settings", () => {
      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 5 });

      const settings = mailboxSync.getMailboxSyncSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.hour).toBe(5);
    });

    it("merges partial settings", () => {
      mailboxSync.setMailboxSyncSettings({ hour: 8 });

      const settings = mailboxSync.getMailboxSyncSettings();
      expect(settings.enabled).toBe(false); // unchanged
      expect(settings.hour).toBe(8); // updated
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

      expect(mailboxSync.isMailboxSyncSchedulerRunning()).toBe(false);
      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 14 });

      expect(mailboxSync.isMailboxSyncSchedulerRunning()).toBe(true);
      expect(mailboxSync.getNextMailboxSyncTime()).not.toBeNull();
    });

    it("stops the scheduler when disabled", () => {
      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 14 });
      expect(mailboxSync.isMailboxSyncSchedulerRunning()).toBe(true);

      mailboxSync.setMailboxSyncSettings({ enabled: false });
      expect(mailboxSync.isMailboxSyncSchedulerRunning()).toBe(false);
      expect(mailboxSync.getNextMailboxSyncTime()).toBeNull();
    });

    it("syncs every connected gmail account when the scheduled hour elapses", async () => {
      vi.mocked(listConnectedPostApplicationIntegrations).mockResolvedValue([
        integration("default"),
        integration("work"),
      ]);
      vi.mocked(runGmailIngestionSync).mockResolvedValue(emptySummary);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runGmailIngestionSync).toHaveBeenCalledTimes(2);
      expect(runGmailIngestionSync).toHaveBeenCalledWith({
        accountKey: "default",
      });
      expect(runGmailIngestionSync).toHaveBeenCalledWith({
        accountKey: "work",
      });
    });

    it("skips the scheduled sync on weekends when disabled", async () => {
      vi.setSystemTime(new Date("2026-01-17T10:00:00Z"));

      mailboxSync.setMailboxSyncSettings({
        enabled: true,
        hour: 11,
        weekendEnabled: false,
      });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(listConnectedPostApplicationIntegrations).not.toHaveBeenCalled();
      expect(runGmailIngestionSync).not.toHaveBeenCalled();
    });

    it("runs the scheduled sync on weekends when enabled", async () => {
      vi.mocked(listConnectedPostApplicationIntegrations).mockResolvedValue([
        integration("weekend"),
      ]);
      vi.mocked(runGmailIngestionSync).mockResolvedValue(emptySummary);
      vi.setSystemTime(new Date("2026-01-17T10:00:00Z"));

      mailboxSync.setMailboxSyncSettings({
        enabled: true,
        hour: 11,
        weekendEnabled: true,
      });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runGmailIngestionSync).toHaveBeenCalledWith({
        accountKey: "weekend",
      });
    });

    it("keeps syncing remaining accounts when one account fails", async () => {
      vi.mocked(listConnectedPostApplicationIntegrations).mockResolvedValue([
        integration("broken"),
        integration("healthy"),
      ]);
      vi.mocked(runGmailIngestionSync).mockImplementation(async (args) => {
        if (args.accountKey === "broken") {
          throw new Error("token expired");
        }
        return emptySummary;
      });
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 11 });
      await expect(
        vi.advanceTimersByTimeAsync(60 * 60 * 1000),
      ).resolves.not.toThrow();

      expect(runGmailIngestionSync).toHaveBeenCalledTimes(2);
      expect(runGmailIngestionSync).toHaveBeenCalledWith({
        accountKey: "healthy",
      });
    });

    it("no-ops when no gmail account is connected", async () => {
      vi.mocked(listConnectedPostApplicationIntegrations).mockResolvedValue([]);
      vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));

      mailboxSync.setMailboxSyncSettings({ enabled: true, hour: 11 });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(runGmailIngestionSync).not.toHaveBeenCalled();
    });
  });
});
