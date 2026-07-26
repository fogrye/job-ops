import * as api from "@client/api";
import * as privatePdf from "@client/lib/private-pdf";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import { createAppSettings, createJob } from "@shared/testing/factories.js";
import type { AppSettings, Job } from "@shared/types.js";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobDetailPanel } from "./JobDetailPanel";

const render = (ui: Parameters<typeof renderWithQueryClient>[0]) =>
  renderWithQueryClient(ui);

const mockSettings = {
  settings: null as AppSettings | null,
  error: null,
  isLoading: false,
  showSponsorInfo: true,
  renderMarkdownInJobDescriptions: true,
  refreshSettings: vi.fn(),
};

vi.mock("@/components/ui/dropdown-menu", () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div role="menu">{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...props
    }: {
      children: React.ReactNode;
      onSelect?: () => void;
    }) => (
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelect?.()}
        {...props}
      >
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuSubTrigger: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      disabled?: boolean;
    }) => (
      <button type="button" role="menuitem" {...props}>
        {children}
      </button>
    ),
    DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => (
      <div role="menu">{children}</div>
    ),
  };
});

vi.mock("@client/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@client/components")>();
  return {
    ...actual,
    JobHeader: ({
      job,
      jobCTA,
      onCheckSponsor,
    }: {
      job: Job;
      jobCTA?: React.ReactNode;
      onCheckSponsor?: () => Promise<void>;
    }) => (
      <div data-testid="job-header">
        <span>{job.title}</span>
        <span>{job.employer}</span>
        {onCheckSponsor ? (
          <button type="button" onClick={() => void onCheckSponsor()}>
            Check sponsor
          </button>
        ) : null}
        {jobCTA}
      </div>
    ),
    JobBriefPane: () => <div data-testid="job-brief-pane" />,
    TailoredSummary: () => <div data-testid="tailored-summary" />,
  };
});

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: () => mockSettings,
}));

vi.mock("@client/components/tailoring/TailoringWorkspace", () => ({
  TailoringWorkspace: ({
    job,
    onDirtyChange,
    startGenerationToken = 0,
    onStartGenerationConsumed,
    onTailoringCompleted,
  }: {
    job: Job;
    onDirtyChange?: (isDirty: boolean) => void;
    startGenerationToken?: number;
    onStartGenerationConsumed?: () => void;
    onTailoringCompleted?: (job: Job) => void | Promise<void>;
  }) => (
    <div
      data-start-generation-token={startGenerationToken}
      data-testid="tailoring-workspace"
    >
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Mark tailoring dirty
      </button>
      <button type="button" onClick={() => onDirtyChange?.(false)}>
        Mark tailoring clean
      </button>
      <button type="button" onClick={onStartGenerationConsumed}>
        Consume tailoring start
      </button>
      <button type="button" onClick={() => void onTailoringCompleted?.(job)}>
        Complete tailoring
      </button>
    </div>
  ),
}));

