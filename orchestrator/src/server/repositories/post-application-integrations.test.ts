import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("post-application integrations repository", () => {
  let tempDir: string;
  let integrationsRepo: Awaited<
    typeof import("./post-application-integrations")
  >;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(
      join(tmpdir(), "job-ops-post-app-integrations-repo-"),
    );
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    integrationsRepo = await import("./post-application-integrations");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("lists connected and errored accounts, excluding disconnected ones", async () => {
    await integrationsRepo.upsertConnectedPostApplicationIntegration({
      provider: "gmail",
      accountKey: "active",
      credentials: { refreshToken: "r1" },
    });
    await integrationsRepo.upsertConnectedPostApplicationIntegration({
      provider: "gmail",
      accountKey: "retryable",
      credentials: { refreshToken: "r2" },
    });
    await integrationsRepo.updatePostApplicationIntegrationSyncState({
      provider: "gmail",
      accountKey: "retryable",
      lastError: "token expired",
      status: "error",
    });
    await integrationsRepo.upsertConnectedPostApplicationIntegration({
      provider: "gmail",
      accountKey: "removed",
      credentials: { refreshToken: "r3" },
    });
    await integrationsRepo.disconnectPostApplicationIntegration(
      "gmail",
      "removed",
    );

    const accounts =
      await integrationsRepo.listConnectedPostApplicationIntegrations("gmail");

    expect(accounts.map((account) => account.accountKey).sort()).toEqual([
      "active",
      "retryable",
    ]);
  });

  it("scopes the list to the requested provider", async () => {
    await integrationsRepo.upsertConnectedPostApplicationIntegration({
      provider: "gmail",
      accountKey: "gmail-account",
      credentials: { refreshToken: "r1" },
    });
    await integrationsRepo.upsertConnectedPostApplicationIntegration({
      provider: "imap",
      accountKey: "imap-account",
      credentials: { password: "secret" },
    });

    const accounts =
      await integrationsRepo.listConnectedPostApplicationIntegrations("gmail");

    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountKey).toBe("gmail-account");
  });
});
