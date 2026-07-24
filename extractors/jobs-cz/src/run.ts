import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";

const JOBS_CZ_BASE_URL = "https://www.jobs.cz";
const JOBS_CZ_SEARCH_PATH = "/prace/";
const JOBS_CZ_MAX_PAGES = 50;
const JOBS_CZ_WIDGET_API_URL = "https://api.capybara.lmc.cz/api/graphql/widget";
const JOBS_CZ_WIDGET_DETAIL_QUERY = `
  query DETAIL_QUERY($widgetId: ID!, $jobAdId: ID!, $host: String) {
    widget(id: $widgetId, host: $host) {
      jobAd(id: $jobAdId) {
        content { htmlContent }
      }
    }
  }
`;

export type JobsCzProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      page: number;
      jobsFoundTerm: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunJobsCzOptions {
  searchTerms?: string[];
  cityLocations?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: JobsCzProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface JobsCzResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface JobsCzCard {
  sourceJobId: string;
  title: string;
  employer: string;
  jobUrl: string;
  location?: string;
  postedAt?: string;
}

function getString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  );
  return getString(match?.[2]);
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, JOBS_CZ_BASE_URL).toString();
  } catch {
    return undefined;
  }
}

function firstMatchText(card: string, pattern: RegExp): string | undefined {
  return getString(stripHtml(card.match(pattern)?.[1] ?? ""));
}

