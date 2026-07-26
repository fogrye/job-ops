import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, requestTimeout } from "@infra/errors";
import { JSDOM } from "jsdom";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const JOB_CONTENT_SELECTOR = [
  "[data-job-description]",
  '[data-testid*="job-description" i]',
  "#job-description",
  "#job-details",
  "#job-content",
  ".job-description",
  ".job-details",
  ".job-content",
  ".vacancy-description",
  '[class*="job-desc" i]',
  '[class*="job_description" i]',
  '[class*="job-details" i]',
  '[class*="job_details" i]',
  '[class*="vacancy-description" i]',
].join(", ");

function buildFetchFailureMessage(status: number): string {
  if (status === 401 || status === 403 || status === 429) {
    return "This site blocks automated fetch requests. Paste the job description manually.";
  }
  if (status === 404) {
    return "We couldn't find that page. Check the URL or paste the job description manually.";
  }
  return "Couldn't fetch this URL automatically. Paste the job description manually.";
}

function rejectedUrl(message: string): AppError {
  return new AppError({
    status: 422,
    code: "UNPROCESSABLE_ENTITY",
    message,
  });
}

function upstreamFailure(cause?: unknown): AppError {
  return new AppError({
    status: 502,
    code: "UPSTREAM_ERROR",
    message:
      "Couldn't fetch this URL automatically. Paste the job description manually.",
    cause,
  });
}

function isBlockedIpv4(address: string): boolean {
  const [first, second, third, fourth] = address
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 100 && second === 100 && third === 100) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      (second === 0 || second === 168 || (second === 88 && third === 99))) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 168 && second === 63 && third === 129 && fourth === 16)
  );
}

function ipv6Segments(address: string): number[] {
  const lastColon = address.lastIndexOf(":");
  const lastPart = address.slice(lastColon + 1);
  const normalized = lastPart.includes(".")
    ? `${address.slice(0, lastColon)}:${lastPart
        .split(".")
        .map((part) => Number.parseInt(part, 10).toString(16).padStart(2, "0"))
        .join("")
        .replace(/^(.{4})(.{4})$/, "$1:$2")}`
    : address;
  const [head, tail] = normalized.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];

  return [
    ...headParts,
    ...Array(8 - headParts.length - tailParts.length).fill("0"),
    ...tailParts,
  ].map((part) => Number.parseInt(part, 16));
}

function isBlockedIpv6(address: string): boolean {
  const segments = ipv6Segments(address);
  const isIpv4Embedded = segments
    .slice(0, 6)
    .every((segment, index) =>
      index === 5 ? segment === 0 || segment === 0xffff : segment === 0,
    );
  if (isIpv4Embedded) {
    return isBlockedIpv4(
      [
        segments[6] >> 8,
        segments[6] & 0xff,
        segments[7] >> 8,
        segments[7] & 0xff,
      ].join("."),
    );
  }

  const isLoopback =
    segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
  const isUnspecified = segments.every((segment) => segment === 0);
  const isLinkLocal = (segments[0] & 0xffc0) === 0xfe80;
  const isPrivate = (segments[0] & 0xfe00) === 0xfc00;
  const isMulticast = (segments[0] & 0xff00) === 0xff00;
  const isSiteLocal = (segments[0] & 0xffc0) === 0xfec0;

  return (
    isLoopback ||
    isUnspecified ||
    isLinkLocal ||
    isPrivate ||
    isMulticast ||
    isSiteLocal
  );
}

async function validateExternalHttpUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw rejectedUrl("Enter a valid public HTTP(S) URL.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw rejectedUrl("Enter a valid public HTTP(S) URL.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses =
    isIP(hostname) === 0
      ? await lookup(hostname, { all: true, verbatim: true }).catch((error) => {
          throw upstreamFailure(error);
        })
      : [{ address: hostname }];

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => {
      const family = isIP(address);
      return (
        family === 0 ||
        (family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address))
      );
    })
  ) {
    throw rejectedUrl("This URL must resolve to a public address.");
  }

  return url;
}

