import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRefreshJobDescriptionMutation } from "@/client/hooks/queries/useJobMutations";
import { showErrorToast } from "@/client/lib/error-toast";
import { trackProductEvent } from "@/lib/analytics";

export function useRefreshJobDescription(
  onJobUpdated: () => void | Promise<void>,
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshMutation = useRefreshJobDescriptionMutation();

  const refreshJobDescription = useCallback(
    async (jobId?: string | null) => {
      if (!jobId || isRefreshing) return;

      const confirmed = window.confirm(
        "This replaces the current description, including any manual edits, and recalculates the match. Continue?",
      );
      if (!confirmed) return;

      try {
        setIsRefreshing(true);
        await refreshMutation.mutateAsync(jobId);
        trackProductEvent("jobs_job_action_completed", {
          action: "refresh_description",
          result: "success",
        });
        toast.success("Description refreshed and match recalculated");
        await onJobUpdated();
      } catch (error) {
        trackProductEvent("jobs_job_action_completed", {
          action: "refresh_description",
          result: "error",
        });
        showErrorToast(
          error,
          "Couldn't refresh this job's description from its source",
        );
      } finally {
        setIsRefreshing(false);
      }
    },
    [isRefreshing, onJobUpdated, refreshMutation],
  );

  return { isRefreshing, refreshJobDescription };
}
