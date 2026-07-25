import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateJobInput } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("jobs repository createJobs source-id dedup backstop", () => {
  let tempDir: string;
  let jobsRepo: Awaited<typeof import("./jobs")>;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-jobs-dedup-repo-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    jobsRepo = await import("./jobs");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function job(overrides: Partial<CreateJobInput>): CreateJobInput {
    return {
      source: "jobs-cz",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://www.jobs.cz/rpd/2001334990/",
      ...overrides,
    };
  }

  it("skips a same-source-id vacancy reposted under a different (volatile) URL within one batch", async () => {
    const result = await jobsRepo.createJobs([
      job({
        sourceJobId: "2001334990",
        jobUrl: "https://www.jobs.cz/rpd/2001334990/?searchId=aaa&rps=1",
      }),
      job({
        sourceJobId: "2001334990",
        jobUrl: "https://www.jobs.cz/rpd/2001334990/?searchId=bbb&rps=1",
      }),
    ]);

    expect(result).toEqual({ created: 1, skipped: 1 });
  });

  it("skips a same-source-id vacancy reposted under a different URL across separate pipeline runs", async () => {
    const firstRun = await jobsRepo.createJobs([
      job({
        sourceJobId: "2001334990",
        jobUrl: "https://www.jobs.cz/rpd/2001334990/?searchId=aaa&rps=1",
      }),
    ]);
    expect(firstRun).toEqual({ created: 1, skipped: 0 });

    const secondRun = await jobsRepo.createJobs([
      job({
        sourceJobId: "2001334990",
        jobUrl: "https://www.jobs.cz/rpd/2001334990/?searchId=ccc&rps=1",
      }),
    ]);
    expect(secondRun).toEqual({ created: 0, skipped: 1 });
  });

  it("does not affect dedup for inputs with no sourceJobId (falls back to URL-only)", async () => {
    const result = await jobsRepo.createJobs([
      job({
        source: "startupjobs",
        sourceJobId: undefined,
        jobUrl: "https://startup.jobs/posting/one",
      }),
      job({
        source: "startupjobs",
        sourceJobId: undefined,
        jobUrl: "https://startup.jobs/posting/two",
      }),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0 });
  });

  it("does not dedup the same sourceJobId across different sources", async () => {
    const result = await jobsRepo.createJobs([
      job({
        source: "jobs-cz",
        sourceJobId: "12345",
        jobUrl: "https://www.jobs.cz/rpd/12345/",
      }),
      job({
        source: "startupjobs",
        sourceJobId: "12345",
        jobUrl: "https://startup.jobs/posting/12345",
      }),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0 });
  });
});
