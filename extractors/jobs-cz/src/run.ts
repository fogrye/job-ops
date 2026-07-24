import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";

const JOBS_CZ_BASE_URL = "https://www.jobs.cz";
const JOBS_CZ_SEARCH_PATH = "/prace/";
const JOBS_CZ_MAX_PAGES = 50;
const JOBS_CZ_WIDGET_API_URL = "https://api.capybara.lmc.cz/api/graphql/widget";
const JOBS_CZ_ALLOWED_HOST = "jobs.cz";
const JOBS_CZ_MAX_REDIRECTS = 5;
const JOBS_CZ_WIDGET_DETAIL_QUERY = `
  query DETAIL_QUERY($widgetId: ID!, $jobAdId: ID!, $host: String) {
    widget(id: $widgetId, host: $host) {
      jobAd(id: $jobAdId) {
        content { htmlContent }
      }
    }
  }
`;

function isAllowedJobsCzUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (
      url.hostname !== JOBS_CZ_ALLOWED_HOST &&
      !url.hostname.endsWith(`.${JOBS_CZ_ALLOWED_HOST}`)
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Fetches a URL that MUST resolve to https://jobs.cz or an https subdomain
 * on every hop, following redirects manually so each hop is re-validated.
 * `jobUrl` on a job row can be user-edited, so this is the SSRF boundary for
 * every network call this extractor makes from a job-supplied URL.
 */
async function fetchJobsCzAllowlisted(
  value: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<{ response: Response; url: string } | undefined> {
  let current = isAllowedJobsCzUrl(value);
  if (!current) return undefined;

  for (let hop = 0; hop <= JOBS_CZ_MAX_REDIRECTS; hop += 1) {
    const url = current.toString();
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400)
      return { response, url };

    const location = response.headers.get("location");
    if (!location) return undefined;
    const next = isAllowedJobsCzUrl(new URL(location, current).toString());
    if (!next) return undefined;
    current = next;
  }
  return undefined;
}

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

const HTML_NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  lt: "<",
  gt: ">",
};

function decodeHtml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] !== "#")
        return HTML_NAMED_ENTITIES[body.toLowerCase()] ?? entity;
      const codePoint =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff)
        return entity;
      return String.fromCodePoint(codePoint);
    },
  );
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
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return getString(match?.[2]);
}

function absoluteUrl(
  value: string | undefined,
  base: string = JOBS_CZ_BASE_URL,
): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function firstMatchText(card: string, pattern: RegExp): string | undefined {
  return getString(stripHtml(card.match(pattern)?.[1] ?? ""));
}

export function buildJobsCzSearchUrl(searchTerm: string, page = 1): string {
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

function extractBalancedDiv(
  html: string,
  contentStart: number,
): string | undefined {
  const tagPattern = /<(\/)?div\b[^>]*>/gi;
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match = tagPattern.exec(html);
  while (match) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, match.index);
    match = tagPattern.exec(html);
  }
  return undefined;
}

