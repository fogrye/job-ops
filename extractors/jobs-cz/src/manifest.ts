import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import type { JobsCzProgressEvent } from "./run";
import { fetchJobsCzDescription, runJobsCz } from "./run";

function toProgress(event: JobsCzProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Jobs.cz: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  if (event.type === "page_complete") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.page,
      currentUrl: event.searchTerm,
      jobCardsFound: event.jobsFoundTerm,
      detail: `Jobs.cz: page ${event.page} for ${event.searchTerm}`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm,
    jobPagesProcessed: event.jobsFoundTerm,
    detail: `Jobs.cz: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm} jobs`,
  };
}

function parseMaxJobsPerTerm(
  settings: Record<string, string | undefined>,
): number {
  const parsed = settings.jobspyResultsWanted
    ? Number.parseInt(settings.jobspyResultsWanted, 10)
    : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 50;
}

export const manifest: ExtractorManifest = {
  id: "jobs-cz",
  displayName: "Jobs.cz",
  providesSources: ["jobs-cz"],
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    "jobs-cz": {
      supportedCountryKeys: ["czechia"],
      requiresSelectedCountry: true,
      requiresCityLocations: false,
      supportsNativeRadius: false,
    },
  },
  refreshJobDescription: ({ jobUrl, sourceJobId }) =>
    sourceJobId
      ? fetchJobsCzDescription(jobUrl, sourceJobId, fetch)
      : Promise.resolve(undefined),
  run: async (context) => {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "czechia") {
      return { success: true, jobs: [] };
    }

    return runJobsCz({
      searchTerms: context.searchTerms,
      cityLocations:
        context.sourceLocationPlan?.requestedCities ??
        context.locationIntent?.cityLocations ??
        [],
      maxJobsPerTerm: parseMaxJobsPerTerm(context.settings),
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });
  },
};

export default manifest;
