import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import { Router } from "express";
import { jobsActionsRouter } from "./actions";
import { jobsApplicationRouter } from "./application";
import { jobsDocumentsRouter } from "./documents";
import { jobsMaintenanceRouter } from "./maintenance";
import { jobsMutationsRouter } from "./mutations";
import { jobsNotesRouter } from "./notes";
import { jobsReadRouter } from "./read";
import { jobsStagesRouter } from "./stages";

export const jobsRouter = Router();

const SPONSOR_RESPONSE_FIELDS: Record<string, true> = {
  sponsorMatchScore: true,
  sponsorMatchNames: true,
  matchResults: true,
  jobBrief: true,
};

const redactSponsorData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSponsorData);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !Object.hasOwn(SPONSOR_RESPONSE_FIELDS, key))
      .map(([key, entry]) => [key, redactSponsorData(entry)]),
  );
};

jobsRouter.use((_req, res, next) => {
  void (async () => {
    const showSponsorInfo =
      settingsRegistry.showSponsorInfo.parse(
        (await settingsRepo.getSetting("showSponsorInfo")) ?? undefined,
      ) ?? settingsRegistry.showSponsorInfo.default();
    if (!showSponsorInfo) {
      const sendJson = res.json.bind(res);
      res.json = ((body: unknown) =>
        sendJson(redactSponsorData(body))) as typeof res.json;
    }
    next();
  })().catch(next);
});

jobsRouter.use(jobsReadRouter);
jobsRouter.use(jobsActionsRouter);
jobsRouter.use(jobsNotesRouter);
jobsRouter.use(jobsStagesRouter);
jobsRouter.use(jobsDocumentsRouter);
jobsRouter.use(jobsApplicationRouter);
jobsRouter.use(jobsMaintenanceRouter);
jobsRouter.use(jobsMutationsRouter);