function extractJobsCzNativeDescription(html: string): string | undefined {
  const marker = html.match(
    /<div\b[^>]*data-test=["']jd-body-richtext["'][^>]*>/i,
  );
  if (!marker || marker.index === undefined) return undefined;
  const inner = extractBalancedDiv(html, marker.index + marker[0].length);
  return inner ? getString(stripHtml(inner)) : undefined;
}

interface JobsCzWidgetConfig {
  apiKey: string;
  widgetId: string;
  host: string;
}

function extractJobsCzInlineWidgetConfig(
  html: string,
): JobsCzWidgetConfig | undefined {
  const match = html.match(/__LMC_CAREER_WIDGET__\.push\((\{[\s\S]*?\})\);/);
  if (!match) return undefined;
  try {
    const config = JSON.parse(match[1]) as Partial<JobsCzWidgetConfig>;
    if (!config.apiKey || !config.widgetId || !config.host) return undefined;
    return {
      apiKey: config.apiKey,
      widgetId: config.widgetId,
      host: config.host,
    };
  } catch {
    return undefined;
  }
}

function extractJsonParseLiteral(
  script: string,
  quoteStart: number,
): string | undefined {
  let cursor = quoteStart;
  let escaped = false;
  while (cursor < script.length) {
    const char = script[cursor];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "'") {
      return script.slice(quoteStart, cursor).replace(/\\'/g, "'");
    }
    cursor += 1;
  }
  return undefined;
}

function extractJobsCzScriptWidgetConfig(
  script: string,
  widgetName: string,
): JobsCzWidgetConfig | undefined {
  const markerPattern = /JSON\.parse\('/g;
  for (
    let marker = markerPattern.exec(script);
    marker;
    marker = markerPattern.exec(script)
  ) {
    const literal = extractJsonParseLiteral(
      script,
      marker.index + marker[0].length,
    );
    if (!literal) continue;
    try {
      const parsed = JSON.parse(literal) as {
        host?: string;
        widgets?: Record<string, { id?: string; apiKey?: string }>;
      };
      const widget =
        parsed.widgets?.[widgetName] ?? Object.values(parsed.widgets ?? {})[0];
      if (parsed.host && widget?.id && widget.apiKey) {
        return {
          apiKey: widget.apiKey,
          widgetId: widget.id,
          host: parsed.host,
        };
      }
    } catch {
      // Not the widget config blob; keep scanning other JSON.parse(...) literals.
    }
  }
  return undefined;
}

async function fetchJobsCzScriptWidgetConfig(
  html: string,
  pageUrl: string,
  fetchImpl: typeof fetch,
): Promise<JobsCzWidgetConfig | undefined> {
  const scriptSrc = html.match(
    /<script\b[^>]*src=["']([^"']*script\.min\.js[^"']*)["']/i,
  )?.[1];
  const scriptUrl = absoluteUrl(scriptSrc, pageUrl);
  if (!scriptUrl) return undefined;

  const fetched = await fetchJobsCzAllowlisted(scriptUrl, fetchImpl);
  if (!fetched || !fetched.response.ok) return undefined;
  const script = await fetched.response.text();
  const widgetName = html.match(/data-widget=["']([^"']+)["']/i)?.[1] ?? "main";
  return extractJobsCzScriptWidgetConfig(script, widgetName);
}

async function fetchJobsCzWidgetDescription(
  html: string,
  pageUrl: string,
  sourceJobId: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const config =
    extractJobsCzInlineWidgetConfig(html) ??
    (await fetchJobsCzScriptWidgetConfig(html, pageUrl, fetchImpl));
  if (!config) return undefined;

  const response = await fetchImpl(JOBS_CZ_WIDGET_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({
      query: JOBS_CZ_WIDGET_DETAIL_QUERY,
      variables: {
        widgetId: config.widgetId,
        jobAdId: sourceJobId,
        host: config.host,
      },
    }),
  });
  if (!response.ok) return undefined;

  const payload = (await response.json()) as {
    data?: { widget?: { jobAd?: { content?: { htmlContent?: string } } } };
  };
  const htmlContent = payload.data?.widget?.jobAd?.content?.htmlContent;
  return htmlContent ? getString(stripHtml(htmlContent)) : undefined;
}

export async function fetchJobsCzDescription(
  jobUrl: string,
  sourceJobId: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const fetched = await fetchJobsCzAllowlisted(jobUrl, fetchImpl, {
      headers: { "user-agent": "job-ops/1.0" },
    });
    if (!fetched || !fetched.response.ok) return undefined;
    const html = await fetched.response.text();
    const pageUrl = fetched.url;
    return (
      extractJobsCzNativeDescription(html) ??
      (await fetchJobsCzWidgetDescription(
        html,
        pageUrl,
        sourceJobId,
        fetchImpl,
      ))
    );
  } catch {
    return undefined;
  }
}

export async function runJobsCz(
  options: RunJobsCzOptions = {},
): Promise<JobsCzResult> {
  const searchTerms = (options.searchTerms ?? [])
    .map((term) => term.trim())
    .filter(Boolean);
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

      for (
        let page = 1;
        page <= JOBS_CZ_MAX_PAGES && termJobs < maxJobsPerTerm;
        page += 1
      ) {
        if (options.shouldCancel?.()) break;
        const html = await fetchPage(
          buildJobsCzSearchUrl(searchTerm, page),
          fetchImpl,
        );
        const cards = parseJobsCzCards(html);
        if (cards.length === 0) break;

        for (const card of cards) {
          if (termJobs >= maxJobsPerTerm || seenIds.has(card.sourceJobId))
            continue;
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
