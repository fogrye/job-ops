import { describe, expect, it, vi } from "vitest";
import { itJobsCzWatchlistAdapter } from "./itjobs-cz";

const source = {
  id: "itjobs-cz",
  catalogSourceId: null,
  label: "ITJobs.cz",
  careersUrl: "https://www.itjobs.cz/cz/volna-mista-v-it/",
  cxsJobsUrl: null,
  sourceType: "itjobs.cz",
  isCustom: true,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
} as const;

describe("itJobsCzWatchlistAdapter", () => {
  it("canonicalizes the public vacancies URL", () => {
    expect(
      itJobsCzWatchlistAdapter.normalizeCustomSelection({
        label: "",
        careersUrl: "http://itjobs.cz/cz/volna-mista-v-it/#jobs",
      }),
    ).toEqual({
      label: "ITJobs.cz",
      careersUrl: "https://www.itjobs.cz/cz/volna-mista-v-it/",
    });
  });

  it("deduplicates the responsive listing markup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<!doctype html><ul id="job-list">
            <li class="job-item"><div class="nazev"><h2><a href="https://www.itjobs.cz/cz/volna-mista-v-it/8172-platform-engineer/"><strong>Platform Engineer</strong></a></h2><span class="lokalita">Brno</span></div><p class="popis">Build platforms.</p></li>
            <li class="job-item"><div class="nazev"><h2><a href="https://www.itjobs.cz/cz/volna-mista-v-it/8172-platform-engineer/"><strong>Platform Engineer</strong></a></h2><span class="lokalita">Brno</span></div><p class="popis">Build platforms.</p></li>
          </ul>`,
          { headers: { "content-type": "text/html; charset=windows-1250" } },
        ),
      ),
    );

    await expect(
      itJobsCzWatchlistAdapter.fetchJobs({ source }),
    ).resolves.toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        {
          source: "itjobs.cz",
          sourceJobId: "8172",
          title: "Platform Engineer",
          employer: "ITJobs.cz",
          location: "Brno",
          jobUrl:
            "https://www.itjobs.cz/cz/volna-mista-v-it/8172-platform-engineer/",
        },
      ],
    });
  });
});
