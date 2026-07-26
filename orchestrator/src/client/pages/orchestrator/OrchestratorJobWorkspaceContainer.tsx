import { KeyboardShortcutBar } from "@client/components/KeyboardShortcutBar";
import { KeyboardShortcutDialog } from "@client/components/KeyboardShortcutDialog";
import type { Job, JobListItem, JobStatus } from "@shared/types.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VirtualListHandle } from "@/client/lib/virtual-list";
import { type ClosureFilter, type FilterTab, jobMatchesTab } from "./constants";
import { FloatingJobActionsBar } from "./FloatingJobActionsBar";
import { OrchestratorJobsWorkspace } from "./OrchestratorJobsWorkspace";
import { OrchestratorMobileJobDrawer } from "./OrchestratorMobileJobDrawer";
import type { RunMode } from "./run-mode";
import { useFilteredJobs } from "./useFilteredJobs";
import { useJobSelectionActions } from "./useJobSelectionActions";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { SelectedJobLoadState } from "./useOrchestratorData";
import type { useOrchestratorFilters } from "./useOrchestratorFilters";
import type { useOrchestratorNavigation } from "./useOrchestratorNavigation";
import type { useOrchestratorUiState } from "./useOrchestratorUiState";
import { useScrollToJobItem } from "./useScrollToJobItem";
import { getJobCounts, getSourcesWithJobs } from "./utils";

interface OrchestratorJobWorkspaceContainerProps {
  jobs: JobListItem[];
  selectedJob: Job | null;
  selectedJobListItem: JobListItem | null;
  selectedJobLoadState: SelectedJobLoadState;
  retrySelectedJob: () => void;
  stats: Record<JobStatus, number>;
  isLoading: boolean;
  isPipelineRunning: boolean;
  loadJobs: () => Promise<void>;
  seedJob: (job: Job) => void;
  setIsRefreshPaused: (paused: boolean) => void;
  showSponsorInfo: boolean;
  filters: ReturnType<typeof useOrchestratorFilters>;
  navigation: ReturnType<typeof useOrchestratorNavigation>;
  ui: ReturnType<typeof useOrchestratorUiState>;
  openRunMode: (mode: RunMode) => void;
}

export const OrchestratorJobWorkspaceContainer: React.FC<
  OrchestratorJobWorkspaceContainerProps
