import { upstreamError } from "@infra/errors";
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

const jobsCzSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  jobsCzUrl: z.string().trim().url().max(2000),
});

const JOBS_CZ_DETAIL_QUERY = `
  query($widgetId: ID!, $jobAdId: ID!, $host: String) {
    widget(id: $widgetId, host: $host) {
      jobAd(id: $jobAdId) {
        id
        title
        validFrom
        content { htmlContent }
        locations { city region country }
        employer { companyName }
        parameters { employmentTypesObjects { label } }
      }
    }
  }
`;

export const jobsCzWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "jobs.cz",
  descriptor: {
    sourceType: "jobs.cz",
    label: "Jobs.cz",
    catalogLabel: "Jobs.cz search",
    customSourceOptionLabel: "Choose your own Jobs.cz search",
    customSourceSearchText: "custom jobs.cz url",
    customSourceInputLabel: "Jobs.cz search URL",
    customSourcePlaceholder: "https://www.jobs.cz/prace/?q=developer",
    customSourceHelpText:
      "Use a public Jobs.cz search URL. Include your keyword and any filters in the URL.",
    emptyCatalogText: "No Jobs.cz searches found.",
    fetchingLabel: "Fetching from Jobs.cz...",
    invalidUrlMessage: "Invalid Jobs.cz search URL",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: jobsCzSourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(jobsCzSourceSchema)
      .parse(entries)
      .map((entry) => {
        const careersUrl = canonicalJobsCzUrl(entry.jobsCzUrl);
        return {
          id: buildSourceId(careersUrl),
          label: entry.label,
          sourceType: "jobs.cz",
          careersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    return {
      ...source,
      careersUrl: canonicalJobsCzUrl(source.careersUrl),
    };
  },
  normalizeCustomSelection(input) {
    const careersUrl = canonicalJobsCzUrl(input.careersUrl);
    const label = input.label?.trim() || "Jobs.cz";
    return { label, careersUrl };
  },
  async fetchJobs(input) {
    const response = await fetchJobsCz(input.source.careersUrl, input.signal);
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
    const details = await fetchJobsCzDetail(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: details.jobUrl,
      descriptionHtml: details.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const details = await fetchJobsCzDetail(input.jobRef, input.signal);
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
  return `jobs.cz:${url}`;
}

function buildSourceKey(_url: string): string {
  return "jobs.cz";
}

function canonicalJobsCzUrl(value: string): string {
  const url = new URL(value);
  if (!/(^|\.)jobs\.cz$/i.test(url.hostname)) {
    throw new Error("Jobs.cz URL must use the jobs.cz host.");
  }
  if (!url.pathname.startsWith("/prace")) {
    throw new Error("Jobs.cz URL must be a public search URL.");
  }
  url.protocol = "https:";
  url.hostname = "www.jobs.cz";
  url.hash = "";
  return url.toString();
}

async function fetchJobsCz(
  url: string,
  signal: AbortSignal | undefined,
): Promise<{ total: number; jobs: ParsedCzechDetail[] }> {
  const jobs: ParsedCzechDetail[] = [];
  const seen = new Set<string>();
  let page = Number(new URL(url).searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1) page = 1;
  let pageUrl = url;
  let total = 0;

  while (jobs.length < CZECH_BOARD_MAX_JOBS) {
    const { document } = await fetchDocument(pageUrl, signal);
    total ||= parseTotal(document);
    const cards = [...document.querySelectorAll("article.SearchResultCard")];
    for (const card of cards) {
      const link = card.querySelector<HTMLAnchorElement>("a[data-jobad-id]");
      const externalId = link?.dataset.jobadId;
      const title = cleanText(link?.textContent);
      const jobUrl = link?.href;
      if (!externalId || !title || !jobUrl || seen.has(externalId)) continue;
      seen.add(externalId);
      const footerItems = [
        ...card.querySelectorAll(".SearchResultCard__footerItem"),
      ];
      jobs.push({
        externalId,
        title,
        jobUrl,
        employer: cleanText(
          card.querySelector(".SearchResultCard__footerItem span[translate]")
            ?.textContent,
        ),
        location: cleanText(
          card.querySelector("[data-test=serp-locality]")?.textContent,
        ),
        postedAt: parsePostedAt(
          card.querySelector(".SearchResultCard__status")?.textContent,
        ),
        jobDescriptionHtml:
          cleanText(card.querySelector(".SearchResultCard__body")?.innerHTML) ??
          "",
        jobDescriptionText: htmlToText(
          card.querySelector(".SearchResultCard__body")?.innerHTML ?? "",
        ),
        employmentStatus: footerItems.length
          ? cleanText(footerItems[footerItems.length - 1]?.textContent)
          : undefined,
      });
      if (jobs.length >= CZECH_BOARD_MAX_JOBS) break;
    }

    const next = document.querySelector<HTMLAnchorElement>(
      `a[aria-label="Go to page ${page + 1}"]`,
    );
    if (!next || cards.length === 0) break;
    page += 1;
    pageUrl = new URL(next.href, pageUrl).toString();
  }

  return { total: total || jobs.length, jobs };
}

function parseTotal(document: Document): number {
  const text = document.querySelector(".SearchHeader")?.textContent ?? "";
  return Number(text.replace(/[^0-9]/g, "")) || 0;
}

function parsePostedAt(value: string | null | undefined): string | undefined {
  const text = cleanText(value);
  return text && !/^(featured|new)$/i.test(text) ? text : undefined;
}
async function fetchJobsCzDetail(
  jobUrl: string,
  signal: AbortSignal | undefined,
): Promise<ParsedCzechDetail> {
  const { document, finalUrl } = await fetchDocument(jobUrl, signal);
  const detailUrl = new URL(finalUrl);
  const externalId =
    detailUrl.searchParams.get("id") ?? jobUrl.match(/\d{6,}/)?.[0];
  if (!externalId)
    throw upstreamError("Jobs.cz detail did not include a job ID.");

  const script = [
    ...document.querySelectorAll<HTMLScriptElement>("script[src]"),
  ]
    .map((node) => node.src)
    .find((src) => src.includes("/assets/js/script.min.js"));
  if (!script)
    throw upstreamError("Jobs.cz detail did not include its data script.");
  const scriptResponse = await fetch(new URL(script, finalUrl), {
    headers: { "user-agent": "job-ops/1.0" },
    signal,
  });
  if (!scriptResponse.ok) {
    throw upstreamError("Failed to fetch Jobs.cz detail data script.", {
      status: scriptResponse.status,
    });
  }
  const scriptText = await scriptResponse.text();
  const widget = scriptText.match(
    /"main-(?:en|cs)":\{"id":"([^"]+)","apiKey":"([^"]+)"/,
  );
  if (!widget)
    throw upstreamError(
      "Jobs.cz detail did not expose a widget configuration.",
    );

  const response = await fetch(
    "https://api.capybara.lmc.cz/api/graphql/widget",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": widget[2],
        "user-agent": "job-ops/1.0",
      },
      body: JSON.stringify({
        query: JOBS_CZ_DETAIL_QUERY,
        variables: {
          widgetId: widget[1],
          jobAdId: externalId,
          host: detailUrl.hostname,
        },
      }),
      signal,
    },
  );
  if (!response.ok) {
    throw upstreamError("Jobs.cz detail API request failed.", {
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    data?: {
      widget?: {
        jobAd?: {
          id: string;
          title: string;
          validFrom?: string;
          content?: { htmlContent?: string };
          locations?: Array<{
            city?: string;
            region?: string;
            country?: string;
          }>;
          employer?: { companyName?: string };
          parameters?: { employmentTypesObjects?: Array<{ label?: string }> };
        } | null;
      };
    };
    errors?: unknown;
  };
  const job = payload.data?.widget?.jobAd;
  if (!job || payload.errors)
    throw upstreamError("Jobs.cz detail API returned no job.");
  const html = job.content?.htmlContent?.trim() || "";
  const location = job.locations?.[0];
  return {
    jobUrl: finalUrl,
    title: job.title,
    externalId: job.id,
    employer: job.employer?.companyName,
    location: cleanText(
      [location?.city, location?.region, location?.country]
        .filter(Boolean)
        .join(", "),
    ),
    postedAt: job.validFrom,
    jobDescriptionHtml: html,
    jobDescriptionText: htmlToText(html),
    employmentStatus: job.parameters?.employmentTypesObjects?.[0]?.label,
  };
}
