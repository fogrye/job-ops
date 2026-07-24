import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRescoreJobMutation } from "@/client/hooks/queries/useJobMutations";
import { showErrorToast } from "@/client/lib/error-toast";
import { trackProductEvent } from "@/lib/analytics";

export function useRescoreJob(onJobUpdated: () => void | Promise<void>) {
  const [inFlightJobIds, setInFlightJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const rescoreMutation = useRescoreJobMutation();

  const isRescoring = useCallback(
    (jobId?: string | null) => Boolean(jobId && inFlightJobIds.has(jobId)),
    [inFlightJobIds],
  );

  const rescoreJob = useCallback(
    async (jobId?: string | null) => {
      if (!jobId || inFlightJobIds.has(jobId)) return;

      setInFlightJobIds((prev) => new Set(prev).add(jobId));
      const toastId = toast.loading("Calculating match score...");
      try {
        await rescoreMutation.mutateAsync(jobId);
        trackProductEvent("jobs_job_action_completed", {
          action: "rescore",
          result: "success",
        });
        toast.success("Match recalculated", { id: toastId });
        await onJobUpdated();
      } catch (error) {
        trackProductEvent("jobs_job_action_completed", {
          action: "rescore",
          result: "error",
        });
        showErrorToast(error, "Failed to recalculate match", { id: toastId });
      } finally {
        setInFlightJobIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [inFlightJobIds, onJobUpdated, rescoreMutation],
  );

  return { isRescoring, rescoreJob };
}