vi.mock("@client/components/JobDetailsEditDrawer", () => ({
  JobDetailsEditDrawer: ({
    open,
    onOpenChange,
    onJobUpdated,
    job,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onJobUpdated: () => Promise<void>;
    job: Job | null;
  }) =>
    open ? (
      <div data-testid="job-details-edit-drawer">
        <div>{job?.id}</div>
        <button
          type="button"
          onClick={() => {
            void onJobUpdated();
            onOpenChange(false);
          }}
        >
          Save details
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
    formatJobForWebhook: vi.fn(() => "payload"),
  };
});

vi.mock("@client/api", () => ({
  updateJob: vi.fn(),
  updateJobOutcome: vi.fn(),
  processJob: vi.fn(),
  generateJobPdf: vi.fn(),
  markAsApplied: vi.fn(),
  skipJob: vi.fn(),
  checkSponsor: vi.fn(),
  getProfile: vi.fn().mockResolvedValue({}),
  getResumeProjectsCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@client/lib/private-pdf", () => ({
  downloadJobPdf: vi.fn().mockResolvedValue(undefined),
  openJobPdf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

type JobDetailPanelTestProps = Omit<
  React.ComponentProps<typeof JobDetailPanel>,
  | "selectedJobListItem"
  | "selectedJobLoadState"
  | "onRetrySelectedJob"
  | "onJobMutation"
  | "statusActionInFlightRef"
> &
  Partial<
    Pick<
      React.ComponentProps<typeof JobDetailPanel>,
      | "selectedJobListItem"
      | "selectedJobLoadState"
      | "onRetrySelectedJob"
      | "onJobMutation"
      | "statusActionInFlightRef"
    >
  >;

const renderJobDetailPanel = async (props: JobDetailPanelTestProps) => {
  const rendered = render(
    <JobDetailPanel
      selectedJobListItem={props.selectedJob}
      selectedJobLoadState="idle"
      onRetrySelectedJob={vi.fn()}
      onJobMutation={vi.fn()}
      statusActionInFlightRef={{ current: false }}
      {...props}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
};

const getApplyPanel = () => screen.getByRole("tabpanel", { name: /apply/i });

describe("JobDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.settings = null;
    mockSettings.renderMarkdownInJobDescriptions = true;
    mockSettings.showSponsorInfo = true;
    vi.mocked(api.getProfile).mockResolvedValue({});
  });

  it("shows the selected job summary and safe links while full details load", async () => {
    const summary = createJob({
      id: "job-2",
      title: "Platform Engineer",
      employer: "Example Ltd",
      status: "discovered",
      applicationLink: "https://example.com/apply/job-2",
    });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [summary],
      selectedJob: null,
      selectedJobListItem: summary,
      selectedJobLoadState: "loading",
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.getByText("Example Ltd")).toBeInTheDocument();
    expect(screen.getByTestId("job-detail-skeleton")).toBeInTheDocument();
    expect(screen.getByText("Loading full job details…")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open job listing/i }),
    ).toHaveAttribute("href", "https://example.com/apply/job-2");
    expect(screen.getByRole("tab", { name: /brief/i })).toBeDisabled();
    expect(screen.queryByText("Start Tailoring")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /more actions/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the summary and offers retry when detail loading fails", async () => {
    const onRetrySelectedJob = vi.fn();
    const summary = createJob({
      id: "job-2",
      title: "Platform Engineer",
      employer: "Example Ltd",
      status: "discovered",
    });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [summary],
      selectedJob: null,
      selectedJobListItem: summary,
      selectedJobLoadState: "error",
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
      onRetrySelectedJob,
    });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load job details",
    );
    expect(screen.queryByTestId("job-detail-skeleton")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySelectedJob).toHaveBeenCalledTimes(1);
  });

  it("renders discovered jobs in the unified inspector", async () => {
    const job = createJob({ id: "job-99", status: "discovered" });

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByText("Start Tailoring")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Base description extracted from the job listing, editable if something looks off. Used by the Ghostwriter and for fit assessment.",
      ),
    ).toBeInTheDocument();
  });

  it("starts tailoring from the detail action", async () => {
    const job = createJob({ id: "job-99", status: "discovered" });
    const onStartTailoring = vi.fn();

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onStartTailoring,
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /start tailoring/i }));

    const buttonIcon = screen
      .getByRole("button", { name: "Start Tailoring" })
      .querySelector("svg");
    const menuIcon = screen
      .getByRole("menuitem", { name: "Start tailoring" })
      .querySelector("svg");
    expect(menuIcon?.innerHTML).toBe(buttonIcon?.innerHTML);

    expect(onStartTailoring).toHaveBeenCalledTimes(1);
  });

  it("completes tailoring and navigates to Ready from one start", async () => {
    const job = createJob({ id: "job-99", status: "discovered" });
    const readyJob = createJob({ id: "job-99", status: "ready" });
    const onNavigateToStatus = vi.fn();
    const onJobMutation = vi.fn();
    vi.mocked(api.generateJobPdf).mockResolvedValue(readyJob);

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onNavigateToStatus,
      onJobMutation,
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /start tailoring/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /complete tailoring/i }),
    );

    await waitFor(() =>
      expect(api.generateJobPdf).toHaveBeenCalledWith("job-99"),
    );
    expect(onJobMutation).toHaveBeenNthCalledWith(1, job);
    expect(onJobMutation).toHaveBeenNthCalledWith(2, readyJob);
    expect(onNavigateToStatus).toHaveBeenCalledWith("ready", "job-99");
  });

  it("offers completion from persisted tailoring after remount", async () => {
    const job = createJob({
      id: "job-99",
      status: "discovered",
      tailoredSummary: "Persisted summary",
      tailoredSkills: "Persisted skills",
    });
    vi.mocked(api.generateJobPdf).mockResolvedValue(
      createJob({ id: "job-99", status: "ready" }),
    );

    await renderJobDetailPanel({
      activeTab: "discovered",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /finish tailoring/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /complete tailoring/i }),
    );

    await waitFor(() =>
      expect(api.generateJobPdf).toHaveBeenCalledWith("job-99"),
    );
  });
  it("shows stale PDF copy and old-PDF actions in the application kit", async () => {
    const job = createJob({
      status: "ready",
      pdfPath: "data/pdfs/job-1.pdf",
      pdfSource: "generated",
      pdfFreshness: "stale",
    });

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("tab", { name: /apply/i }));

    expect(
      screen.getByText(
        "PDF is out of date. A new one will regenerate automatically.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download old pdf/i }),
    ).toBeEnabled();
    expect(
      within(getApplyPanel()).queryByRole("button", { name: /view old pdf/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /view old pdf/i }),
    ).toBeEnabled();
  });

  it("promotes Mark Applied after the ready job listing is opened", async () => {
    const job = createJob({
      status: "ready",
      jobUrl: "https://example.com/apply",
      applicationLink: null,
    });

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    const applyPanel = within(getApplyPanel());
    const openListing = applyPanel.getByRole("link", {
      name: /open job listing/i,
    });
    const markApplied = applyPanel.getByRole("button", {
      name: /mark applied/i,
    });

    expect(openListing).toHaveClass("bg-emerald-600");
    expect(markApplied).not.toHaveClass("bg-emerald-600");

    fireEvent.click(openListing);

    expect(openListing).not.toHaveClass("bg-emerald-600");
    expect(markApplied).toHaveClass("bg-emerald-600");
  });

  it("downloads PDFs with language-aware German transliteration", async () => {
    mockSettings.settings = createAppSettings({
      chatStyleLanguageMode: {
        value: "manual",
        default: "manual",
        override: null,
      },
      chatStyleManualLanguage: {
        value: "german",
        default: "english",
        override: null,
      },
    });
    vi.mocked(api.getProfile).mockResolvedValue({
      basics: {
        name: "Müller",
      },
    });
    const job = createJob({
      id: "job-1",
      employer: "Büro Straße",
      pdfPath: "data/pdfs/job-1.pdf",
      status: "ready",
    });

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));

    await waitFor(() =>
      expect(privatePdf.downloadJobPdf).toHaveBeenCalledWith(
        "job-1",
        "Mueller_Buero_Strasse.pdf",
      ),
    );
  });

  it("disables application-kit PDF actions while regeneration is active", async () => {
    const job = createJob({
      status: "ready",
      pdfPath: "data/pdfs/job-1.pdf",
      pdfSource: "generated",
      pdfRegenerating: true,
      pdfFreshness: "regenerating",
    });

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [job],
      selectedJob: job,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("tab", { name: /apply/i }));

    expect(
      screen.getByRole("button", { name: /download pdf/i }),
    ).toBeDisabled();
    expect(
      within(getApplyPanel()).queryByRole("button", { name: /view pdf/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when no job is selected", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: null,
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByText("No job selected")).toBeInTheDocument();
  });

  it("renders a stripped description preview for html content", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "<p>Hello <strong>world</strong></p>",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: /job description/i }));

    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" && node.textContent === "Hello world",
      ),
    ).toBeInTheDocument();
  });
  it("collapses the description when navigating to another job", async () => {
    const rendered = await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        id: "job-1",
        status: "applied",
        jobDescription: "First description",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    const descriptionTrigger = screen.getByRole("button", {
      name: /job description/i,
    });
    fireEvent.click(descriptionTrigger);
    expect(descriptionTrigger).toHaveAttribute("aria-expanded", "true");

    const nextJob = createJob({
      id: "job-2",
      status: "applied",
      jobDescription: "Second description",
    });
    rendered.rerender(
      <JobDetailPanel
        activeTab="all"
        activeJobs={[]}
        selectedJob={nextJob}
        selectedJobListItem={nextJob}
        selectedJobLoadState="idle"
        onSelectJobId={vi.fn()}
        onJobUpdated={vi.fn().mockResolvedValue(undefined)}
        onJobMutation={vi.fn()}
        onRetrySelectedJob={vi.fn()}
        statusActionInFlightRef={{ current: false }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /job description/i }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("renders markdown in the brief job description when enabled", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "# Responsibilities\n\n- Build APIs",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: /job description/i }));

    expect(
      screen.getByRole("heading", { name: "Responsibilities" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("# Responsibilities")).not.toBeInTheDocument();
  });

  it("shows a view job link in the job description actions", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobUrl: "https://example.com/jobs/source-listing",
        applicationLink: "https://example.com/apply/company",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    const viewJobLink = screen.getByRole("link", { name: /view job/i });

    expect(viewJobLink).toHaveAttribute(
      "href",
      "https://example.com/jobs/source-listing",
    );
    expect(viewJobLink).toHaveAttribute("target", "_blank");
    expect(viewJobLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders raw markdown in the brief job description when disabled", async () => {
    mockSettings.renderMarkdownInJobDescriptions = false;

    const rendered = await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        jobDescription: "# Responsibilities\n\n- Build APIs",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: /job description/i }));

    const rawDescription = rendered.container.querySelector(
      "div.whitespace-pre-wrap",
    );
    expect(rawDescription?.textContent).toBe(
      "# Responsibilities\n\n- Build APIs",
    );
    expect(
      screen.queryByRole("heading", { name: "Responsibilities" }),
    ).not.toBeInTheDocument();
  });

  it("saves an edited description", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.updateJob).mockResolvedValue(createJob());

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "applied", jobDescription: "Original" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });
    fireEvent.click(screen.getByRole("button", { name: /job description/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    fireEvent.change(screen.getByPlaceholderText("Enter job description..."), {
      target: { value: "Updated description" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateJob).toHaveBeenCalledWith("job-1", {
        jobDescription: "Updated description",
      }),
    );
    expect(onJobUpdated).toHaveBeenCalled();
  });

  it("opens edit details drawer from menu and saves", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ jobDescription: "Original" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /edit details/i }));
    expect(
      await screen.findByTestId("job-details-edit-drawer"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save details/i }));

    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
    expect(
      screen.queryByTestId("job-details-edit-drawer"),
    ).not.toBeInTheDocument();
  });

  it("marks a job as applied and follows it into Applied", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    const onNavigateToStatus = vi.fn();
    vi.mocked(api.markAsApplied).mockResolvedValue(
      createJob({ status: "applied" }),
    );

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onNavigateToStatus,
      onJobUpdated,
    });

    fireEvent.click(
      within(getApplyPanel()).getByRole("button", { name: /mark applied/i }),
    );

    await waitFor(() =>
      expect(api.markAsApplied).toHaveBeenCalledWith("job-1"),
    );
    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
    expect(onNavigateToStatus).toHaveBeenCalledWith("applied", "job-1");
  });

  it("navigates after marking applied even when the list refresh fails", async () => {
    const onNavigateToStatus = vi.fn();
    const onJobMutation = vi.fn();
    const appliedJob = createJob({ status: "applied" });
    vi.mocked(api.markAsApplied).mockResolvedValue(appliedJob);

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onNavigateToStatus,
      onJobMutation,
      onJobUpdated: vi.fn().mockRejectedValue(new Error("refresh failed")),
    });

    fireEvent.click(
      within(getApplyPanel()).getByRole("button", { name: /mark applied/i }),
    );

    await waitFor(() =>
      expect(onNavigateToStatus).toHaveBeenCalledWith("applied", "job-1"),
    );
    expect(onJobMutation).toHaveBeenCalledWith(appliedJob);
  });

  it("moves an applied job to in progress from the action button", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    const onJobMutation = vi.fn();
    const inProgressJob = createJob({ status: "in_progress" });
    vi.mocked(api.updateJob).mockResolvedValue(inProgressJob);

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
      onJobMutation,
    });

    expect(
      screen
        .getByRole("button", { name: /move to in progress/i })
        .querySelector("svg.lucide-circle-check"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /move to in progress/i }),
    );

    await waitFor(() =>
      expect(api.updateJob).toHaveBeenCalledWith("job-1", {
        status: "in_progress",
      }),
    );
    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
    expect(onJobMutation).toHaveBeenCalledWith(inProgressJob);
  });

  it("skips a job from the menu", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.skipJob).mockResolvedValue(createJob({ status: "skipped" }));

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /more actions/i }),
    );
    const skipItem = await screen.findByRole("menuitem", { name: /skip job/i });
    fireEvent.click(skipItem);

    await waitFor(() => expect(api.skipJob).toHaveBeenCalledWith("job-1"));
    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
  });

  it("only offers closing after application", async () => {
    const ready = await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /more actions/i }),
    );
    expect(
      screen.queryByRole("menuitem", { name: /close application/i }),
    ).not.toBeInTheDocument();
    ready.unmount();

    await renderJobDetailPanel({
      activeTab: "applied",
      activeJobs: [],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /more actions/i }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /close application/i }),
    ).toBeInTheDocument();
  });

  it("closes with a selected outcome and reopens through the outcome route", async () => {
    vi.mocked(api.updateJobOutcome).mockResolvedValue(
      createJob({ status: "applied", outcome: "withdrawn", closedAt: 1 }),
    );

    const open = await renderJobDetailPanel({
      activeTab: "applied",
      activeJobs: [],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /more actions/i }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /close application/i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Withdrawn" }));

    await waitFor(() =>
      expect(api.updateJobOutcome).toHaveBeenCalledWith("job-1", {
        outcome: "withdrawn",
      }),
    );
    open.unmount();

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        status: "applied",
        closedAt: 1,
        outcome: "withdrawn",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /more actions/i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reopen" }));

    await waitFor(() =>
      expect(api.updateJobOutcome).toHaveBeenCalledWith("job-1", {
        outcome: null,
      }),
    );
  });

  it("declines a job through the closed outcome path", async () => {
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.updateJobOutcome).mockResolvedValue(
      createJob({
        status: "applied",
        outcome: "rejected",
        closedAt: 1,
      }),
    );

    await renderJobDetailPanel({
      activeTab: "applied",
      activeJobs: [createJob({ status: "applied" })],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /decline job/i }));

    await waitFor(() =>
      expect(api.updateJobOutcome).toHaveBeenCalledWith("job-1", {
        outcome: "rejected",
      }),
    );
    await waitFor(() => expect(onJobUpdated).toHaveBeenCalled());
  });

  it("gates other status actions while declining", async () => {
    let resolveDecline: (value: Job) => void = () => {};
    const pendingDecline = new Promise<Job>((resolve) => {
      resolveDecline = resolve;
    });
    vi.mocked(api.updateJobOutcome).mockReturnValue(pendingDecline);

    await renderJobDetailPanel({
      activeTab: "applied",
      activeJobs: [createJob({ status: "applied" })],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /decline job/i }));

    expect(
      screen.getByRole("button", { name: /move to in progress/i }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /move to in progress/i }),
    );
    expect(api.updateJob).not.toHaveBeenCalled();

    await act(async () => {
      resolveDecline(createJob({ closedAt: 1, outcome: "rejected" }));
    });
  });

  it("hides mutating actions for closed jobs", async () => {
    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({
        closedAt: 1,
        source: "linkedin",
        status: "ready",
      }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(screen.getByRole("button", { name: /closed/i })).toBeDisabled();
    expect(
      screen.queryByRole("menuitem", {
        name: /refresh description & recalculate/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /recalculate match/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /upload pdf/i }),
    ).not.toBeInTheDocument();
  });

  it("blocks decline while a shared keyboard status action is in flight", async () => {
    await renderJobDetailPanel({
      activeTab: "applied",
      activeJobs: [createJob({ status: "applied" })],
      selectedJob: createJob({ status: "applied" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
      statusActionInFlightRef: { current: true },
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /decline job/i }));

    expect(api.updateJobOutcome).not.toHaveBeenCalled();
  });

  it("does not expose sponsor checks when sponsor information is disabled", async () => {
    mockSettings.showSponsorInfo = false;

    await renderJobDetailPanel({
      activeTab: "ready",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      screen.queryByRole("button", { name: /check sponsor/i }),
    ).not.toBeInTheDocument();
    expect(api.checkSponsor).not.toHaveBeenCalled();
  });

  it("forwards tailoring dirty state to refresh pause callback", async () => {
    const onPauseRefreshChange = vi.fn();

    await renderJobDetailPanel({
      activeTab: "all",
      activeJobs: [],
      selectedJob: createJob({ status: "ready" }),
      onSelectJobId: vi.fn(),
      onJobUpdated: vi.fn().mockResolvedValue(undefined),
      onPauseRefreshChange,
    });

    fireEvent.mouseDown(screen.getByRole("tab", { name: /tailoring/i }));
    fireEvent.click(await screen.findByText("Mark tailoring dirty"));
    fireEvent.click(screen.getByText("Mark tailoring clean"));

    expect(onPauseRefreshChange).toHaveBeenCalledWith(true);
    expect(onPauseRefreshChange).toHaveBeenCalledWith(false);
  });
});
