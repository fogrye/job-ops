import { AppError, badRequest } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { resolveRequestOrigin } from "@server/infra/request-origin";
import * as jobsRepo from "@server/repositories/jobs";
import { reconcileActivationMilestonesFromHistorySafely } from "@server/services/activation-funnel";
import { trackApplicationAcceptedIfNeeded } from "@server/services/jobs/analytics";
import { normalizeTailoredExperienceJson } from "@server/services/rxresume/tailoring";
import { getTracerReadiness } from "@server/services/tracer-links";
import { type Request, type Response, Router } from "express";
import {
  hydrateJobPdfFreshness,
  isJobUrlConflictError,
  queueTailoringAutoPdfRegenerationIfNeeded,
  toJobsRouteError,
  updateJobSchema,
} from "./shared";

export const jobsMutationsRouter = Router();

jobsMutationsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const parsedInput = updateJobSchema.parse(req.body);
    const input =
      parsedInput.tailoredExperience === undefined
        ? parsedInput
        : {
            ...parsedInput,
            tailoredExperience: normalizeTailoredExperienceJson(
              parsedInput.tailoredExperience,
            ),
          };
    const currentJob = await jobsRepo.getJobById(req.params.id);

    if (!currentJob) {
      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job update failed", {
        route: "PATCH /api/jobs/:id",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
      return;
    }

    if (currentJob.closedAt != null && Object.hasOwn(input, "status")) {
      throw badRequest("Closed jobs cannot change status");
    }
    if (
      input.closedAt === null &&
      currentJob.outcome != null &&
      !Object.hasOwn(input, "outcome")
    ) {
      throw badRequest("Declined jobs cannot be restored");
    }

    const isTurningTracerLinksOn =
      input.tracerLinksEnabled === true && !currentJob.tracerLinksEnabled;

    if (isTurningTracerLinksOn) {
      const readiness = await getTracerReadiness({
        requestOrigin: resolveRequestOrigin(req),
        force: true,
      });

      if (!readiness.canEnable) {
        throw new AppError({
          status: 409,
          code: "CONFLICT",
          message:
            readiness.reason ??
            "Tracer links are unavailable right now. Verify Tracer Links in Settings.",
          details: {
            tracerReadiness: {
              status: readiness.status,
              checkedAt: readiness.checkedAt,
              publicBaseUrl: readiness.publicBaseUrl,
            },
          },
        });
      }
    }

    const job = await jobsRepo.updateJob(req.params.id, input);

    if (!job) {
      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job update failed", {
        route: "PATCH /api/jobs/:id",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      return fail(res, err);
    }

    logger.info("Job updated", {
      route: "PATCH /api/jobs/:id",
      jobId: req.params.id,
      updatedFields: Object.keys(input),
    });

    trackApplicationAcceptedIfNeeded({
      closedAt: job.closedAt,
      nextOutcome: job.outcome,
      previousOutcome: currentJob.outcome,
      requestOrigin: resolveRequestOrigin(req),
      source: "jobs_patch_route",
    });
    ok(res, await hydrateJobPdfFreshness(job));
    queueTailoringAutoPdfRegenerationIfNeeded(
      currentJob,
      job,
      "PATCH /api/jobs/:id",
    );
    if (Object.hasOwn(input, "closedAt") || Object.hasOwn(input, "outcome")) {
      queueMicrotask(() => {
        void reconcileActivationMilestonesFromHistorySafely({
          route: "PATCH /api/jobs/:id",
          jobId: req.params.id,
          updatedFields: Object.keys(input),
        });
      });
    }
  } catch (error) {
    const err = toJobsRouteError(error, {
      invalidRequestFallbackMessage: "Invalid job update request",
      conflictWhen: isJobUrlConflictError,
      conflictMessage: "Another job already uses that job URL",
    });

    logger.error("Job update failed", {
      route: "PATCH /api/jobs/:id",
      jobId: req.params.id,
      status: err.status,
      code: err.code,
      details: err.details,
    });

    fail(res, err);
  }
});
