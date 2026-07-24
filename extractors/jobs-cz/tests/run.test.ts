import { describe, expect, it, vi } from "vitest";
import {
  buildJobsCzSearchUrl,
  fetchJobsCzDescription,
  parseJobsCzCards,
  runJobsCz,
} from "../src/run";

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

  it("decodes decimal and hex HTML entities without double-decoding already-escaped markup", () => {
    const entityCard = `
      <article class="SearchResultCard">
        <a href="/r/999" data-jobad-id="999">R&#43;D Engineer &#x2013; &amp;#43; literal</a>
        <span translate="no">Acme s.r.o.</span>
      </article>
    `;
    const [job] = parseJobsCzCards(page(entityCard));
    expect(job?.title).toBe("R+D Engineer – &#43; literal");
  });

  it("paginates, deduplicates, and emits normalized source jobs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("page=2")) {
          return new Response(
            page(card("123", "Prague") + card("456", "Brno")),
          );
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
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/prace/"))
          return new Response(page(card("123", "Prague")));
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
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/prace/"))
          return new Response(page(card("123", "Prague")));
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
                jobAd: {
                  content: {
                    htmlContent: "<p>Own our network infrastructure.</p>",
                  },
                },
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

  it("extracts the description from a script-bundle widget config (no inline push)", async () => {
    const reactWidgetHtml = `
      <html><body>
        <div id="vacancy-detail" data-widget="main"></div>
        <script src="/assets/js/script.min.js?av=abc123"></script>
      </body></html>
    `;
    const scriptBundle = `
      other(module.exports=JSON.parse('{"vacancyCount":{"wordOne":"job"}}'));
      config(module.exports=JSON.parse('{"id":"tmobile","host":"t-mobile.jobs.cz","widgets":{"main":{"id":"widget-2","apiKey":"script-api-key"}}}'));
    `;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/prace/"))
          return new Response(page(card("123", "Prague")));
        if (url.includes("/r/123")) return new Response(reactWidgetHtml);
        if (url.includes("/assets/js/script.min.js"))
          return new Response(scriptBundle);
        if (url === "https://api.capybara.lmc.cz/api/graphql/widget") {
          expect(init?.headers).toMatchObject({
            "x-api-key": "script-api-key",
          });
          expect(JSON.parse(String(init?.body)).variables).toEqual({
            widgetId: "widget-2",
            jobAdId: "123",
            host: "t-mobile.jobs.cz",
          });
          return Response.json({
            data: {
              widget: {
                jobAd: {
                  content: {
                    htmlContent: "<p>Own our security operations.</p>",
                  },
                },
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
        jobDescription: "Own our security operations.",
      }),
    ]);
  });
});

describe("fetchJobsCzDescription SSRF allowlist", () => {
  it("never fetches a non-https jobUrl", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await fetchJobsCzDescription(
      "http://jobs.cz/r/123",
      "123",
      fetchImpl,
    );
    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never fetches an off-domain jobUrl", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await fetchJobsCzDescription(
      "https://evil.example.com/r/123",
      "123",
      fetchImpl,
    );
    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never fetches a localhost or private-IP jobUrl", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const target of [
      "https://localhost/r/123",
      "https://127.0.0.1/r/123",
      "https://169.254.169.254/latest/meta-data/",
    ]) {
      expect(
        await fetchJobsCzDescription(target, "123", fetchImpl),
      ).toBeUndefined();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops following a redirect that leaves the allowed host", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/steal" },
      });
    });
    const result = await fetchJobsCzDescription(
      "https://www.jobs.cz/r/123",
      "123",
      fetchImpl,
    );
    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
