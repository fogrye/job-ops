import { upstreamError } from "@infra/errors";
import { convert } from "html-to-text";
import { JSDOM } from "jsdom";

export const CZECH_BOARD_MAX_JOBS = 40;

export interface ParsedCzechDetail {
  jobUrl: string;
  title: string;
  externalId: string;
  employer?: string;
  location?: string;
  postedAt?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  employmentStatus?: string;
}

export async function fetchDocument(
  url: string,
  signal: AbortSignal | undefined,
  encoding: "utf-8" | "windows-1250" = "utf-8",
): Promise<{ document: Document; finalUrl: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": "job-ops/1.0" },
    redirect: "follow",
    signal,
  });
  if (!response.ok) {
    throw upstreamError(`Czech job board returned HTTP ${response.status}.`, {
      url,
      status: response.status,
    });
  }

  const bytes = await response.arrayBuffer();
  const html = new TextDecoder(encoding).decode(bytes);
  return {
    document: new JSDOM(html).window.document,
    finalUrl: response.url,
  };
}

export function htmlToText(html: string): string {
  return convert(html, { wordwrap: false }).trim();
}

export function cleanText(
  value: string | null | undefined,
): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

export function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

export function buildManualDraft(
  source: { label: string },
  sourceKey: string,
  details: ParsedCzechDetail,
) {
  return {
    source: sourceKey,
    sourceJobId: details.externalId,
    title: details.title,
    employer: details.employer ?? source.label,
    jobUrl: details.jobUrl,
    applicationLink: details.jobUrl,
    location: details.location,
    jobDescription: details.jobDescriptionText,
    jobType: details.employmentStatus,
  };
}
