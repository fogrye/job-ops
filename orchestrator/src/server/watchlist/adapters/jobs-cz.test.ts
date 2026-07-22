import { describe, expect, it, vi } from "vitest";
import { jobsCzWatchlistAdapter } from "./jobs-cz";

const source = {
  id: "jobs-cz",
  catalogSourceId: null,
  label: "Developer jobs",
  careersUrl: "https://www.jobs.cz/prace/?q=developer&lang=en",
  cxsJobsUrl: null,
  sourceType: "jobs.cz",
  isCustom: true,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
} as const;

describe("jobsCzWatchlistAdapter", () => {
  it("canonicalizes custom search URLs without dropping filters", () => {
    expect(
      jobsCzWatchlistAdapter.normalizeCustomSelection({
        label: "",
        careersUrl: "http://jobs.cz/prace/?q=developer&lang=en#results",
      }),
    ).toEqual({
      label: "Jobs.cz",
      careersUrl: "https://www.jobs.cz/prace/?q=developer&lang=en",
    });
  });

  it("parses listing cards into stable normalized jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<!doctype html><div class="SearchHeader"><strong>1 job offer</strong></div>
          <article class="SearchResultCard">
            <h2><a data-jobad-id="1234567" href="https://www.jobs.cz/rpd/1234567/">Platform Engineer</a></h2>
            <div class="SearchResultCard__body"><span>Hybrid</span></div>
            <div class="SearchResultCard__footerItem"><span translate="no">Acme s.r.o.</span></div>
            <li data-test="serp-locality">Prague</li>
            <div class="SearchResultCard__status">22. July</div>
          </article>`,
          { headers: { "content-type": "text/html" } },
        ),
      ),
    );

    await expect(
      jobsCzWatchlistAdapter.fetchJobs({ source }),
    ).resolves.toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        {
          source: "jobs.cz",
          sourceJobId: "1234567",
          title: "Platform Engineer",
          employer: "Acme s.r.o.",
          location: "Prague",
          jobUrl: "https://www.jobs.cz/rpd/1234567/",
        },
      ],
    });
  });

  it("loads detail data from the current Capybara widget bootstrap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://t-mobile.jobs.cz/detail-pozice?r=detail&id=2000215646",
        arrayBuffer: async () =>
          new TextEncoder().encode(
            `<div id="vacancy-detail"></div><script src="/assets/js/script.min.js"></script>`,
          ).buffer,
      })
      .mockResolvedValueOnce(
        new Response(
          `{"widgets":{"main":{"id":"widget-id","apiKey":"widget-key"}}}`,
          { headers: { "content-type": "application/javascript" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              widget: {
                jobAd: {
                  id: "2000215646",
                  title: "Senior Network Engineer",
                  validFrom: "2026-07-22",
                  content: { htmlContent: "<p>Build resilient networks.</p>" },
                  locations: [{ city: "Prague", country: "Czechia" }],
                  employer: { companyName: "T-Mobile Czech Republic a.s." },
                  parameters: {
                    employmentTypesObjects: [{ label: "Full-time" }],
                  },
                },
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      jobsCzWatchlistAdapter.prepareImportDraft({
        source,
        jobRef: "https://t-mobile.jobs.cz/detail-pozice?r=detail&id=2000215646",
      }),
    ).resolves.toMatchObject({
      draft: {
        source: "jobs.cz",
        sourceJobId: "2000215646",
        title: "Senior Network Engineer",
        employer: "T-Mobile Czech Republic a.s.",
        location: "Prague, Czechia",
        jobDescription: "Build resilient networks.",
        jobType: "Full-time",
      },
    });
  });
});
