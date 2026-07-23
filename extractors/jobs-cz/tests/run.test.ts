import { describe, expect, it, vi } from "vitest";
import { buildJobsCzSearchUrl, parseJobsCzCards, runJobsCz } from "../src/run";

const page = (cards: string) => `
  <div class="SearchHeader">2 jobs</div>
  ${cards}
`;

const card = (id: string, location: string) => `
  <article class="SearchResultCard">
    <a href="/r/${id}" data-jobad-id="${id}">Platform Engineer</a>
    <span translate="no">Acme s.r.o.</span>
    <span data-test="serp-locality">${location}</span>
    <div class="SearchResultCard__status">Today</div>
    <div class="SearchResultCard__body"><p>Build reliable systems.</p></div>
  </article>
`;

describe("Jobs.cz extractor", () => {
  it("builds a Czech search URL with terms, cities, and page", () => {
    expect(buildJobsCzSearchUrl("platform engineer", 2, ["Prague"])).toBe(
      "https://www.jobs.cz/prace/?q=platform+engineer&locality=Prague&page=2",
    );
  });

  it("parses normalized job fields from result cards", () => {
    expect(parseJobsCzCards(page(card("123", "Prague")))).toEqual([
      expect.objectContaining({
        sourceJobId: "123",
        title: "Platform Engineer",
        employer: "Acme s.r.o.",
        jobUrl: "https://www.jobs.cz/r/123",
        location: "Prague",
        jobDescription: "Build reliable systems.",
      }),
    ]);
  });

  it("paginates, deduplicates, and emits normalized source jobs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(page(card("123", "Prague"))))
      .mockResolvedValueOnce(new Response(page(card("123", "Prague") + card("456", "Brno"))));

    const result = await runJobsCz({
      searchTerms: ["platform engineer"],
      maxJobsPerTerm: 2,
      fetchImpl,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({ source: "jobs-cz", sourceJobId: "123" }),
      expect.objectContaining({ source: "jobs-cz", sourceJobId: "456" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("page=2");
  });
});
