import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("startup-jobs-scraper", () => ({
  scrapeStartupJobsViaAlgolia: vi.fn(),
}));

describe("runStartupJobs", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the default max jobs per term when options.maxJobsPerTerm is NaN", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["backend engineer"],
      maxJobsPerTerm: Number.NaN,
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: 50,
        enrichDetails: true,
      }),
    );
  });

  it("drops broad location sentinels and falls back to selectedCountry behavior", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["platform engineer"],
      selectedCountry: "worldwide",
      locations: ["Worldwide"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: undefined,
      }),
    );
  });

  it("normalizes explicit city-country aliases before passing location to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      locations: ["UK"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "United Kingdom",
      }),
    );
  });

  it("passes workplaceType to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      workplaceTypes: ["remote", "hybrid"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["remote", "hybrid"],
      }),
    );
  });

  it("maps onsite workplaceType to the scraper's on-site value", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      workplaceTypes: ["onsite"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["on-site"],
      }),
    );
  });

  it("propagates the scraper published date into datePosted", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([
      {
        title: "Senior Software Engineer",
        employer: "Example Startup",
        jobUrl: "https://startup.jobs/example-job",
        publishedAt: "2026-05-22T08:41:29Z",
      },
    ]);

    const { runStartupJobs } = await import("../src/run");

    const result = await runStartupJobs({
      searchTerms: ["software engineer"],
    });

    expect(result.jobs[0]?.datePosted).toBe("2026-05-22T08:41:29Z");
  });

  it("falls back to a posting's JSON-LD description", async () => {
    // Runtime imports ensure the module observes the hoisted scraper mock.
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const { runStartupJobs } = await import("../src/run");
    vi.mocked(scrapeStartupJobsViaAlgolia).mockResolvedValueOnce([
      {
        title: "Platform Engineer",
        employer: "Example Startup",
        jobUrl: "https://startup.jobs/platform-engineer-example-1",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","description":"<p>Build <strong>reliable</strong> platforms.</p>"}]}</script>',
      }),
    );

    const result = await runStartupJobs({ searchTerms: ["platform engineer"] });

    expect(result.jobs[0]?.jobDescription).toBe("Build reliable platforms.");
  });
  it("repairs a placeholder employer from JSON-LD", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const { runStartupJobs } = await import("../src/run");
    vi.mocked(scrapeStartupJobsViaAlgolia).mockResolvedValueOnce([
      {
        title: "Platform Engineer",
        employer: "View company profile",
        jobUrl: "https://startup.jobs/platform-engineer-example-1",
        jobDescription: "Existing enriched description.",
        applicationLink: "https://example.com/apply",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Example Startup"}}</script>',
      }),
    );

    const result = await runStartupJobs({ searchTerms: ["platform engineer"] });

    expect(result.jobs[0]?.employer).toBe("Example Startup");
    expect(result.jobs[0]?.jobDescription).toBe(
      "Existing enriched description.",
    );
    expect(result.jobs[0]?.applicationLink).toBe("https://example.com/apply");
  });
});
