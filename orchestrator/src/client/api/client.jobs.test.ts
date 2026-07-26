import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./client";

function createJsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe("job client helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.__resetApiClientAuthForTests();
  });

  afterEach(() => {
    api.__resetApiClientAuthForTests();
  });

  it("recalculates from the stored description when the source is unavailable", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse(202, {
          ok: true,
          data: { jobId: "job-1", status: "pending" },
          meta: { requestId: "req-start" },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          ok: true,
          data: {
            status: "failed",
            error: { code: "UPSTREAM_ERROR", message: "Source blocked" },
          },
          meta: { requestId: "req-status" },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          ok: true,
          data: {
            action: "rescore",
            requested: 1,
            succeeded: 1,
            failed: 0,
            results: [{ jobId: "job-1", ok: true, job: { id: "job-1" } }],
          },
          meta: { requestId: "req-rescore" },
        }),
      );

    await expect(api.refreshJobDescriptionFromSource("job-1")).resolves.toEqual(
      {
        job: { id: "job-1" },
        sourceRefreshed: false,
      },
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/jobs/actions",
      expect.any(Object),
    );
  });
});
