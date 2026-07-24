import { act } from "@testing-library/react";
import type { Job } from "@shared/types";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderHookWithQueryClient } from "../test/renderWithQueryClient";
import { useRefreshJobDescription } from "./useRefreshJobDescription";

vi.mock("../api", () => ({
  refreshJobDescriptionFromSource: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useRefreshJobDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing and calls no API when the user cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHookWithQueryClient(() =>
      useRefreshJobDescription(onJobUpdated),
    );

    await act(async () => {
      await result.current.refreshJobDescription("job-1");
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(api.refreshJobDescriptionFromSource).not.toHaveBeenCalled();
    expect(onJobUpdated).not.toHaveBeenCalled();
    expect(result.current.isRefreshing).toBe(false);
  });

  it("refreshes the job and shows a toast once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.refreshJobDescriptionFromSource).mockResolvedValue(
      {} as Job,
    );

    const { result } = renderHookWithQueryClient(() =>
      useRefreshJobDescription(onJobUpdated),
    );

    await act(async () => {
      await result.current.refreshJobDescription("job-1");
    });

    expect(api.refreshJobDescriptionFromSource).toHaveBeenCalledWith(
      "job-1",
    );
    expect(onJobUpdated).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Description refreshed and match recalculated",
    );
  });
});
