import {
  AppError,
  badRequest,
  conflict,
  notFound,
  toAppError,
} from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { processJob } from "@server/pipeline/index";
import * as jobsRepo from "@server/repositories/jobs";
import { getSetting } from "@server/repositories/settings";
import { inferManualJobDetails } from "@server/services/manualJob";
import { getProfile } from "@server/services/profile";
import { scoreJobSuitability } from "@server/services/scorer";
import { fetchJobDescriptionFromUrl } from "@server/services/source-job-description";
import { settingsRegistry } from "@shared/settings-registry";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const manualJobsRouter = Router();
const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use HTTP or HTTPS");

const manualJobFetchSchema = z.object({
  url: httpUrlSchema,
});

const manualJobInferenceSchema = z.object({
  jobDescription: z.string().trim().min(1).max(60000),
});

const manualJobImportSchema = z.object({
  skipTailoring: z.boolean().optional(),
  job: z.object({
    source: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9:_-]*$/i)
      .optional(),
    sourceJobId: z.string().trim().max(500).optional(),
    title: z.string().trim().min(1).max(500),
    employer: z.string().trim().min(1).max(500),
    jobUrl: httpUrlSchema,
    applicationLink: z.string().trim().url().max(2000).optional(),
    location: z.string().trim().max(200).optional(),
    salary: z.string().trim().max(200).optional(),
    deadline: z.string().trim().max(100).optional(),
    jobDescription: z.string().trim().min(1).max(40000),
    jobType: z.string().trim().max(200).optional(),
    jobLevel: z.string().trim().max(200).optional(),
    jobFunction: z.string().trim().max(200).optional(),
    disciplines: z.string().trim().max(200).optional(),
    degreeRequired: z.string().trim().max(200).optional(),
    starting: z.string().trim().max(200).optional(),
  }),
});

const cleanOptional = (value?: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

async function resolveSkipTailoring(
  explicit: boolean | undefined,
): Promise<boolean> {
  if (typeof explicit === "boolean") return explicit;
  const raw = await getSetting("autoTailorOnManualImport");
  const parsed = settingsRegistry.autoTailorOnManualImport.parse(
    raw ?? undefined,
  );
  const autoTailor =
    parsed ?? settingsRegistry.autoTailorOnManualImport.default();
  return !autoTailor;
}

const BLOCKED_AUTOFETCH_HOSTS: Array<{
  label: string;
  match: (hostname: string) => boolean;
}> = [
  {
    label: "LinkedIn",
    match: (hostname) =>
      hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"),
  },
  {
    label: "Indeed",
    match: (hostname) =>
      hostname === "indeed.com" || hostname.includes("indeed."),
  },
];

function getHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getBlockedAutofetchLabel(url: string): string | null {
  const hostname = getHostname(url);
  if (!hostname) return null;
  const blocked = BLOCKED_AUTOFETCH_HOSTS.find((entry) =>
    entry.match(hostname),
  );
  return blocked?.label ?? null;
}

/**
 * POST /api/manual-jobs/fetch - Fetch and extract job content from a URL
 */
manualJobsRouter.post("/fetch", async (req: Request, res: Response) => {
  try {
    const input = manualJobFetchSchema.parse(req.body ?? {});
    const blockedLabel = getBlockedAutofetchLabel(input.url);
    if (blockedLabel) {
      return fail(
        res,
        new AppError({
          status: 422,
          code: "UNPROCESSABLE_ENTITY",
          message: `Auto-fetch is not supported for ${blockedLabel} links. Paste the job description manually.`,
        }),
      );
    }

    const content = await fetchJobDescriptionFromUrl(input.url);
    ok(res, { content, url: input.url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/manual-jobs/infer - Infer job details from a pasted description
 */
manualJobsRouter.post("/infer", async (req: Request, res: Response) => {
  try {
    const input = manualJobInferenceSchema.parse(req.body ?? {});
    const result = await inferManualJobDetails(input.jobDescription);

    ok(res, {
      job: result.job,
      warning: result.warning ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/manual-jobs/import - Import a manually curated job into the DB
 */
manualJobsRouter.post("/import", async (req: Request, res: Response) => {
  try {
    const input = manualJobImportSchema.parse(req.body ?? {});
    const job = input.job;
    const source = cleanOptional(job.source) ?? "manual";
    const sourceJobId = cleanOptional(job.sourceJobId);

    if (sourceJobId) {
      const existingJob = await jobsRepo.getJobBySourceJobId(
        source,
        sourceJobId,
      );
      if (existingJob) {
        return fail(res, conflict("This job is already in your workspace."));
      }
    }

    const createdJob = await jobsRepo.createJob({
      source,
      sourceJobId: sourceJobId ?? undefined,
      title: job.title.trim(),
      employer: job.employer.trim(),
      jobUrl: job.jobUrl.trim(),
      applicationLink: cleanOptional(job.applicationLink) ?? undefined,
      location: cleanOptional(job.location) ?? undefined,
      salary: cleanOptional(job.salary) ?? undefined,
      deadline: cleanOptional(job.deadline) ?? undefined,
      jobDescription: job.jobDescription.trim(),
      jobType: cleanOptional(job.jobType) ?? undefined,
      jobLevel: cleanOptional(job.jobLevel) ?? undefined,
      jobFunction: cleanOptional(job.jobFunction) ?? undefined,
      disciplines: cleanOptional(job.disciplines) ?? undefined,
      degreeRequired: cleanOptional(job.degreeRequired) ?? undefined,
      starting: cleanOptional(job.starting) ?? undefined,
    });

    const skipTailoring = await resolveSkipTailoring(input.skipTailoring);
    if (skipTailoring) {
      ok(res, createdJob);
      return;
    }

    const processResult = await processJob(createdJob.id, {
      analyticsOrigin: "manual_job_create",
    });
    if (!processResult.success) {
      logger.warn("Manual job auto-processing failed", {
        jobId: createdJob.id,
        error: processResult.error ?? "Unknown error",
      });
      return fail(
        res,
        new AppError({
          status: 502,
          code: "UPSTREAM_ERROR",
          message:
            processResult.error ||
            "Imported job but failed to move it to ready automatically",
          details: { jobId: createdJob.id },
        }),
      );
    }

    const processedJob = await jobsRepo.getJobById(createdJob.id);
    if (!processedJob) {
      return fail(res, notFound("Job not found"));
    }

    const scoringJob = await jobsRepo.updateJob(processedJob.id, {
      status: "processing",
    });
    if (!scoringJob) {
      return fail(res, notFound("Job not found"));
    }

    ok(res, scoringJob);

    // Score asynchronously so the import returns immediately with a processing state.
    void (async () => {
      try {
        const rawProfile = await getProfile();
        if (
          !rawProfile ||
          typeof rawProfile !== "object" ||
          Array.isArray(rawProfile)
        ) {
          throw new Error("Invalid resume profile format");
        }
        const profile = rawProfile as Record<string, unknown>;
        const {
          score,
          reason,
          jobBrief,
          jobUpdates = {},
        } = await scoreJobSuitability(processedJob, profile);
        await jobsRepo.updateJob(processedJob.id, {
          ...jobUpdates,
          status: "ready",
          suitabilityScore: score,
          suitabilityReason: reason,
          jobBrief,
        });
      } catch (error) {
        logger.warn("Manual job scoring failed", {
          jobId: processedJob.id,
          error,
        });
        await jobsRepo.updateJob(processedJob.id, { status: "ready" });
      }
    })().catch((error) => {
      logger.warn("Manual job scoring task failed to start", {
        jobId: processedJob.id,
        error,
      });
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    fail(res, toAppError(error));
  }
});
