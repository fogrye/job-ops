import type { ManualJobDraft } from "@shared/types";
import { z } from "zod";
import {
  buildManualDraft,
  CZECH_BOARD_MAX_JOBS,
  cleanText,
  fetchDocument,
  getSourceHost,
  htmlToText,
  type ParsedCzechDetail,
} from "./czech";
import type { WatchlistCatalogSourceAdapter } from "./types";

const itJobsCzSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  itJobsCzUrl: z.string().trim().url().max(2000),
});

export const itJobsCzWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "itjobs.cz",
  descriptor: {
    sourceType: "itjobs.cz",
    label: "ITJobs.cz",
    catalogLabel: "ITJobs.cz search",
    customSourceOptionLabel: "Choose your own ITJobs.cz search",
    customSourceSearchText: "custom itjobs.cz url",
    customSourceInputLabel: "ITJobs.cz search URL",
    customSourcePlaceholder: "https://www.itjobs.cz/cz/volna-mista-v-it/",
    customSourceHelpText:
      "Use the public ITJobs.cz vacancies URL. Search filters may be included in the URL.",
    emptyCatalogText: "No ITJobs.cz searches found.",
    fetchingLabel: "Fetching from ITJobs.cz...",
    invalidUrlMessage: "Invalid ITJobs.cz search URL",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: itJobsCzSourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(itJobsCzSourceSchema)
      .parse(entries)
      .map((entry) => {
        const careersUrl = canonicalItJobsCzUrl(entry.itJobsCzUrl);
        return {
          id: buildSourceId(careersUrl),
          label: entry.label,
          sourceType: "itjobs.cz",
          careersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    return { ...source, careersUrl: canonicalItJobsCzUrl(source.careersUrl) };
  },
  normalizeCustomSelection(input) {
    const careersUrl = canonicalItJobsCzUrl(input.careersUrl);
    return { label: input.label?.trim() || "ITJobs.cz", careersUrl };
  },
  async fetchJobs(input) {
    const response = await fetchItJobsCz(input.source.careersUrl, input.signal);
    const source = buildSourceKey(input.source.careersUrl);
    const jobs = response.jobs.slice(0, CZECH_BOARD_MAX_JOBS).map((job) => ({
      jobRef: job.jobUrl,
      source,
      sourceJobId: job.externalId,
      sourceType: input.source.sourceType,
      title: job.title,
      employer: job.employer ?? input.source.label,
      jobUrl: job.jobUrl,
      applicationLink: job.jobUrl,
      location: job.location ?? null,
      postedAt: job.postedAt ?? null,
    }));

    return { total: response.total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const details = await fetchItJobsCzDetail(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: details.jobUrl,
      descriptionHtml: details.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const details = await fetchItJobsCzDetail(input.jobRef, input.signal);
    const source = buildSourceKey(input.source.careersUrl);
    const draft = buildManualDraft(
      input.source,
      source,
      details,
    ) as ManualJobDraft;
    return {
      draft,
      source: draft.source ?? null,
      sourceHost:
        getSourceHost(details.jobUrl) ?? getSourceHost(input.source.careersUrl),
    };
  },
};

function buildSourceId(url: string): string {
  return `itjobs.cz:${url}`;
}

function buildSourceKey(_url: string): string {
  return "itjobs.cz";
}

function canonicalItJobsCzUrl(value: string): string {
  const url = new URL(value);
  if (!/(^|\.)itjobs\.cz$/i.test(url.hostname)) {
    throw new Error("ITJobs.cz URL must use the itjobs.cz host.");
  }
  url.protocol = "https:";
  url.hostname = "www.itjobs.cz";
  url.hash = "";
  return url.toString();
}

async function fetchItJobsCz(
  url: string,
  signal: AbortSignal | undefined,
): Promise<{ total: number; jobs: ParsedCzechDetail[] }> {
  const { document } = await fetchDocument(url, signal, "windows-1250");
  const jobs: ParsedCzechDetail[] = [];
  const seen = new Set<string>();

  for (const item of document.querySelectorAll("#job-list > li.job-item")) {
    const link = item.querySelector<HTMLAnchorElement>(
      ".nazev a[href*='/volna-mista-v-it/']",
    );
    const jobUrl = link?.href;
    const externalId = jobUrl?.match(/\/volna-mista-v-it\/(\d+)-/)?.[1];
    const title = cleanText(link?.textContent);
    if (!jobUrl || !externalId || !title || seen.has(externalId)) continue;
    seen.add(externalId);

    const location = cleanText(item.querySelector(".lokalita")?.textContent);
    const description =
      cleanText(item.querySelector(".popis")?.textContent) ?? "";
    jobs.push({
      externalId,
      title,
      jobUrl,
      employer: undefined,
      location,
      jobDescriptionHtml: description ? `<p>${description}</p>` : "",
      jobDescriptionText: description,
    });
    if (jobs.length >= CZECH_BOARD_MAX_JOBS) break;
  }

  return { total: jobs.length, jobs };
}

async function fetchItJobsCzDetail(
  jobUrl: string,
  signal: AbortSignal | undefined,
): Promise<ParsedCzechDetail> {
  const { document, finalUrl } = await fetchDocument(
    jobUrl,
    signal,
    "windows-1250",
  );
  const id =
    finalUrl.match(/\/volna-mista-v-it\/(\d+)-/)?.[1] ??
    jobUrl.match(/\d+/)?.[0];
  const detail = document.querySelector("#job-detail");
  const title = cleanText(detail?.querySelector("h1 span")?.textContent);
  if (!detail || !id || !title)
    throw new Error("ITJobs.cz detail did not contain a job.");

  const descriptionHtml = [...document.querySelectorAll(".job-texts")]
    .map((section) => section.innerHTML.trim())
    .filter(Boolean)
    .join("\n");
  const location = [...document.querySelectorAll("#job-table tr")].find(
    (row) =>
      row.querySelector(".th")?.textContent?.trim().toLowerCase() ===
      "lokalita",
  );

  return {
    jobUrl: finalUrl,
    title,
    externalId: id,
    location: cleanText(location?.querySelector(".td")?.textContent),
    jobDescriptionHtml: descriptionHtml,
    jobDescriptionText: htmlToText(descriptionHtml),
  };
}