async function readHtml(response: Response): Promise<string> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.toLowerCase();
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    throw rejectedUrl("This URL did not return an HTML job listing.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw rejectedUrl("This page is too large to fetch automatically.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw upstreamFailure();
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw rejectedUrl("This page is too large to fetch automatically.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function fetchHtml(url: URL, signal: AbortSignal): Promise<string> {
  let target = url;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const response = await fetch(target, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw upstreamFailure();
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw rejectedUrl("This URL redirects too many times.");
      }
      let redirected: URL;
      try {
        redirected = new URL(location, target);
      } catch {
        throw rejectedUrl("This URL includes an invalid redirect.");
      }
      target = await validateExternalHttpUrl(redirected.href);
      continue;
    }

    if (!response.ok) {
      throw new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: buildFetchFailureMessage(response.status),
        details: { upstreamStatus: response.status },
      });
    }

    return readHtml(response);
  }

  throw rejectedUrl("This URL redirects too many times.");
}

function normalizeText(value: string): string {
  return value
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findStructuredJobDescription(document: Document): string | null {
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      const parsed: unknown = JSON.parse(script.textContent || "");
      const graph =
        parsed !== null &&
        typeof parsed === "object" &&
        "@graph" in parsed &&
        Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [];
      const entries = Array.isArray(parsed) ? parsed : [parsed, ...graph];
      const posting = entries.find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const type = (entry as Record<string, unknown>)["@type"];
        return (Array.isArray(type) ? type : [type]).some(
          (value) =>
            typeof value === "string" &&
            (value === "JobPosting" || value.endsWith("/JobPosting")),
        );
      }) as Record<string, unknown> | undefined;
      if (typeof posting?.description === "string") {
        const template = document.createElement("template");
        template.innerHTML = posting.description;
        const description = normalizeText(template.content.textContent || "");
        if (description) return description;
      }
    } catch {
      // Ignore malformed structured data and try job-specific page content.
    }
  }

  return null;
}

function findJobSpecificContent(document: Document): string | null {
  const content = Array.from(document.querySelectorAll(JOB_CONTENT_SELECTOR))
    .map((element) => normalizeText(element.textContent || ""))
    .sort((left, right) => right.length - left.length)[0];
  return content || null;
}

function isStatusPage(document: Document): boolean {
  const title = document.querySelector("title")?.textContent || "";
  const heading = document.querySelector("h1")?.textContent || "";
  const text = normalizeText(document.body?.textContent || "");
  const signal = `${title}\n${heading}\n${text.slice(0, 4_000)}`.toLowerCase();
  const status =
    /(job (?:is )?no longer available|job not found|position (?:is )?no longer available|page not found|access denied|verify you are human|checking your browser|just a moment|captcha|sign in to continue|log in to continue|consent required)/;

  return (
    status.test(signal) &&
    (status.test(`${title}\n${heading}`.toLowerCase()) || text.length < 1_500)
  );
}

/** Fetches and reduces a public job listing page to its useful text content. */
export async function fetchJobDescriptionFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const html = await fetchHtml(
      await validateExternalHttpUrl(url),
      controller.signal,
    );
    const dom = new JSDOM(html);
    try {
      const { document } = dom.window;
      if (isStatusPage(document)) {
        throw rejectedUrl(
          "This page is not an active job listing. Paste the job description manually.",
        );
      }

      const structuredDescription = findStructuredJobDescription(document);
      document
        .querySelectorAll(
          "script, style, nav, header, footer, aside, iframe, noscript, " +
            '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
            ".nav, .navbar, .header, .footer, .sidebar, .menu, .cookie, .popup, .modal, .ad, .advertisement",
        )
        .forEach((element) => {
          element.remove();
        });
      const content = (
        structuredDescription ||
        findJobSpecificContent(document) ||
        ""
      ).slice(0, 50_000);

      if (!content) {
        throw rejectedUrl(
          "This page does not contain a recognizable job description. Paste it manually.",
        );
      }
      return content;
    } finally {
      dom.window.close();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw requestTimeout();
    }
    throw upstreamFailure(error);
  } finally {
    clearTimeout(timeout);
  }
}
