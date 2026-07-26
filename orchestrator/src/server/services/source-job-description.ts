import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { AppError, requestTimeout } from "@infra/errors";
import { JSDOM } from "jsdom";
import { Agent, type Response, fetch as undiciFetch } from "undici";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type CheckedUrl = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}
blockedIpv4.addAddress("168.63.129.16", "ipv4");

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}
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
    return blockedIpv4.check(
      [
        segments[6] >> 8,
        segments[6] & 0xff,
        segments[7] >> 8,
        segments[7] & 0xff,
      ].join("."),
      "ipv4",
    );
  }

  return blockedIpv6.check(address, "ipv6");
}

async function resolveAddress(
  hostname: string,
  signal: AbortSignal,
): Promise<{ address: string; family: 4 | 6 }> {
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener("abort", cancel, { once: true });

  try {
    let addresses: string[] = [];
    let cause: unknown;
    try {
      addresses = await resolver.resolve4(hostname);
    } catch (error) {
      cause = error;
    }
    if (addresses.length === 0 && !signal.aborted) {
      try {
        addresses = await resolver.resolve6(hostname);
      } catch (error) {
        cause = error;
      }
    }
    signal.throwIfAborted();

    const address = addresses[0];
    const family = address ? isIP(address) : 0;
    if (!address || (family !== 4 && family !== 6)) {
      throw upstreamFailure(cause);
    }
    return { address, family };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function validateExternalHttpUrl(
  value: string,
  signal: AbortSignal,
): Promise<CheckedUrl> {
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
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw rejectedUrl("This URL must resolve to a public address.");
  }

  const literalFamily = isIP(hostname);
  const checkedAddress: Pick<CheckedUrl, "address" | "family"> =
    literalFamily === 4 || literalFamily === 6
      ? { address: hostname, family: literalFamily }
      : await resolveAddress(hostname, signal);
  const { address, family } = checkedAddress;

  if (
    family === 4 ? blockedIpv4.check(address, "ipv4") : isBlockedIpv6(address)
  ) {
    throw rejectedUrl("This URL must resolve to a public address.");
  }

  return { url, hostname, address, family };
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

async function fetchHtml(
  initialTarget: CheckedUrl,
  signal: AbortSignal,
): Promise<string> {
  let target = initialTarget;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const requestTarget = target;
    const dispatcher = new Agent({
      connect: {
        lookup(_hostname, _options, callback) {
          callback(null, requestTarget.address, requestTarget.family);
        },
        ...(requestTarget.url.protocol === "https:"
          ? { servername: requestTarget.hostname }
          : {}),
      },
    });
    let redirected: URL | undefined;

    try {
      const response = await undiciFetch(requestTarget.url, {
        dispatcher,
        signal,
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml;q=0.9",
        },
      });

      try {
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw upstreamFailure();
          if (redirectCount === MAX_REDIRECTS) {
            throw rejectedUrl("This URL redirects too many times.");
          }
          try {
            redirected = new URL(location, requestTarget.url);
          } catch {
            throw rejectedUrl("This URL includes an invalid redirect.");
          }
        } else if (!response.ok) {
          throw new AppError({
            status: 502,
            code: "UPSTREAM_ERROR",
            message: buildFetchFailureMessage(response.status),
            details: { upstreamStatus: response.status },
          });
        } else {
          return await readHtml(response);
        }
      } finally {
        if (!response.bodyUsed) {
          await response.body?.cancel().catch(() => undefined);
        }
      }
    } finally {
      await dispatcher.close();
    }

    if (!redirected) throw upstreamFailure();
    target = await validateExternalHttpUrl(redirected.href, signal);
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
  timeout.unref();

  try {
    const html = await fetchHtml(
      await validateExternalHttpUrl(url, controller.signal),
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
    if (controller.signal.aborted) throw requestTimeout();
    if (error instanceof AppError) throw error;
    throw upstreamFailure(error);
  } finally {
    clearTimeout(timeout);
  }
}
