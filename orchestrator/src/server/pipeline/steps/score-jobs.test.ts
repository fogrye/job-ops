import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import * as visaSponsors from "@server/services/visa-sponsors/index";
import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreJobsStep } from "./score-jobs";

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@server/repositories/jobs", () => ({
  getUnscoredDiscoveredJobs: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

vi.mock("@server/services/scorer", () => ({
  scoreJobSuitability: vi.fn(),
  ScoringFailedError: class ScoringFailedError extends Error {},
}));

vi.mock("@server/services/visa-sponsors/index", () => ({
  searchSponsors: vi.fn(),
  calculateSponsorMatchSummary: vi.fn(),
}));

vi.mock("../progress", () => ({
  updateProgress: vi.fn(),
  progressHelpers: {
    scoringJob: vi.fn(),
    scoringComplete: vi.fn(),
  },
}));

describe("scoreJobsStep auto-skip behavior", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const scorer = await import("@server/services/scorer");
    const visaSponsors = await import("@server/services/visa-sponsors/index");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        title: "Software Engineer",
        employer: "Acme Corp",
        status: "discovered",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
    ]);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    vi.mocked(scorer.scoreJobSuitability).mockResolvedValue({
      score: 40,
      reason: "Low fit",
      jobBrief: null,
    });
    vi.mocked(visaSponsors.searchSponsors).mockResolvedValue([]);
    vi.mocked(visaSponsors.calculateSponsorMatchSummary).mockReturnValue({
      sponsorMatchScore: 0,
      sponsorMatchNames: null,
    });
  });

  it("auto-skips jobs when score is below threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");

    await scoreJobsStep({ profile: {} });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        suitabilityScore: 40,
        status: "skipped",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.objectContaining({
        jobId: "job-1",
        score: 40,
        threshold: 50,
      }),
    );
  });

  it("uses the selected run country for visa sponsor matching", async () => {
    const visaSponsors = await import("@server/services/visa-sponsors/index");

    await scoreJobsStep({
      profile: {},
      visaSponsorCountryKey: "united kingdom",
    });

    expect(visaSponsors.searchSponsors).toHaveBeenCalledWith("Acme Corp", {
      limit: 10,
      minScore: 50,
      countryKey: "united kingdom",
    });
  });

  it("skips sponsor matching and sponsor fields when sponsorship is disabled", async () => {
    vi.mocked(settingsRepo.getSetting).mockImplementation(async (key) =>
      key === "showSponsorInfo" ? "0" : null,
    );

    await scoreJobsStep({ profile: {} });

    expect(visaSponsors.searchSponsors).not.toHaveBeenCalled();
    expect(visaSponsors.calculateSponsorMatchSummary).not.toHaveBeenCalled();
    const [, update] = vi.mocked(jobsRepo.updateJob).mock.calls[0];
    expect(update).not.toHaveProperty("sponsorMatchScore");
    expect(update).not.toHaveProperty("sponsorMatchNames");
  });

  it("passes per-run scoring instructions to the scorer", async () => {
    const scorer = await import("@server/services/scorer");

    await scoreJobsStep({
      profile: {},
      scoringInstructions: "Lower-score graduate programmes.",
    });

    expect(scorer.scoreJobSuitability).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      {},
      { scoringInstructions: "Lower-score graduate programmes." },
    );
  });

  it("does not override global scoring instructions with a blank per-run value", async () => {
    const scorer = await import("@server/services/scorer");

    await scoreJobsStep({
      profile: {},
      scoringInstructions: "   ",
    });

    expect(vi.mocked(scorer.scoreJobSuitability).mock.calls[0]).toHaveLength(2);
  });

  it("persists generated job briefs while scoring", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");

    vi.mocked(scorer.scoreJobSuitability).mockResolvedValue({
      score: 40,
      reason: "Low fit",
      jobBrief:
        '{"role_summary":"Build tools","they_want":[],"specifics":[],"company_offers":[],"practical_details":[],"missing_or_unclear":[],"repeated_signals":[]}',
    });

    await scoreJobsStep({ profile: {} });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        jobBrief:
          '{"role_summary":"Build tools","they_want":[],"specifics":[],"company_offers":[],"practical_details":[],"missing_or_unclear":[],"repeated_signals":[]}',
      }),
    );
  });

  it("persists accepted job fact updates while scoring", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");

    vi.mocked(scorer.scoreJobSuitability).mockResolvedValue({
      score: 75,
      reason: "Good fit",
      jobBrief: null,
      jobUpdates: {
        salaryInterval: "hourly",
        salarySource: "ai_job_fact_review",
      },
    });

    await scoreJobsStep({ profile: {} });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        salaryInterval: "hourly",
        salarySource: "ai_job_fact_review",
      }),
    );
  });

  it.each([
    { score: 90, exceptional: 0 },
    { score: 91, exceptional: 1 },
  ])("reports $exceptional exceptional matches for a score of $score", async ({
    score,
    exceptional,
  }) => {
    const scorer = await import("@server/services/scorer");
    const { progressHelpers } = await import("../progress");
    vi.mocked(scorer.scoreJobSuitability).mockResolvedValue({
      score,
      reason: "Test score",
      jobBrief: null,
    });

    await scoreJobsStep({ profile: {} });

    expect(progressHelpers.scoringJob).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({ id: "job-1" }),
      exceptional,
    );
  });

  it("does not auto-skip jobs when score equals threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");
    vi.mocked(scorer.scoreJobSuitability).mockResolvedValue({
      score: 50,
      reason: "At threshold",
      jobBrief: null,
    });

    await scoreJobsStep({ profile: {} });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        suitabilityScore: 50,
      }),
    );
    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
    expect(logger.info).not.toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.anything(),
    );
  });

  it("does not auto-skip when threshold setting is null", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);

    await scoreJobsStep({ profile: {} });

    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
  });

  it("does not auto-skip when threshold setting is NaN", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("not-a-number");

    await scoreJobsStep({ profile: {} });

    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
  });

  it("never auto-skips applied jobs even when score is below threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");
    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-applied",
        status: "applied",
        title: "Software Engineer",
        employer: "Acme Corp",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
    ]);

    await scoreJobsStep({ profile: {} });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-applied",
      expect.any(Object),
    );
    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
    expect(logger.info).not.toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.objectContaining({ jobId: "job-applied" }),
    );
  });

  it("scores multiple jobs and reports completion progress", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");
    const { progressHelpers } = await import("../progress");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "First Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
      createJob({
        id: "job-2",
        title: "Second Role",
        employer: "Beta",
        suitabilityScore: null,
      }),
    ]);

    vi.mocked(scorer.scoreJobSuitability)
      .mockResolvedValueOnce({
        score: 61,
        reason: "First score",
        jobBrief: null,
      })
      .mockResolvedValueOnce({
        score: 72,
        reason: "Second score",
        jobBrief: null,
      });

    const result = await scoreJobsStep({ profile: {} });

    expect(result.scoredJobs).toHaveLength(2);
    expect(vi.mocked(jobsRepo.updateJob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(progressHelpers.scoringJob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(progressHelpers.scoringJob)).toHaveBeenCalledWith(
      1,
      2,
      {
        id: expect.any(String),
        title: expect.any(String),
        employer: expect.any(String),
      },
      0,
    );
    expect(vi.mocked(progressHelpers.scoringComplete)).toHaveBeenCalledWith(2);
  });

  it("skips a job whose scoring exhausts retries without aborting the rest of the batch", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");
    const { logger } = await import("@infra/logger");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "Flaky Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
      createJob({
        id: "job-2",
        title: "Healthy Role",
        employer: "Beta",
        suitabilityScore: null,
      }),
    ]);

    vi.mocked(scorer.scoreJobSuitability)
      .mockRejectedValueOnce(
        new scorer.ScoringFailedError("AI scoring failed after 3 attempts."),
      )
      .mockResolvedValueOnce({
        score: 72,
        reason: "Second score",
        jobBrief: null,
      });

    const result = await scoreJobsStep({ profile: {} });

    expect(result.scoredJobs).toHaveLength(1);
    expect(result.scoredJobs[0]?.id).toBe("job-2");
    expect(vi.mocked(jobsRepo.updateJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jobsRepo.updateJob)).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({ suitabilityScore: 72 }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping job after exhausted scoring retries",
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("still propagates LlmNotConfiguredError (a genuine config issue affects every job)", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "First Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
    ]);

    class LlmNotConfiguredError extends Error {}
    vi.mocked(scorer.scoreJobSuitability).mockRejectedValueOnce(
      new LlmNotConfiguredError("LLM API key not configured"),
    );

    await expect(scoreJobsStep({ profile: {} })).rejects.toThrow(
      LlmNotConfiguredError,
    );
  });

  it("stops before processing when cancellation is requested", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const scorer = await import("@server/services/scorer");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "Cancelled Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
    ]);

    const result = await scoreJobsStep({
      profile: {},
      shouldCancel: () => true,
    });

    expect(result.scoredJobs).toHaveLength(0);
    expect(vi.mocked(scorer.scoreJobSuitability)).not.toHaveBeenCalled();
    expect(vi.mocked(jobsRepo.updateJob)).not.toHaveBeenCalled();
  });
});
