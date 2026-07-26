import * as api from "@client/api";
import {
  useMarkAsAppliedMutation,
  useSkipJobMutation,
} from "@client/hooks/queries/useJobMutations";
import { useHotkeys } from "@client/hooks/useHotkeys";
import { useProfile } from "@client/hooks/useProfile";
import { useSettings } from "@client/hooks/useSettings";
import { resolveFilenameLanguage } from "@client/lib/pdf-filename";
import { downloadJobPdf, openJobPdf } from "@client/lib/private-pdf";
import { SHORTCUTS } from "@client/lib/shortcut-map";
import type { Job, JobAction, JobListItem, JobStatus } from "@shared/types.js";
import type { MutableRefObject } from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { safeFilenamePart } from "@/lib/utils";
import type { FilterTab } from "./constants";
import { tabs } from "./constants";

type UseKeyboardShortcutsArgs = {
  isAnyModalOpen: boolean;
  isAnyModalOpenExcludingCommandBar: boolean;
  isAnyModalOpenExcludingHelp: boolean;
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJobId: string | null;
  selectedJob: JobListItem | null;
  selectedJobSummary: JobListItem | null;
  selectedJobIds: Set<string>;
  isDesktop: boolean;
  handleSelectJobId: (id: string | null) => void;
  requestScrollToJob: (id: string, opts?: { ensureSelected?: boolean }) => void;
  setActiveTab: (tab: FilterTab) => void;
  navigateToStatus: (status: JobStatus, id: string) => void;
  startTailoring: () => void;
  onJobMutation: (job: Job) => void;
  statusActionInFlightRef: MutableRefObject<boolean>;
  setIsCommandBarOpen: (open: boolean) => void;
  setIsHelpDialogOpen: (updater: (prev: boolean) => boolean) => void;
  clearSelection: () => void;
  toggleSelectJob: (id: string) => void;
  runJobAction: (action: JobAction) => Promise<void>;
  loadJobs: () => Promise<void>;
};

