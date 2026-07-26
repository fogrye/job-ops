import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobDescriptionFromUrl } from "./source-job-description";

const publicListingUrl = "https://93.184.216.34/jobs/123";

describe("source job description refresh", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects private addresses before fetching", async () => {
    await expect(
      fetchJobDescriptionFromUrl("http://127.0.0.1/admin"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves hostnames and rejects private destinations", async () => {
    await expect(
      fetchJobDescriptionFromUrl("http://localhost/admin"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects redirects to private addresses", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/latest/meta-data" },
      }),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds the response before parsing HTML", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
  });

  it("rejects unsupported response types", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not HTML", {
        headers: { "content-type": "application/pdf" },
      }),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
  });

  it("preserves a fetch timeout classification", async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
  });

  it("rejects arbitrary HTML that is not a job listing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html><body>Welcome to our company blog.</body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
  });

  it("rejects job pages that report an expired listing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        '<div class="job-description">This job is no longer available.</div>',
        { headers: { "content-type": "text/html" } },
      ),
    );

    await expect(
      fetchJobDescriptionFromUrl(publicListingUrl),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
  });

  it("extracts a JobPosting structured description", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "JobPosting",
          description: "<p>Build reliable systems for customers.</p>",
        })}</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );

    await expect(fetchJobDescriptionFromUrl(publicListingUrl)).resolves.toBe(
      "Build reliable systems for customers.",
    );
  });
});
