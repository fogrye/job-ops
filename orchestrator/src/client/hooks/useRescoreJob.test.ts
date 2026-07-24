import type { Job } from "@shared/types";
import { act } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderHookWithQueryClient } from "../test/renderWithQueryClient";
import { useRescoreJob } from "./useRescoreJob";

vi.mock("../api", () => ({
  rescoreJob: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-1"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useRescoreJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rescoring updates the job and shows a toast", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.rescoreJob).mockResolvedValue({} as any);

    const { result } = renderHookWithQueryClient(() =>
      useRescoreJob(onJobUpdated),
    );

    await act(async () => {
      await result.current.rescoreJob("job-1");
    });

    expect(api.rescoreJob).toHaveBeenCalledWith("job-1");
    expect(onJobUpdated).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Match recalculated", {
      id: "toast-1",
    });
  });

  it("ignores a second rescore call while one is already in flight", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    // Promise.withResolvers() is unavailable: tsconfig target/lib is ES2022.
    let resolveRescore: (value: Job) => void = () => {};
    vi.mocked(api.rescoreJob).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRescore = resolve;
        }),
    );

    const { result } = renderHookWithQueryClient(() =>
      useRescoreJob(onJobUpdated),
    );

    let firstCallPromise: Promise<void> | undefined;
    await act(async () => {
      firstCallPromise = result.current.rescoreJob("job-1");
      await Promise.resolve();
    });
    expect(result.current.isRescoring("job-1")).toBe(true);

    await act(async () => {
      await result.current.rescoreJob("job-1");
    });
    expect(api.rescoreJob).toHaveBeenCalledTimes(1);

    resolveRescore?.({} as Job);
    await act(async () => {
      await firstCallPromise;
    });
    expect(result.current.isRescoring("job-1")).toBe(false);
  });

  it("tracks in-flight state per job so rescoring one job never blocks another", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    let resolveJob1: (value: Job) => void = () => {};
    vi.mocked(api.rescoreJob).mockImplementation(
      (jobId) =>
        new Promise((resolve) => {
          if (jobId === "job-1") resolveJob1 = resolve;
          else resolve({} as Job);
        }),
    );

    const { result } = renderHookWithQueryClient(() =>
      useRescoreJob(onJobUpdated),
    );

    let job1Promise: Promise<void> | undefined;
    await act(async () => {
      job1Promise = result.current.rescoreJob("job-1");
      await Promise.resolve();
    });
    expect(result.current.isRescoring("job-1")).toBe(true);
    expect(result.current.isRescoring("job-2")).toBe(false);

    await act(async () => {
      await result.current.rescoreJob("job-2");
    });
    expect(api.rescoreJob).toHaveBeenCalledWith("job-2");
    expect(result.current.isRescoring("job-2")).toBe(false);

    resolveJob1({} as Job);
    await act(async () => {
      await job1Promise;
    });
    expect(result.current.isRescoring("job-1")).toBe(false);
  });
});