> = ({
  jobs,
  selectedJob,
  selectedJobListItem,
  selectedJobLoadState,
  retrySelectedJob,
  stats,
  isLoading,
  isPipelineRunning,
  loadJobs,
  seedJob,
  setIsRefreshPaused,
  filters,
  showSponsorInfo,
  navigation,
  ui,
  openRunMode,
}) => {
  const jobListHandleRef = useRef<VirtualListHandle | null>(null);
  const statusActionInFlightRef = useRef(false);
  const [startTailoringToken, setStartTailoringToken] = useState(0);
  const requestStartTailoring = useCallback(
    () => setStartTailoringToken((token) => token + 1),
    [],
  );
  const activeJobs = useFilteredJobs(jobs, {
    activeTab: navigation.activeTab,
    closureFilter: filters.closureFilter,
    dateFilter: filters.dateFilter,
    sourceFilter: filters.sourceFilter,
    sponsorFilter: filters.sponsorFilter,
    showSponsorInfo,
    salaryFilter: filters.salaryFilter,
    postedWithinDays: filters.postedWithinDays,
    employmentTypes: filters.employmentTypes,
    location: filters.location,
    sort: filters.sort,
  });
  const counts = useMemo(() => getJobCounts(jobs), [jobs]);
  const sourcesWithJobs = useMemo(() => getSourcesWithJobs(jobs), [jobs]);
  const handleTabChange = useCallback(
    (newTab: FilterTab) => navigation.setActiveTab(newTab, jobs),
    [jobs, navigation],
  );

  const visibleSelectedJob = useMemo(() => {
    if (!selectedJob) return null;
    return jobMatchesTab(
      selectedJob,
      navigation.activeTab,
      filters.closureFilter,
    )
      ? selectedJob
      : null;
  }, [filters.closureFilter, navigation.activeTab, selectedJob]);
  const visibleSelectedJobListItem = useMemo(() => {
    if (!selectedJobListItem) return null;
    return jobMatchesTab(
      selectedJobListItem,
      navigation.activeTab,
      filters.closureFilter,
    )
      ? selectedJobListItem
      : null;
  }, [filters.closureFilter, navigation.activeTab, selectedJobListItem]);

  const {
    selectedJobIds,
    canSkipSelected,
    canMoveSelected,
    canRescoreSelected,
    canRefreshDescriptionSelected,
    jobActionInFlight,
    toggleSelectJob,
    toggleSelectAll,
    clearSelection,
    runJobAction,
  } = useJobSelectionActions({
    activeJobs,
    activeTab: navigation.activeTab,
    loadJobs,
  });

  useEffect(() => {
    if (isLoading || filters.sourceFilter === "all") return;
    if (!sourcesWithJobs.includes(filters.sourceFilter)) {
      filters.setSourceFilter("all");
    }
  }, [filters, isLoading, sourcesWithJobs]);

  const handleSelectJob = useCallback(
    (id: string) => {
      navigation.handleSelectJobId(id);
      ui.openDetailDrawerForMobile();
    },
    [navigation, ui],
  );

  const { requestScrollToJob } = useScrollToJobItem({
    activeJobs,
    selectedJobId: navigation.selectedJobId,
    isDesktop: ui.isDesktop,
    onEnsureJobSelected: (id) =>
      navigation.navigateWithContext(navigation.activeTab, id, true),
    listHandleRef: jobListHandleRef,
  });

  useKeyboardShortcuts({
    isAnyModalOpen: ui.isAnyModalOpen,
    isAnyModalOpenExcludingCommandBar: ui.isAnyModalOpenExcludingCommandBar,
    isAnyModalOpenExcludingHelp: ui.isAnyModalOpenExcludingHelp,
    activeTab: navigation.activeTab,
    activeJobs,
    selectedJobId: navigation.selectedJobId,
    selectedJob: visibleSelectedJob,
    selectedJobSummary: visibleSelectedJobListItem,
    selectedJobIds,
    isDesktop: ui.isDesktop,
    startTailoring: requestStartTailoring,
    handleSelectJobId: navigation.handleSelectJobId,
    requestScrollToJob,
    setActiveTab: handleTabChange,
    navigateToStatus: navigation.navigateToStatus,
    onJobMutation: seedJob,
    statusActionInFlightRef,
    setIsCommandBarOpen: ui.setIsCommandBarOpen,
    setIsHelpDialogOpen: ui.setIsHelpDialogOpen,
    clearSelection,
    toggleSelectJob,
    runJobAction,
    loadJobs,
  });
  const handleCommandSelectJob = useCallback(
    (targetTab: FilterTab, id: string, closureFilter?: ClosureFilter) => {
      requestScrollToJob(id, { ensureSelected: true });
      navigation.navigateToCommandJob(targetTab, id, closureFilter);
      ui.openDetailDrawerForMobile();
    },
    [navigation, requestScrollToJob, ui],
  );

  useEffect(() => {
    if (isLoading) return;
    if (activeJobs.length === 0) {
      if (navigation.selectedJobId) navigation.handleSelectJobId(null);
      return;
    }
    if (!navigation.selectedJobId && ui.isDesktop) {
      navigation.navigateWithContext(
        navigation.activeTab,
        activeJobs[0].id,
        true,
      );
    }
  }, [activeJobs, isLoading, navigation, ui.isDesktop]);

  const primaryEmptyStateAction = useMemo(() => {
    if (navigation.activeTab === "ready" && counts.discovered > 0) {
      return {
        label: "Tailor discovered jobs",
        onClick: () => handleTabChange("discovered"),
      };
    }

    if (
      navigation.activeTab === "discovered" ||
      navigation.activeTab === "all"
    ) {
      return {
        label: "Run search",
        onClick: () => openRunMode("automatic"),
      };
    }

    return undefined;
  }, [counts.discovered, handleTabChange, navigation.activeTab, openRunMode]);

  const secondaryEmptyStateAction = useMemo(() => {
    if (navigation.activeTab === "ready") {
      return {
        label: "Run search",
        onClick: () => openRunMode("automatic"),
      };
    }

    return undefined;
  }, [navigation.activeTab, openRunMode]);

  const emptyStateMessage = useMemo(() => {
    if (filters.dateFilter.dimensions.length === 0) {
      return undefined;
    }

    return "No jobs match the selected date filters.";
  }, [filters.dateFilter.dimensions.length]);

  return (
    <>
      <div
        className={
          selectedJobIds.size > 0
            ? "pb-24 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:pb-0"
            : "lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col"
        }
      >
        <OrchestratorJobsWorkspace
          stats={stats}
          isPipelineRunning={isPipelineRunning}
          jobs={jobs}
          activeJobs={activeJobs}
          selectedJob={visibleSelectedJob}
          selectedJobListItem={visibleSelectedJobListItem}
          selectedJobLoadState={
            visibleSelectedJobListItem ? selectedJobLoadState : "idle"
          }
          selectedJobId={navigation.selectedJobId}
          selectedJobIds={selectedJobIds}
          activeTab={navigation.activeTab}
          counts={counts}
          isDesktop={ui.isDesktop}
          isLoading={isLoading}
          isCommandBarOpen={ui.isCommandBarOpen}
          commandBarEnabled={!ui.isAnyModalOpenExcludingCommandBar}
          sourceFilter={filters.sourceFilter}
          closureFilter={filters.closureFilter}
          sponsorFilter={filters.sponsorFilter}
          salaryFilter={filters.salaryFilter}
          postedWithinDays={filters.postedWithinDays}
          employmentTypes={filters.employmentTypes}
          locationFilter={filters.location}
          dateFilter={filters.dateFilter}
          sourcesWithJobs={sourcesWithJobs}
          sort={filters.sort}
          filteredCount={activeJobs.length}
          isFiltersOpen={ui.isFiltersOpen}
          jobListHandleRef={jobListHandleRef}
          primaryEmptyStateAction={primaryEmptyStateAction}
          secondaryEmptyStateAction={secondaryEmptyStateAction}
          emptyStateMessage={emptyStateMessage}
          onCommandBarOpenChange={ui.setIsCommandBarOpen}
          onCommandSelectJob={handleCommandSelectJob}
          onTabChange={handleTabChange}
          onFiltersOpenChange={ui.setIsFiltersOpen}
          onSourceFilterChange={filters.setSourceFilter}
          showSponsorInfo={showSponsorInfo}
          onClosureFilterChange={filters.setClosureFilter}
          onSponsorFilterChange={filters.setSponsorFilter}
          onSalaryFilterChange={filters.setSalaryFilter}
          onPostedWithinChange={filters.setPostedWithinDays}
          onEmploymentTypesChange={filters.setEmploymentTypes}
          onLocationFilterChange={filters.setLocation}
          onDateFilterChange={filters.setDateFilter}
          onSortChange={filters.setSort}
          onResetFilters={filters.resetFilters}
          onSelectJob={handleSelectJob}
          onToggleSelectJob={toggleSelectJob}
          onToggleSelectAll={toggleSelectAll}
          onSelectJobId={navigation.handleSelectJobId}
          onNavigateToStatus={navigation.navigateToStatus}
          onJobUpdated={loadJobs}
          onJobMutation={seedJob}
          onStartTailoring={requestStartTailoring}
          startTailoringToken={startTailoringToken}
          onStartTailoringConsumed={() => setStartTailoringToken(0)}
          onPauseRefreshChange={setIsRefreshPaused}
          onRetrySelectedJob={retrySelectedJob}
          statusActionInFlightRef={statusActionInFlightRef}
        />
      </div>

      <FloatingJobActionsBar
        selectedCount={selectedJobIds.size}
        canMoveSelected={canMoveSelected}
        canSkipSelected={canSkipSelected}
        canRescoreSelected={canRescoreSelected}
        canRefreshDescriptionSelected={canRefreshDescriptionSelected}
        jobActionInFlight={jobActionInFlight !== null}
        onMoveToReady={() => void runJobAction("move_to_ready")}
        onSkipSelected={() => void runJobAction("skip")}
        onRescoreSelected={() => void runJobAction("rescore")}
        onRefreshDescriptionSelected={() =>
          void runJobAction("refresh_description")
        }
        onClear={clearSelection}
      />

      {!ui.isDesktop && (
        <OrchestratorMobileJobDrawer
          open={ui.isDetailDrawerOpen}
          activeTab={navigation.activeTab}
          activeJobs={activeJobs}
          selectedJob={visibleSelectedJob}
          selectedJobListItem={visibleSelectedJobListItem}
          selectedJobLoadState={
            visibleSelectedJobListItem ? selectedJobLoadState : "idle"
          }
          onOpenChange={ui.onDetailDrawerOpenChange}
          onSelectJobId={navigation.handleSelectJobId}
          onNavigateToStatus={navigation.navigateToStatus}
          onJobUpdated={loadJobs}
          onJobMutation={seedJob}
          onPauseRefreshChange={setIsRefreshPaused}
          onRetrySelectedJob={retrySelectedJob}
          statusActionInFlightRef={statusActionInFlightRef}
        />
      )}

      <KeyboardShortcutBar activeTab={navigation.activeTab} />
      <KeyboardShortcutDialog
        open={ui.isHelpDialogOpen}
        onOpenChange={ui.onHelpDialogOpenChange}
        activeTab={navigation.activeTab}
      />
    </>
  );
};
