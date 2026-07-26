import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRefreshJobDescriptionMutation } from "@/client/hooks/queries/useJobMutations";
import { showErrorToast } from "@/client/lib/error-toast";
import { trackProductEvent } from "@/lib/analytics";

export function useRefreshJobDescription(
  onJobUpdated: () => void | Promise<void>,
) {
  const [inFlightJobIds, setInFlightJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const refreshMutation = useRefreshJobDescriptionMutation();
  const isRefreshing = useCallback(
    (jobId?: string | null) => Boolean(jobId && inFlightJobIds.has(jobId)),
    [inFlightJobIds],
  );

  const refreshJobDescription = useCallback(
    async (jobId?: string | null) => {
      if (!jobId || inFlightJobIds.has(jobId)) return;

      const confirmed = window.confirm(
        "This replaces the current description, including any manual edits, and recalculates the match. Continue?",
      );
      if (!confirmed) return;

      setInFlightJobIds((prev) => new Set(prev).add(jobId));
      const toastId = toast.loading("Refreshing job description...");
      try {
        const result = await refreshMutation.mutateAsync(jobId);
        trackProductEvent("jobs_job_action_completed", {
          action: "refresh_description",
          result: "success",
        });
        toast.success(
          result.sourceRefreshed
            ? "Description refreshed and match recalculated"
            : "Source unavailable; match recalculated from current description",
          { id: toastId },
        );
        await onJobUpdated();
      } catch (error) {
        trackProductEvent("jobs_job_action_completed", {
          action: "refresh_description",
          result: "error",
        });
        showErrorToast(
          error,
          "Couldn't refresh this job's description from its source",
          { id: toastId },
        );
      } finally {
        setInFlightJobIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [inFlightJobIds, onJobUpdated, refreshMutation],
  );

  return { isRefreshing, refreshJobDescription };
}
