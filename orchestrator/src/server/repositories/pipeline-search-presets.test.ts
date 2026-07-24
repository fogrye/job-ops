import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineSearchPresetConfig } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function buildConfig(
  overrides: Partial<PipelineSearchPresetConfig> = {},
): PipelineSearchPresetConfig {
  return {
    searchTerms: ["backend engineer"],
    sources: ["linkedin"],
    country: "united kingdom",
    cityLocations: ["London"],
    workplaceTypes: ["remote"],
    searchScope: "selected_only",
    matchStrictness: "exact_only",
    topN: 10,
    minSuitabilityScore: 55,
    runBudget: 250,
    ...overrides,
  };
}

describe.sequential("pipeline search presets repository", () => {
  let tempDir: string;
  let presetsRepo: Awaited<typeof import("./pipeline-search-presets")>;
  let runWithRequestContext: Awaited<
    typeof import("@server/infra/request-context")
  >["runWithRequestContext"];

  // Dynamic imports are required here (not a design choice): vi.resetModules()
  // per test forces a fresh module instance against a fresh DATA_DIR/db file,
  // which a static top-level import cannot express. Mirrors
  // post-application-integrations.test.ts's real-DB test pattern.
  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-search-presets-repo-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    presetsRepo = await import("./pipeline-search-presets");
    ({ runWithRequestContext } = await import("@server/infra/request-context"));
  });

  afterEach(async () => {
    // Same reset-modules constraint as above: closeDb must come from the
    // freshly-loaded db module for this test's DATA_DIR.
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("getMostRecentlyUsedPipelineSearchPresetForTenant returns the preset with the newest lastUsedAt", async () => {
    const [first, second] = await runWithRequestContext(
      { userId: "test-user" },
      async () => {
        const a = await presetsRepo.createPipelineSearchPreset({
          name: "First",
          config: buildConfig(),
        });
        const b = await presetsRepo.createPipelineSearchPreset({
          name: "Second",
          config: buildConfig(),
        });
        await presetsRepo.markPipelineSearchPresetUsed(a.id);
        return [a, b];
      },
    );
    expect(second).toBeDefined();

    const result =
      await presetsRepo.getMostRecentlyUsedPipelineSearchPresetForTenant();

    expect(result?.id).toBe(first.id);
  });

  it("falls back to the most recently updated preset when none has been used", async () => {
    const second = await runWithRequestContext(
      { userId: "test-user" },
      async () => {
        await presetsRepo.createPipelineSearchPreset({
          name: "First",
          config: buildConfig(),
        });
        return presetsRepo.createPipelineSearchPreset({
          name: "Second",
          config: buildConfig(),
        });
      },
    );

    const result =
      await presetsRepo.getMostRecentlyUsedPipelineSearchPresetForTenant();

    expect(result).not.toBeNull();
    expect(result?.id).toBe(second.id);
  });

  it("returns null when no presets exist for the tenant", async () => {
    const result =
      await presetsRepo.getMostRecentlyUsedPipelineSearchPresetForTenant();

    expect(result).toBeNull();
  });

  it("getPipelineSearchPresetByIdForTenant returns the matching preset by id", async () => {
    const created = await runWithRequestContext({ userId: "test-user" }, () =>
      presetsRepo.createPipelineSearchPreset({
        name: "Findable",
        config: buildConfig(),
      }),
    );

    const result = await presetsRepo.getPipelineSearchPresetByIdForTenant(
      created.id,
    );

    expect(result?.id).toBe(created.id);
    expect(result?.name).toBe("Findable");
  });

  it("getPipelineSearchPresetByIdForTenant returns null for an unknown or deleted id", async () => {
    const result =
      await presetsRepo.getPipelineSearchPresetByIdForTenant("does-not-exist");

    expect(result).toBeNull();
  });

  it("sees presets created under different userIds within the same tenant", async () => {
    const presetA = await runWithRequestContext({ userId: "user-a" }, () =>
      presetsRepo.createPipelineSearchPreset({
        name: "User A preset",
        config: buildConfig(),
      }),
    );
    const presetB = await runWithRequestContext({ userId: "user-b" }, () =>
      presetsRepo.createPipelineSearchPreset({
        name: "User B preset",
        config: buildConfig(),
      }),
    );

    const byIdA = await presetsRepo.getPipelineSearchPresetByIdForTenant(
      presetA.id,
    );
    const byIdB = await presetsRepo.getPipelineSearchPresetByIdForTenant(
      presetB.id,
    );
    expect(byIdA?.id).toBe(presetA.id);
    expect(byIdB?.id).toBe(presetB.id);

    const mostRecent =
      await presetsRepo.getMostRecentlyUsedPipelineSearchPresetForTenant();
    expect(mostRecent?.id).toBe(presetB.id);
  });
});
