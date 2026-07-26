import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import {
  ScoringFailedError,
  type SuitabilityResult,
  scoreJobSuitability,
} from "@server/services/scorer";
import { resolveShowSponsorInfo } from "@server/services/sponsor-visibility";
import * as visaSponsors from "@server/services/visa-sponsors/index";
import { asyncPool } from "@server/utils/async-pool";
import type { Job } from "@shared/types";
import { progressHelpers, updateProgress } from "../progress";
import type { ScoredJob } from "./types";

const SCORING_CONCURRENCY = 4;

export async function scoreJobsStep(args: {
  profile: Record<string, unknown>;
  scoringInstructions?: string;
  visaSponsorCountryKey?: string | null;
  shouldCancel?: () => boolean;
}): Promise<{ unprocessedJobs: Job[]; scoredJobs: ScoredJob[] }> {
  logger.info("Running scoring step");
  const unprocessedJobs = await jobsRepo.getUnscoredDiscoveredJobs();

  // Check if auto-skip threshold is configured
  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;
  const showSponsorInfo = await resolveShowSponsorInfo();

  updateProgress({
    step: "scoring",
    jobsDiscovered: unprocessedJobs.length,
    jobsScored: 0,
    jobsExceptional: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    currentJob: undefined,
  });

  const scoredJobs: ScoredJob[] = [];
  let completed = 0;
  let exceptional = 0;
  const scoringInstructions = args.scoringInstructions?.trim();

  await asyncPool({
    items: unprocessedJobs,
    concurrency: SCORING_CONCURRENCY,
    shouldStop: args.shouldCancel,
    task: async (job) => {
      if (args.shouldCancel?.()) return;

      const hasCachedScore =
        typeof job.suitabilityScore === "number" &&
        !Number.isNaN(job.suitabilityScore);

      if (hasCachedScore) {
        if ((job.suitabilityScore as number) > 90) exceptional += 1;
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          {
            id: job.id,
            title: `${job.title} (cached)`,
            employer: job.employer,
          },
          exceptional,
        );
        scoredJobs.push({
          ...job,
          suitabilityScore: job.suitabilityScore as number,
          suitabilityReason: job.suitabilityReason ?? "",
        });
        return;
      }

      let scoringResult: SuitabilityResult;
      try {
        scoringResult = scoringInstructions
          ? await scoreJobSuitability(job, args.profile, {
              scoringInstructions,
            })
          : await scoreJobSuitability(job, args.profile);
      } catch (error) {
        if (!(error instanceof ScoringFailedError)) throw error;
        logger.warn("Skipping job after exhausted scoring retries", {
          jobId: job.id,
          title: job.title,
          error: error.message,
        });
        return;
      }
      const { score, reason, jobBrief, jobUpdates = {} } = scoringResult;
      if (args.shouldCancel?.()) return;

      const sponsorMatch =
        showSponsorInfo && job.employer
          ? await visaSponsors.searchSponsors(job.employer, {
              limit: 10,
              minScore: 50,
              countryKey: args.visaSponsorCountryKey ?? undefined,
            })
          : null;
      const sponsorSummary = sponsorMatch
        ? visaSponsors.calculateSponsorMatchSummary(sponsorMatch)
        : null;

      // Check if job should be auto-skipped based on score threshold
      const shouldAutoSkip =
        job.status !== "applied" &&
        score !== null &&
        autoSkipThreshold !== null &&
        !Number.isNaN(autoSkipThreshold) &&
        score < autoSkipThreshold;

      await jobsRepo.updateJob(job.id, {
        ...jobUpdates,
        suitabilityScore: score,
        suitabilityReason: reason,
        jobBrief,
        sponsorMatchScore: sponsorSummary?.sponsorMatchScore ?? null,
        sponsorMatchNames: sponsorSummary?.sponsorMatchNames ?? null,
        ...(shouldAutoSkip ? { status: "skipped" } : {}),
      });

      if (shouldAutoSkip) {
        logger.info("Auto-skipped job due to low score", {
          jobId: job.id,
          title: job.title,
          score,
          threshold: autoSkipThreshold,
        });
      }

      if (score !== null && score > 90) exceptional += 1;
      completed += 1;
      progressHelpers.scoringJob(
        completed,
        unprocessedJobs.length,
        {
          id: job.id,
          title: job.title,
          employer: job.employer,
        },
        exceptional,
      );
      scoredJobs.push({
        ...job,
        ...jobUpdates,
        suitabilityScore: score,
        suitabilityReason: reason,
      });
    },
  });

  progressHelpers.scoringComplete(scoredJobs.length);
  logger.info("Scoring step completed", {
    scoredJobs: scoredJobs.length,
    concurrency: SCORING_CONCURRENCY,
  });

  return { unprocessedJobs, scoredJobs };
}
