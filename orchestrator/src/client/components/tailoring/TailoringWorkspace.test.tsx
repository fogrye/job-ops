import * as api from "@client/api";
import { createJob } from "@shared/testing/factories.js";
import type { Job } from "@shared/types.js";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailoringWorkspace } from "./TailoringWorkspace";

vi.mock("@client/api", () => ({
  getJobTailoredExperienceView: vi.fn(),
  summarizeJob: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@client/hooks/useProfile", () => ({
  useProfile: () => ({ error: null, profile: null }),
}));

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: () => ({ isLoading: false, settings: null }),
}));

vi.mock("@client/hooks/useTracerReadiness", () => ({
  useTracerReadiness: () => ({ isChecking: false, readiness: null }),
}));

vi.mock("./TailoringSections", () => ({
  TailoringSections: () => <div />,
}));

vi.mock("./useTailoringDraft", () => ({
  getTailoringSavePayloadKey: (payload: unknown) => JSON.stringify(payload),
  useTailoringDraft: () => ({
    applyIncomingDraft: vi.fn(),
    catalog: [],
    handleAddSkillGroup: vi.fn(),
    handleRemoveSkillGroup: vi.fn(),
    handleToggleProject: vi.fn(),
    handleUpdateSkillGroup: vi.fn(),
    headline: "Headline",
    isCatalogLoading: false,
    isDirty: false,
    jobDescription: "Description",
    markSavedJob: vi.fn(),
    markSavedSnapshot: vi.fn(),
    savedPayloadKey:
      '{"tailoredSummary":"Summary","tailoredHeadline":"Headline","tailoredSkills":"[]","tailoredExperience":null,"jobDescription":"Description","selectedProjectIds":"","tracerLinksEnabled":false}',
    selectedIds: new Set<string>(),
    selectedIdsCsv: "",
    setHeadline: vi.fn(),
    setJobDescription: vi.fn(),
    setOpenSkillGroupId: vi.fn(),
    setSkillsDraft: vi.fn(),
    setSkillsMode: vi.fn(),
    setSummary: vi.fn(),
    setTailoredExperience: vi.fn(),
    setTracerLinksEnabled: vi.fn(),
    skillsDraft: [],
    skillsJson: "[]",
    summary: "Summary",
    tailoredExperience: null,
    tracerLinksEnabled: false,
  }),
}));

function WorkspaceHarness({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const [startToken, setStartToken] = useState(0);
  const [mounted, setMounted] = useState(true);
  const job = createJob({ id: "job-1", status: "discovered" });

  return (
    <>
      <button type="button" onClick={() => setStartToken((token) => token + 1)}>
        Start
      </button>
      <button type="button" onClick={() => setMounted(false)}>
        Unmount
      </button>
      <button type="button" onClick={() => setMounted(true)}>
        Remount
      </button>
      {mounted ? (
        <TailoringWorkspace
          mode="editor"
          job={job}
          onGenerationChange={onBusyChange}
          onStartGenerationConsumed={() => setStartToken(0)}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          startGenerationToken={startToken}
        />
      ) : null}
    </>
  );
}

describe("TailoringWorkspace start lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getJobTailoredExperienceView).mockResolvedValue({
      entries: [],
      status: "original",
    });
  });

  it("does not replay a consumed start request after remounting", async () => {
    vi.mocked(api.summarizeJob).mockResolvedValue(
      createJob({ id: "job-1", status: "discovered" }),
    );

    render(<WorkspaceHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(api.summarizeJob).toHaveBeenCalledWith("job-1", { force: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Unmount" }));
    fireEvent.click(screen.getByRole("button", { name: "Remount" }));

    expect(api.summarizeJob).toHaveBeenCalledTimes(1);
  });

  it("clears the parent busy state when unmounted mid-generation", async () => {
    let resolveSummary: (value: Job) => void = () => {};
    const pendingSummary = new Promise<Job>((resolve) => {
      resolveSummary = resolve;
    });
    vi.mocked(api.summarizeJob).mockReturnValue(pendingSummary);
    const onBusyChange = vi.fn();

    render(<WorkspaceHarness onBusyChange={onBusyChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Unmount" }));

    expect(onBusyChange).toHaveBeenLastCalledWith(false);

    await act(async () => {
      resolveSummary(createJob({ id: "job-1", status: "discovered" }));
    });
  });
});
