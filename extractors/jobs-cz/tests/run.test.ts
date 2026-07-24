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
    <span data-test="serp-locality"><svg viewBox="0 0 16 16"><path d="M1 1"/></svg>${location}</span>
    <div class="SearchResultCard__status">Today</div>
    <div class="SearchResultCard__body">Možnost práce z domova</div>
  </article>
`;

describe("Jobs.cz extractor", () => {
  it("builds a Czech search URL with terms and page", () => {
    expect(buildJobsCzSearchUrl("platform engineer", 2)).toBe(
      "https://www.jobs.cz/prace/?q=platform+engineer&page=2",
    );
  });

  it("parses normalized job fields from result cards, ignoring perk badge text", () => {
    const [job] = parseJobsCzCards(page(card("123", "Prague")));
    expect(job).toEqual(
      expect.objectContaining({
        sourceJobId: "123",
        title: "Platform Engineer",
        employer: "Acme s.r.o.",
        jobUrl: "https://www.jobs.cz/r/123",
        location: "Prague",
      }),
    );
    expect(job).not.toHaveProperty("jobDescription");
  });

  it("paginates, deduplicates, and emits normalized source jobs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("page=2")) {
        return new Response(page(card("123", "Prague") + card("456", "Brno")));
      }
      if (url.includes("/prace/")) {
        return new Response(page(card("123", "Prague")));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await runJobsCz({
      searchTerms: ["platform engineer"],
      cityLocations: ["Prague"],
      maxJobsPerTerm: 2,
      fetchImpl,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({ source: "jobs-cz", sourceJobId: "123" }),
      expect.objectContaining({ source: "jobs-cz", sourceJobId: "456" }),
    ]);
    const searchCalls = fetchImpl.mock.calls.filter(([url]) =>
      String(url).includes("/prace/"),
    );
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[0][0]).not.toContain("locality");
    expect(searchCalls[1][0]).toContain("page=2");
  });

  it("extracts the description from a native Jobs.cz detail page", async () => {
    const detailHtml = `
      <html><body>
        <div data-jobad="body" data-test="jd-body-richtext" class="RichContent">
          <p>We are looking for a <strong>Platform Engineer</strong>.</p>
          <div><p>Own our deployment pipeline.</p></div>
        </div>
      </body></html>
    `;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/prace/")) return new Response(page(card("123", "Prague")));
      if (url.includes("/r/123")) return new Response(detailHtml);
      return new Response("not found", { status: 404 });
    });

    const result = await runJobsCz({
      searchTerms: ["platform engineer"],
      maxJobsPerTerm: 1,
      fetchImpl,
    });

    expect(result.jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "123",
        jobDescription:
          "We are looking for a Platform Engineer . Own our deployment pipeline.",
      }),
    ]);
  });

  it("extracts the description from an employer widget-hosted detail page", async () => {
    const widgetHtml = `
      <html><body>
        <div id="widget_container"></div>
        <script>
          window.__LMC_CAREER_WIDGET__ = [];
          window.__LMC_CAREER_WIDGET__.push({"apiKey":"test-api-key","widgetId":"widget-1","host":"acme.jobs.cz"});
        </script>
      </body></html>
    `;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/prace/")) return new Response(page(card("123", "Prague")));
      if (url.includes("/r/123")) return new Response(widgetHtml);
      if (url === "https://api.capybara.lmc.cz/api/graphql/widget") {
        expect(init?.headers).toMatchObject({ "x-api-key": "test-api-key" });
        expect(JSON.parse(String(init?.body)).variables).toEqual({
          widgetId: "widget-1",
          jobAdId: "123",
          host: "acme.jobs.cz",
        });
        return Response.json({
          data: {
            widget: {
              jobAd: { content: { htmlContent: "<p>Own our network infrastructure.</p>" } },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await runJobsCz({
      searchTerms: ["platform engineer"],
      maxJobsPerTerm: 1,
      fetchImpl,
    });

    expect(result.jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "123",
        jobDescription: "Own our network infrastructure.",
      }),
    ]);
  });
});
