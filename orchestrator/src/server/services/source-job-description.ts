import { AppError, requestTimeout } from "@infra/errors";
import { JSDOM } from "jsdom";

function buildFetchFailureMessage(status: number): string {
  if (status === 401 || status === 403 || status === 429) {
    return "This site blocks automated fetch requests. Paste the job description manually.";
  }
  if (status === 404) {
    return "We couldn't find that page. Check the URL or paste the job description manually.";
  }
  return "Couldn't fetch this URL automatically. Paste the job description manually.";
}

/** Fetches and reduces a job listing page to its useful text content. */
export async function fetchJobDescriptionFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: buildFetchFailureMessage(response.status),
        details: { upstreamStatus: response.status },
      });
    }

    const document = new JSDOM(await response.text()).window.document;
    const pageTitle =
      document.querySelector("title")?.textContent?.trim() || "";
    const metaDescription =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogTitle =
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogDescription =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogSiteName =
      document
        .querySelector('meta[property="og:site-name"]')
        ?.getAttribute("content")
        ?.trim() || "";

    document
      .querySelectorAll(
        "script, style, nav, header, footer, aside, iframe, noscript, " +
          '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
          ".nav, .navbar, .header, .footer, .sidebar, .menu, .cookie, .popup, .modal, .ad, .advertisement",
      )
      .forEach((element) => {
        element.remove();
      });

    const mainContent =
      document.querySelector(
        'main, [role="main"], article, ' +
          ".job-description, .job-details, .job-content, .vacancy-description, " +
          "#job-description, #job-details, #job-content, " +
          '[class*="job-desc"], [class*="jobDesc"], [class*="vacancy"], [class*="posting"]',
      ) || document.body;
    const textContent = (mainContent?.textContent || "")
      .replace(/[\t ]+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const metadata = [
      pageTitle && `Page Title: ${pageTitle}`,
      ogTitle && ogTitle !== pageTitle && `Job Title: ${ogTitle}`,
      ogSiteName && `Company/Site: ${ogSiteName}`,
      ogDescription && `Summary: ${ogDescription}`,
      metaDescription &&
        metaDescription !== ogDescription &&
        `Description: ${metaDescription}`,
    ]
      .filter(Boolean)
      .join("\n");
    const content = `${metadata}${metadata ? "\n\n---\n\n" : ""}${textContent}`
      .slice(0, 50000)
      .trim();

    if (!content) {
      throw new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: "Couldn't fetch an updated description from the source site.",
      });
    }
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw requestTimeout();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
