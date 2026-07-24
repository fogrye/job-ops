import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Jobs summarize route", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function createManualJobId(): Promise<string> {
    const response = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/job/1",
          jobDescription: "Build APIs",
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data?: { id?: string };
    };
    expect(body.ok).toBe(true);
    const jobId = body.data?.id;
    if (!jobId) {
      throw new Error("Expected manual job import to return job id");
    }
    return jobId;
  }

  it("dispatches summarize in the background and reports status via polling", async () => {
    const jobId = await createManualJobId();
    const pipelineModule = await import("@server/pipeline/index");
    vi.mocked(pipelineModule.summarizeJob).mockResolvedValueOnce({
      success: true,
    });

    const startedAt = Date.now();
    const startRes = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize`, {
      method: "POST",
    });
    const elapsedMs = Date.now() - startedAt;
    const startBody = await startRes.json();

    expect(startRes.status).toBe(202);
    expect(startBody.ok).toBe(true);
    expect(startBody.data).toEqual({ jobId, status: "pending" });
    expect(elapsedMs).toBeLessThan(2000);

    let statusBody: { ok: boolean; data?: { status: string; job?: any } } = {
      ok: false,
    };
    await vi.waitFor(async () => {
      const statusRes = await fetch(
        `${baseUrl}/api/jobs/${jobId}/summarize/status`,
      );
      statusBody = await statusRes.json();
      expect(statusBody.data?.status).not.toBe("pending");
    });

    expect(statusBody.ok).toBe(true);
    expect(statusBody.data?.status).toBe("succeeded");
    expect(statusBody.data?.job.id).toBe(jobId);
  });

  it("surfaces a failed summarize result through the status endpoint", async () => {
    const jobId = await createManualJobId();
    const pipelineModule = await import("@server/pipeline/index");
    vi.mocked(pipelineModule.summarizeJob).mockResolvedValueOnce({
      success: false,
      error: "LLM API key not configured",
    });

    const startRes = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize`, {
      method: "POST",
    });
    expect(startRes.status).toBe(202);

    let statusRes: Response | undefined;
    await vi.waitFor(async () => {
      statusRes = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize/status`);
      const body = await statusRes.clone().json();
      expect(body.ok).toBe(false);
    });

    expect(statusRes?.status).toBe(400);
  });

  it("rejects a duplicate summarize request while one is already pending", async () => {
    const jobId = await createManualJobId();
    const pipelineModule = await import("@server/pipeline/index");

    let releaseSummarize: (() => void) | undefined;
    vi.mocked(pipelineModule.summarizeJob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSummarize = () => resolve({ success: true });
        }),
    );

    const firstRes = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize`, {
      method: "POST",
    });
    expect(firstRes.status).toBe(202);

    const secondRes = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize`, {
      method: "POST",
    });
    const secondBody = await secondRes.json();
    expect(secondRes.status).toBe(409);
    expect(secondBody.ok).toBe(false);

    releaseSummarize?.();
  });

  it("reports a missing operation for a job whose summarize was never started", async () => {
    const jobId = await createManualJobId();

    const res = await fetch(`${baseUrl}/api/jobs/${jobId}/summarize/status`);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});