export function buildJobsCzSearchUrl(
  searchTerm: string,
  page = 1,
): string {
  const url = new URL(JOBS_CZ_SEARCH_PATH, JOBS_CZ_BASE_URL);
  url.searchParams.set("q", searchTerm);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export function parseJobsCzCards(html: string): JobsCzCard[] {
  const cards = html.match(
    /<article\b[^>]*class=["'][^"']*\bSearchResultCard\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi,
  );
  if (!cards) return [];

  return cards.flatMap((card) => {
    const anchor = card.match(
      /<a\b[^>]*data-jobad-id\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/i,
    );
    if (!anchor) return [];
    const anchorTag = anchor[0].slice(0, anchor[0].indexOf(">") + 1);
    const sourceJobId = getString(anchor[2]);
    const title = getString(stripHtml(anchor[0].replace(anchorTag, "")));
    const jobUrl = absoluteUrl(attribute(anchorTag, "href"));
    if (!sourceJobId || !title || !jobUrl) return [];

    const employer =
      firstMatchText(
        card,
        /<span\b[^>]*translate\s*=\s*["'][^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      ) ?? "Jobs.cz";
    const location = getString(
      stripHtml(
        card.match(
          /<([a-z][\w:-]*)\b[^>]*data-test\s*=\s*["']serp-locality["'][^>]*>([\s\S]*?)<\/\1>/i,
        )?.[2] ?? "",
      ),
    );
    const postedAt = firstMatchText(
      card,
      /<[^>]*class=["'][^"']*SearchResultCard__status[^"']*["'][^>]*>([\s\S]*?)<\//i,
    );
    return [
      {
        sourceJobId,
        title,
        employer,
        jobUrl,
        location,
        postedAt,
      },
    ];
  });
}

function mapJobsCzCard(card: JobsCzCard): CreateJobInput {
  const locationEvidence: JobLocationEvidence = {
    rawLocation: card.location ?? null,
    location: card.location ?? null,
    countryKey: "czechia",
    country: "Czechia",
    city: card.location ?? null,
    evidenceQuality: card.location ? "exact" : "weak",
    source: "jobs.cz",
  };

  return {
    source: "jobs-cz",
    sourceJobId: card.sourceJobId,
    title: card.title,
    employer: card.employer,
    jobUrl: card.jobUrl,
    applicationLink: card.jobUrl,
    location: card.location,
    locationEvidence,
    datePosted: card.postedAt,
  };
}

async function fetchPage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "job-ops/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Jobs.cz returned HTTP ${response.status}.`);
  }
  return response.text();
}

function extractBalancedDiv(html: string, contentStart: number): string | undefined {
  const tagPattern = /<(\/)?div\b[^>]*>/gi;
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return undefined;
}

function extractJobsCzNativeDescription(html: string): string | undefined {
  const marker = html.match(/<div\b[^>]*data-test=["']jd-body-richtext["'][^>]*>/i);
  if (!marker || marker.index === undefined) return undefined;
  const inner = extractBalancedDiv(html, marker.index + marker[0].length);
  return inner ? getString(stripHtml(inner)) : undefined;
}

interface JobsCzWidgetConfig {
  apiKey: string;
  widgetId: string;
  host: string;
}

function extractJobsCzWidgetConfig(html: string): JobsCzWidgetConfig | undefined {
  const match = html.match(/__LMC_CAREER_WIDGET__\.push\((\{[\s\S]*?\})\);/);
  if (!match) return undefined;
  try {
    const config = JSON.parse(match[1]) as Partial<JobsCzWidgetConfig>;
    if (!config.apiKey || !config.widgetId || !config.host) return undefined;
    return { apiKey: config.apiKey, widgetId: config.widgetId, host: config.host };
  } catch {
    return undefined;
  }
}

async function fetchJobsCzWidgetDescription(
  html: string,
  sourceJobId: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const config = extractJobsCzWidgetConfig(html);
  if (!config) return undefined;

  const response = await fetchImpl(JOBS_CZ_WIDGET_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({
      query: JOBS_CZ_WIDGET_DETAIL_QUERY,
      variables: { widgetId: config.widgetId, jobAdId: sourceJobId, host: config.host },
    }),
  });
  if (!response.ok) return undefined;

  const payload = (await response.json()) as {
    data?: { widget?: { jobAd?: { content?: { htmlContent?: string } } } };
  };
  const htmlContent = payload.data?.widget?.jobAd?.content?.htmlContent;
  return htmlContent ? getString(stripHtml(htmlContent)) : undefined;
}

async function fetchJobsCzDescription(
  jobUrl: string,
  sourceJobId: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(jobUrl, {
      headers: { "user-agent": "job-ops/1.0" },
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    return (
      extractJobsCzNativeDescription(html) ??
      (await fetchJobsCzWidgetDescription(html, sourceJobId, fetchImpl))
    );
  } catch {
    return undefined;
  }
}

export async function runJobsCz(
  options: RunJobsCzOptions = {},
): Promise<JobsCzResult> {
  const searchTerms = (options.searchTerms ?? []).map((term) => term.trim()).filter(Boolean);
  const maxJobsPerTerm = Math.max(1, Math.floor(options.maxJobsPerTerm ?? 50));
  const fetchImpl = options.fetchImpl ?? fetch;
  const jobs: CreateJobInput[] = [];
  const seenIds = new Set<string>();

  try {
    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) break;
      const termIndex = index + 1;
      let termJobs = 0;
      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal: searchTerms.length,
        searchTerm,
      });

      for (let page = 1; page <= JOBS_CZ_MAX_PAGES && termJobs < maxJobsPerTerm; page += 1) {
        if (options.shouldCancel?.()) break;
        const html = await fetchPage(
          buildJobsCzSearchUrl(searchTerm, page),
          fetchImpl,
        );
        const cards = parseJobsCzCards(html);
        if (cards.length === 0) break;

        for (const card of cards) {
          if (termJobs >= maxJobsPerTerm || seenIds.has(card.sourceJobId)) continue;
          seenIds.add(card.sourceJobId);
          const job = mapJobsCzCard(card);
          const description = await fetchJobsCzDescription(
            card.jobUrl,
            card.sourceJobId,
            fetchImpl,
          );
          if (description) job.jobDescription = description;
          jobs.push(job);
          termJobs += 1;
        }
        options.onProgress?.({
          type: "page_complete",
          termIndex,
          termTotal: searchTerms.length,
          searchTerm,
          page,
          jobsFoundTerm: termJobs,
        });
      }

      options.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm: termJobs,
      });
    }

    return { success: true, jobs };
  } catch (error) {
    return {
      success: false,
      jobs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