export function useKeyboardShortcuts(args: UseKeyboardShortcutsArgs): void {
  const {
    isAnyModalOpen,
    isAnyModalOpenExcludingCommandBar,
    isAnyModalOpenExcludingHelp,
    activeTab,
    activeJobs,
    selectedJobId,
    selectedJob,
    selectedJobSummary,
    selectedJobIds,
    isDesktop: _isDesktop,
    handleSelectJobId,
    requestScrollToJob,
    setActiveTab,
    navigateToStatus,
    onJobMutation,
    startTailoring,
    statusActionInFlightRef,
    setIsCommandBarOpen,
    setIsHelpDialogOpen,
    clearSelection,
    toggleSelectJob,
    runJobAction,
    loadJobs,
  } = args;

  const markAsAppliedMutation = useMarkAsAppliedMutation();
  const skipJobMutation = useSkipJobMutation();
  const { settings } = useSettings();
  const { personName, profile } = useProfile();
  const filenameLanguage = resolveFilenameLanguage({ settings, profile });

  const navigateJobList = useCallback(
    (direction: 1 | -1) => {
      if (activeJobs.length === 0) return;
      const currentIndex = selectedJobId
        ? activeJobs.findIndex((j) => j.id === selectedJobId)
        : -1;
      const nextIndex = Math.max(
        0,
        Math.min(activeJobs.length - 1, currentIndex + direction),
      );
      const nextJob = activeJobs[nextIndex];
      if (nextJob && nextJob.id !== selectedJobId) {
        handleSelectJobId(nextJob.id);
        requestScrollToJob(nextJob.id);
      }
    },
    [activeJobs, selectedJobId, handleSelectJobId, requestScrollToJob],
  );

  const navigateTab = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
      setActiveTab(tabs[nextIndex].id);
    },
    [activeTab, setActiveTab],
  );

  const selectNextAfterAction = useCallback(
    (movedJobId: string) => {
      const idx = activeJobs.findIndex((j) => j.id === movedJobId);
      const next = activeJobs[idx + 1] || activeJobs[idx - 1];
      handleSelectJobId(next?.id ?? null);
    },
    [activeJobs, handleSelectJobId],
  );

  const closeApplication = useCallback(
    (outcome: "rejected" | "ghosted") => {
      if (activeTab !== "applied") return;
      if (!selectedJob || selectedJob.status !== "applied") return;
      if (statusActionInFlightRef.current) return;

      statusActionInFlightRef.current = true;
      const jobId = selectedJob.id;
      api
        .updateJobOutcome(jobId, { outcome })
        .then((updatedJob) => {
          onJobMutation(updatedJob);
          toast.message("Application closed");
          selectNextAfterAction(jobId);
          void Promise.resolve()
            .then(loadJobs)
            .catch(() => {});
        })
        .catch((error: unknown) => {
          showErrorToast(error, "Failed to close application");
        })
        .finally(() => {
          statusActionInFlightRef.current = false;
        });
    },
    [
      activeTab,
      loadJobs,
      onJobMutation,
      selectNextAfterAction,
      selectedJob,
      statusActionInFlightRef,
    ],
  );

  const primaryKey =
    activeTab === "applied"
      ? SHORTCUTS["reject"]["key"]
      : SHORTCUTS.moveToReady["key"];

  useHotkeys(
    {
      // ── Navigation ──────────────────────────────────────────────────────
      [SHORTCUTS.nextJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.nextJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.prevJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },
      [SHORTCUTS.prevJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },

      // ── Tab switching ───────────────────────────────────────────────────
      [SHORTCUTS.tabReady.key]: () => setActiveTab("ready"),
      [SHORTCUTS.tabDiscovered.key]: () => setActiveTab("discovered"),
      [SHORTCUTS.tabApplied.key]: () => setActiveTab("applied"),
      [SHORTCUTS.tabAll.key]: () => setActiveTab("all"),
      [SHORTCUTS.prevTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(-1);
      },
      [SHORTCUTS.nextTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(1);
      },

      // ── Context actions ─────────────────────────────────────────────────
      [SHORTCUTS.skip.key]: () => {
        if (!["discovered", "ready"].includes(activeTab)) return;
        if (statusActionInFlightRef.current) return;

        if (selectedJobIds.size > 0) {
          statusActionInFlightRef.current = true;
          void runJobAction("skip").finally(() => {
            statusActionInFlightRef.current = false;
          });
          return;
        }

        if (!selectedJob) return;
        statusActionInFlightRef.current = true;
        const jobId = selectedJob.id;
        skipJobMutation
          .mutateAsync(jobId)
          .then(() => {
            toast.message("Job skipped");
            selectNextAfterAction(jobId);
            void Promise.resolve()
              .then(loadJobs)
              .catch(() => {});
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Failed to skip job";
            toast.error(msg);
          })
          .finally(() => {
            statusActionInFlightRef.current = false;
          });
      },

      [SHORTCUTS.markApplied.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        if (statusActionInFlightRef.current) return;
        statusActionInFlightRef.current = true;
        const jobId = selectedJob.id;
        markAsAppliedMutation
          .mutateAsync(jobId)
          .then((updatedJob) => {
            onJobMutation(updatedJob);
            toast.success("Marked as applied", {
              description: `${selectedJob.title} at ${selectedJob.employer}`,
            });
            navigateToStatus("applied", jobId);
            void Promise.resolve()
              .then(loadJobs)
              .catch(() => {});
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Failed to mark as applied";
            toast.error(msg);
          })
          .finally(() => {
            statusActionInFlightRef.current = false;
          });
      },
      [primaryKey]: () => {
        if (activeTab === "applied") {
          closeApplication("rejected");
          return;
        }
        if (activeTab !== "discovered") return;
        if (!selectedJob || selectedJob.status !== "discovered") return;
        startTailoring();
      },
      [SHORTCUTS["ghost"]["key"]]: () =>
        closeApplication("ghosted"),
      [SHORTCUTS.viewPdf.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        void openJobPdf(selectedJob.id).catch((error) => {
          showErrorToast(error, "Could not open PDF");
        });
      },

      [SHORTCUTS.downloadPdf.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        void downloadJobPdf(
          selectedJob.id,
          `${safeFilenamePart(personName || "Unknown", {
            language: filenameLanguage,
          })}_${safeFilenamePart(selectedJob.employer, {
            language: filenameLanguage,
          })}.pdf`,
        ).catch((error) => {
          showErrorToast(error, "Could not download PDF");
        });
      },

      [SHORTCUTS.openListing.key]: () => {
        const listingJob = selectedJob ?? selectedJobSummary;
        if (!listingJob) return;
        const link = listingJob.applicationLink || listingJob.jobUrl;
        if (link) window.open(link, "_blank", "noopener,noreferrer");
      },

      [SHORTCUTS.toggleSelect.key]: () => {
        if (!selectedJobId) return;
        toggleSelectJob(selectedJobId);
      },

      [SHORTCUTS.clearSelection.key]: () => {
        if (selectedJobIds.size > 0) clearSelection();
      },
    },
    { enabled: !isAnyModalOpen },
  );

  useHotkeys(
    {
      // ── Search ──────────────────────────────────────────────────────────
      [SHORTCUTS.searchSlash.key]: (e) => {
        e.preventDefault();
        setIsCommandBarOpen(true);
      },
    },
    { enabled: !isAnyModalOpenExcludingCommandBar },
  );

  useHotkeys(
    {
      // ── Help ────────────────────────────────────────────────────────────
      [SHORTCUTS.help.key]: (e) => {
        e.preventDefault();
        setIsHelpDialogOpen((prev) => !prev);
      },
    },
    { enabled: !isAnyModalOpenExcludingHelp },
  );
}
