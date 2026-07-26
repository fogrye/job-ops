import type { JobListItem, JobStatus } from "@shared/types.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  type ArchiveFilter,
  type FilterTab,
  jobMatchesTab,
  tabs,
} from "./constants";

const validTabs: FilterTab[] = ["ready", "discovered", "applied", "all"];

const commandSelectionFilterKeys = [
  "source",
  "sponsor",
  "salaryMode",
  "salaryMin",
  "salaryMax",
  "minSalary",
  "date",
  "appliedRange",
  "appliedStart",
  "appliedEnd",
  "postedWithin",
  "employment",
  "location",
  "archive",
];

interface UseOrchestratorNavigationArgs {
  archiveFilter: ArchiveFilter;
  searchParams: URLSearchParams;
}

export function useOrchestratorNavigation({
  searchParams,
  archiveFilter,
}: UseOrchestratorNavigationArgs) {
  const { tab, jobId } = useParams<{ tab: string; jobId?: string }>();
  const navigate = useNavigate();
  const activeTab = useMemo(() => {
    if (tab && validTabs.includes(tab as FilterTab)) {
      return tab as FilterTab;
    }
    return "ready";
  }, [tab]);

  const navigateWithContext = useCallback(
    (newTab: string, newJobId?: string | null, isReplace = false) => {
      const search = searchParams.toString();
      const suffix = search ? `?${search}` : "";
      const path = newJobId
        ? `/jobs/${newTab}/${newJobId}${suffix}`
        : `/jobs/${newTab}${suffix}`;
      navigate(path, { replace: isReplace });
    },
    [navigate, searchParams],
  );

  const selectedJobId = jobId || null;

  useEffect(() => {
    if (tab === "in_progress") {
      navigate("/applications/in-progress", { replace: true });
      return;
    }
    if (tab && !validTabs.includes(tab as FilterTab)) {
      navigateWithContext("ready", null, true);
    }
  }, [tab, navigate, navigateWithContext]);

  const handleSelectJobId = useCallback(
    (id: string | null) => {
      navigateWithContext(activeTab, id);
    },
    [activeTab, navigateWithContext],
  );

  const setActiveTab = useCallback(
    (newTab: FilterTab, jobs: JobListItem[]) => {
      const selectedItem = selectedJobId
        ? jobs.find((job) => job.id === selectedJobId)
        : null;
      const jobFitsTab = selectedItem
        ? jobMatchesTab(selectedItem, newTab, archiveFilter)
        : false;

      navigateWithContext(newTab, jobFitsTab ? selectedJobId : null);
    },
    [archiveFilter, navigateWithContext, selectedJobId],
  );

  const navigateToStatus = useCallback(
    (status: JobStatus, id: string) => {
      if (status === "in_progress") {
        navigate("/applications/in-progress");
        return;
      }
      const targetTab = tabs.find((item) => item.statuses.includes(status))?.id;
      if (targetTab) navigateWithContext(targetTab, id);
    },
    [navigate, navigateWithContext],
  );

  const navigateToCommandJob = useCallback(
    (targetTab: FilterTab, id: string, archiveFilter?: ArchiveFilter) => {
      const nextParams = new URLSearchParams(searchParams);
      for (const key of commandSelectionFilterKeys) {
        nextParams.delete(key);
      }
      if (archiveFilter) nextParams.set("archive", archiveFilter);
      const query = nextParams.toString();
      navigate(`/jobs/${targetTab}/${id}${query ? `?${query}` : ""}`);
    },
    [navigate, searchParams],
  );

  const openArchivedJobs = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("archive", "archived");
    navigate(`/jobs/all?${nextParams.toString()}`);
  }, [navigate, searchParams]);

  return {
    activeTab,
    selectedJobId,
    navigateWithContext,
    handleSelectJobId,
    setActiveTab,
    navigateToStatus,
    navigateToCommandJob,
    openArchivedJobs,
  };
}

export function useNavigationRefresh(onRefreshJobs: () => Promise<void>) {
  const location = useLocation();
  const lastNavigationRefreshRef = useRef<number | null>(null);

  useEffect(() => {
    const state = location.state as { refreshJobsAt?: number } | null;
    const refreshJobsAt = state?.refreshJobsAt;
    if (!refreshJobsAt || refreshJobsAt === lastNavigationRefreshRef.current) {
      return;
    }
    lastNavigationRefreshRef.current = refreshJobsAt;
    void onRefreshJobs();
  }, [location.state, onRefreshJobs]);
}
