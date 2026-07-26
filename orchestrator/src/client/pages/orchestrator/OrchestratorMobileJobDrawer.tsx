import type { Job, JobListItem, JobStatus } from "@shared/types.js";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import type { FilterTab } from "./constants";
import { JobDetailPanel } from "./JobDetailPanel";
import type { SelectedJobLoadState } from "./useOrchestratorData";

interface OrchestratorMobileJobDrawerProps {
  open: boolean;
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJob: Job | null;
  selectedJobListItem: JobListItem | null;
  selectedJobLoadState: SelectedJobLoadState;
  onOpenChange: (open: boolean) => void;
  onSelectJobId: (jobId: string | null) => void;
  onNavigateToStatus: (status: JobStatus, jobId: string) => void;
  onJobUpdated: () => Promise<void>;
  onJobMutation: (job: Job) => void;
  onPauseRefreshChange: (paused: boolean) => void;
  onRetrySelectedJob: () => void;
  statusActionInFlightRef: React.MutableRefObject<boolean>;
}

export const OrchestratorMobileJobDrawer: React.FC<
  OrchestratorMobileJobDrawerProps
> = ({
  open,
  activeTab,
  activeJobs,
  selectedJob,
  selectedJobListItem,
  selectedJobLoadState,
  onOpenChange,
  onSelectJobId,
  onNavigateToStatus,
  onJobUpdated,
  onJobMutation,
  onPauseRefreshChange,
  onRetrySelectedJob,
  statusActionInFlightRef,
}) => (
  <Drawer open={open} onOpenChange={onOpenChange}>
    <DrawerContent className="max-h-[90vh]">
      <div className="flex items-center justify-between px-4 pt-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Job details
        </div>
        <DrawerClose asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
            Close
          </Button>
        </DrawerClose>
      </div>
      <div className="max-h-[calc(90vh-3.5rem)] overflow-y-auto px-4 pb-6 pt-3">
        <JobDetailPanel
          activeTab={activeTab}
          activeJobs={activeJobs}
          selectedJob={selectedJob}
          selectedJobListItem={selectedJobListItem}
          selectedJobLoadState={selectedJobLoadState}
          onSelectJobId={onSelectJobId}
          onNavigateToStatus={onNavigateToStatus}
          onJobUpdated={onJobUpdated}
          onJobMutation={onJobMutation}
          onPauseRefreshChange={onPauseRefreshChange}
          onRetrySelectedJob={onRetrySelectedJob}
          statusActionInFlightRef={statusActionInFlightRef}
        />
      </div>
    </DrawerContent>
  </Drawer>
);
