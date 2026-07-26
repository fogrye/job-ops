import * as api from "@client/api";
import { useProfile } from "@client/hooks/useProfile";
import { useSettings } from "@client/hooks/useSettings";
import { useTracerReadiness } from "@client/hooks/useTracerReadiness";
import type { Job, TailoredExperienceView } from "@shared/types.js";
import {
  Check,
  CircleAlert,
  FileText,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import type React from "react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Tip } from "@/client/components/Tip";
import { formatUserFacingError } from "@/client/lib/error-format";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import {
  fromEditableSkillGroups,
  getOriginalHeadline,
  getOriginalSkills,
  getOriginalSummary,
  parseTailoredSkills,
  serializeTailoredSkills,
  toEditableSkillGroups,
} from "../tailoring-utils";
import { TailoringSections } from "./TailoringSections";
import {
  getTailoringSavePayloadKey,
  type TailoringSavePayload,
  useTailoringDraft,
} from "./useTailoringDraft";

interface TailoringWorkspaceBaseProps {
  job: Job;
  onDirtyChange?: (isDirty: boolean) => void;
}

interface TailoringWorkspaceEditorProps extends TailoringWorkspaceBaseProps {
  mode: "editor";
  onUpdate: () => void | Promise<void>;
  onRegisterSave?: (save: () => Promise<void>) => void;
  onBeforeGenerate?: () => boolean | Promise<boolean>;
  startGenerationToken?: number;
  onGenerationChange?: (isGenerating: boolean) => void;
  onTailoringCompleted?: (job: Job) => void;
}

type TailoringWorkspaceProps = TailoringWorkspaceEditorProps;
type TailoringSectionsProps = ComponentProps<typeof TailoringSections>;

interface TailoringBaseline {
  summary: string;
  headline: string;
  skillsJson: string;
}

type AutosaveStatus = "saved" | "unsaved" | "saving" | "error";
type TailoringGenerateTarget =
  | "all"
  | "summary"
  | "headline"
  | "skills"
  | "experience";

const AutosaveStatusIcon: React.FC<{ status: AutosaveStatus }> = ({
  status,
}) => {
  const copy =
    status === "saving"
      ? "Saving..."
      : status === "unsaved"
        ? "Unsaved changes"
        : status === "error"
          ? "Save failed"
          : "Saved";
  const iconClassName =
    status === "error"
      ? "text-rose-300"
      : status === "unsaved"
        ? "text-amber-300"
        : status === "saving"
          ? "text-muted-foreground"
          : "text-emerald-400/80";

  return (
    <Tip content={<p>{copy}</p>}>
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground"
        role="img"
        aria-label={copy}
      >
        {status === "saving" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "error" || status === "unsaved" ? (
          <CircleAlert className={`h-3.5 w-3.5 ${iconClassName}`} />
        ) : (
          <Check className={`h-3.5 w-3.5 ${iconClassName}`} />
        )}
      </span>
    </Tip>
  );
};

const normalizeSkillsJson = (value: string | null | undefined) =>
  serializeTailoredSkills(parseTailoredSkills(value));
const textHasValue = (value: string) => value.trim().length > 0;

const toBaselineFromJob = (job: Job): TailoringBaseline => ({
  summary: job.tailoredSummary ?? "",
  headline: job.tailoredHeadline ?? "",
  skillsJson: normalizeSkillsJson(job.tailoredSkills),
});

const toSavePayloadFromJob = (job: Job): TailoringSavePayload => ({
  tailoredSummary: job.tailoredSummary ?? "",
  tailoredHeadline: job.tailoredHeadline ?? "",
  tailoredSkills: normalizeSkillsJson(job.tailoredSkills),
  tailoredExperience: job.tailoredExperience,
  jobDescription: job.jobDescription ?? "",
  selectedProjectIds: job.selectedProjectIds ?? "",
  tracerLinksEnabled: Boolean(job.tracerLinksEnabled),
});

export const TailoringWorkspace: React.FC<TailoringWorkspaceProps> = (
  props,
) => {
  const {
    catalog,
    isCatalogLoading,
    summary,
    setSummary,
    headline,
    setHeadline,
    jobDescription,
    setJobDescription,
    selectedIds,
    selectedIdsCsv,
    tracerLinksEnabled,
    setTracerLinksEnabled,
    setSkillsMode,
    skillsDraft,
    setSkillsDraft,
    openSkillGroupId,
    setOpenSkillGroupId,
    skillsJson,
    tailoredExperience,
    setTailoredExperience,
    isDirty,
    savedPayloadKey,
    applyIncomingDraft,
    markSavedSnapshot,
    markSavedJob,
    handleToggleProject,
    handleAddSkillGroup,
    handleUpdateSkillGroup,
    handleRemoveSkillGroup,
  } = useTailoringDraft({
    job: props.job,
    onDirtyChange: props.onDirtyChange,
  });

  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("saved");
  const [generateTarget, setGenerateTarget] =
    useState<TailoringGenerateTarget | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [experienceView, setExperienceView] =
    useState<TailoredExperienceView | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const latestPayloadRef = useRef<TailoringSavePayload | null>(null);
  const persistedPayloadKeyRef = useRef(savedPayloadKey);
  const startedGenerationTokenRef = useRef(0);
  const isMountedRef = useRef(true);
  const { profile, error: profileError } = useProfile();
  const { settings, isLoading: isSettingsLoading } = useSettings();
  const { readiness: tracerReadiness, isChecking: isTracerReadinessChecking } =
    useTracerReadiness();

  const originalValues = useMemo(() => {
    const skills = {
      mode: "grouped" as const,
      groups: getOriginalSkills(profile),
    };
    const skillsDraft = toEditableSkillGroups(skills);
    return {
      summary: getOriginalSummary(profile),
      headline: getOriginalHeadline(profile),
      skillsMode: skills.mode,
      skillsDraft,
      skillsJson: serializeTailoredSkills(
        fromEditableSkillGroups(skillsDraft, skills.mode),
      ),
    };
  }, [profile]);
  const canUseOriginalValues = Boolean(profile) && !profileError;
  useEffect(() => {
    let active = true;
    setExperienceView(null);
    void api
      .getJobTailoredExperienceView(props.job.id)
      .then((view) => {
        if (active) setExperienceView(view);
      })
      .catch(() => {
        if (active) setExperienceView(null);
      });
    return () => {
      active = false;
    };
  }, [props.job.id]);
  const [aiBaseline, setAiBaseline] = useState<TailoringBaseline>(() =>
    toBaselineFromJob(props.job),
  );

  useEffect(() => {
    setAiBaseline({
      summary: props.job.tailoredSummary ?? "",
      headline: props.job.tailoredHeadline ?? "",
      skillsJson: normalizeSkillsJson(props.job.tailoredSkills),
    });
  }, [
    props.job.tailoredSummary,
    props.job.tailoredHeadline,
    props.job.tailoredSkills,
  ]);

  const tracerEnableBlocked =
    !tracerLinksEnabled && !tracerReadiness?.canEnable;
  const tracerEnableBlockedReason =
    tracerReadiness?.canEnable === false
      ? (tracerReadiness.reason ??
        "Verify tracer links in Settings before enabling this job.")
      : null;

  const savePayload = useMemo<TailoringSavePayload>(
    () => ({
      tailoredSummary: summary,
      tailoredHeadline: headline,
      tailoredSkills: skillsJson,
      tailoredExperience,
      jobDescription,
      selectedProjectIds: selectedIdsCsv,
      tracerLinksEnabled,
    }),
    [
      summary,
      headline,
      skillsJson,
      tailoredExperience,
      jobDescription,
      selectedIdsCsv,
      tracerLinksEnabled,
    ],
  );
  const savePayloadKey = useMemo(
    () => getTailoringSavePayloadKey(savePayload),
    [savePayload],
  );

  useEffect(() => {
    latestPayloadRef.current = savePayload;
  }, [savePayload]);

  useEffect(() => {
    persistedPayloadKeyRef.current = savedPayloadKey;
  }, [savedPayloadKey]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const runAutosaveLoop = useCallback(async () => {
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current;
      return;
    }

    const savePromise = (async () => {
      try {
        do {
          saveAgainRef.current = false;
          const snapshot = latestPayloadRef.current;
          if (!snapshot) return;

          if (
            getTailoringSavePayloadKey(snapshot) ===
            persistedPayloadKeyRef.current
          ) {
            if (isMountedRef.current) setAutosaveStatus("saved");
            return;
          }

          if (isMountedRef.current) setAutosaveStatus("saving");
          const snapshotKey = getTailoringSavePayloadKey(snapshot);
          const updatedJob = await api.updateJob(props.job.id, snapshot);
          if (!isMountedRef.current) return;
          const updatedPayload = toSavePayloadFromJob(updatedJob);

          const latestStillMatchesSnapshot =
            latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) ===
              snapshotKey;
          if (latestStillMatchesSnapshot) {
            markSavedSnapshot(snapshot);
            latestPayloadRef.current = snapshot;
          } else {
            markSavedJob(updatedJob);
          }
          persistedPayloadKeyRef.current = latestStillMatchesSnapshot
            ? snapshotKey
            : getTailoringSavePayloadKey(updatedPayload);

          const latestKey = latestPayloadRef.current
            ? getTailoringSavePayloadKey(latestPayloadRef.current)
            : persistedPayloadKeyRef.current;
          if (isMountedRef.current) {
            setAutosaveStatus(
              latestKey === persistedPayloadKeyRef.current
                ? "saved"
                : "unsaved",
            );
          }
        } while (
          saveAgainRef.current ||
          (latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) !==
              persistedPayloadKeyRef.current)
        );
      } catch {
        if (isMountedRef.current) setAutosaveStatus("error");
        throw new Error("Autosave failed");
      } finally {
        saveInFlightRef.current = null;
      }
    })();

    saveInFlightRef.current = savePromise;
    await savePromise;
  }, [markSavedJob, markSavedSnapshot, props.job.id]);

  const flushAutosave = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current;
    }
    const latestPayload = latestPayloadRef.current;
    if (
      latestPayload &&
      getTailoringSavePayloadKey(latestPayload) !==
        persistedPayloadKeyRef.current
    ) {
      await runAutosaveLoop();
    }
  }, [runAutosaveLoop]);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!isDirty || savePayloadKey === persistedPayloadKeyRef.current) {
      if (!saveInFlightRef.current) setAutosaveStatus("saved");
      return;
    }

    setAutosaveStatus("unsaved");
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void runAutosaveLoop().catch(() => {
        // The status state already reflects the failure; keep the draft local.
      });
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [isDirty, runAutosaveLoop, savePayloadKey]);

  useEffect(() => {
    if (!props.onRegisterSave) return;
    props.onRegisterSave(flushAutosave);
  }, [props.onRegisterSave, flushAutosave]);

  const handleGenerateTailoring = useCallback(
    async (target: TailoringGenerateTarget) => {
      try {
        setGenerateTarget(target);
        await flushAutosave();

        const updatedJob = await api.summarizeJob(props.job.id, {
          force: true,
          fields: target === "all" ? undefined : [target],
        });
        applyIncomingDraft(updatedJob);
        setAiBaseline(toBaselineFromJob(updatedJob));
        if (target === "all" || target === "experience") {
          setExperienceView(
            await api.getJobTailoredExperienceView(props.job.id),
          );
        }
        toast.success(
          target === "all"
            ? "Draft content generated"
            : `${target[0].toUpperCase()}${target.slice(1)} generated`,
        );
        await props.onUpdate();
      } catch (error) {
        showErrorToast(error, "AI generation failed");
      } finally {
        setGenerateTarget(null);
      }
    },
    [props.onUpdate, flushAutosave, props.job.id, applyIncomingDraft],
  );

  const handleGenerateAll = useCallback(async () => {
    try {
      setGenerateTarget("all");
      await flushAutosave();
      let updatedJob: Job;
      if (props.job.status === "discovered") {
        updatedJob = await api.processJob(props.job.id, { force: true });
      } else {
        await api.summarizeJob(props.job.id, { force: true });
        updatedJob = await api.generateJobPdf(props.job.id);
      }
      applyIncomingDraft(updatedJob);
      setAiBaseline(toBaselineFromJob(updatedJob));
      setExperienceView(await api.getJobTailoredExperienceView(props.job.id));
      toast.success(
        props.job.status === "discovered"
          ? "Job moved to Ready"
          : "Resume regenerated",
        { description: "Your tailored PDF has been generated." },
      );
      await props.onUpdate();
      props.onTailoringCompleted?.(updatedJob);
    } catch (error) {
      showErrorToast(error, "AI generation failed");
    } finally {
      setGenerateTarget(null);
    }
  }, [
    applyIncomingDraft,
    flushAutosave,
    props.job.id,
    props.job.status,
    props.onTailoringCompleted,
    props.onUpdate,
  ]);

  useEffect(() => {
    if (
      !props.startGenerationToken ||
      props.startGenerationToken === startedGenerationTokenRef.current
    ) {
      return;
    }
    startedGenerationTokenRef.current = props.startGenerationToken;
    void handleGenerateAll();
  }, [handleGenerateAll, props.startGenerationToken]);

  const handleGenerateSummary = useCallback(async () => {
    await handleGenerateTailoring("summary");
  }, [handleGenerateTailoring]);

  const handleGenerateHeadline = useCallback(async () => {
    await handleGenerateTailoring("headline");
  }, [handleGenerateTailoring]);

  const handleGenerateSkills = useCallback(async () => {
    await handleGenerateTailoring("skills");
  }, [handleGenerateTailoring]);
  const workHistoryTailoringEnabled =
    settings?.tailorWorkHistory?.value ?? false;
  const experienceDisabled =
    isSettingsLoading || !workHistoryTailoringEnabled || !canUseOriginalValues;
  const handleGenerateExperience = useCallback(async () => {
    await handleGenerateTailoring("experience");
  }, [handleGenerateTailoring]);
  const handleExperienceChange = useCallback(
    (value: string) => setTailoredExperience(value),
    [setTailoredExperience],
  );
  const handleResetExperience = useCallback(() => {
    setTailoredExperience(null);
    setExperienceView((current) =>
      current
        ? {
            ...current,
            status: "original",
            entries: current.entries.map((entry) => ({
              ...entry,
              groups: entry.groups.map((group) => ({
                ...group,
                selectedUnitIds: group.units.map((unit) => unit.id),
              })),
              roles: entry.roles.map((role) => ({
                ...role,
                groups: role.groups.map((group) => ({
                  ...group,
                  selectedUnitIds: group.units.map((unit) => unit.id),
                })),
              })),
            })),
          }
        : current,
    );
  }, [setTailoredExperience]);

  const handleGeneratePdf = useCallback(async () => {
    try {
      const shouldProceed = props.onBeforeGenerate
        ? await props.onBeforeGenerate()
        : true;
      if (shouldProceed === false) return;

      setIsGeneratingPdf(true);
      await flushAutosave();
      await api.generateJobPdf(props.job.id);
      toast.success("Resume PDF generated");
      await props.onUpdate();
    } catch (error) {
      const message = formatUserFacingError(error, "PDF generation failed");
      if (/tracer/i.test(message)) {
        toast.error("Tracer links are unavailable right now", {
          description: message,
        });
      } else {
        showErrorToast(error, "PDF generation failed");
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [props.onBeforeGenerate, props.onUpdate, flushAutosave, props.job.id]);

  const handleUndoSummary = useCallback(() => {
    setSummary(originalValues.summary);
  }, [originalValues.summary, setSummary]);

  const handleUndoHeadline = useCallback(() => {
    setHeadline(originalValues.headline);
  }, [originalValues.headline, setHeadline]);

  const handleUndoSkills = useCallback(() => {
    setSkillsMode(originalValues.skillsMode);
    setSkillsDraft(originalValues.skillsDraft);
  }, [originalValues, setSkillsMode, setSkillsDraft]);

  const handleRedoSummary = useCallback(() => {
    setSummary(aiBaseline.summary);
  }, [aiBaseline.summary, setSummary]);

  const handleRedoHeadline = useCallback(() => {
    setHeadline(aiBaseline.headline);
  }, [aiBaseline.headline, setHeadline]);

  const handleRedoSkills = useCallback(() => {
    const skills = parseTailoredSkills(aiBaseline.skillsJson);
    setSkillsMode(skills.mode);
    setSkillsDraft(toEditableSkillGroups(skills));
  }, [aiBaseline.skillsJson, setSkillsMode, setSkillsDraft]);

  const isGenerating = Boolean(generateTarget) || isGeneratingPdf;
  useEffect(() => {
    props.onGenerationChange?.(isGenerating);
  }, [isGenerating, props.onGenerationChange]);
  const disableInputs = isGenerating;
  const isDraftReady = textHasValue(summary) && textHasValue(headline);

  const tailoringSectionsProps = useMemo<TailoringSectionsProps>(
    () => ({
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      resumeProjectsSettings: settings?.resumeProjects.value ?? null,
      isResumeProjectsSettingsLoading: isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      tracerReadinessChecking: isTracerReadinessChecking,
      generatingSection:
        generateTarget === "summary" ||
        generateTarget === "headline" ||
        generateTarget === "skills"
          ? generateTarget
          : null,
      isGeneratingAll: generateTarget === "all",
      experienceView,
      experienceDisabled,
      experienceGenerating:
        generateTarget === "experience" || generateTarget === "all",
      onGenerateExperience: handleGenerateExperience,
      onResetExperience: handleResetExperience,
      onExperienceChange: handleExperienceChange,
      openSkillGroupId,
      disableInputs,
      onGenerateSummary: handleGenerateSummary,
      onGenerateHeadline: handleGenerateHeadline,
      onGenerateSkills: handleGenerateSkills,
      onSummaryChange: setSummary,
      onHeadlineChange: setHeadline,
      onUndoSummary: handleUndoSummary,
      onUndoHeadline: handleUndoHeadline,
      onUndoSkills: handleUndoSkills,
      onRedoSummary: handleRedoSummary,
      onRedoHeadline: handleRedoHeadline,
      onRedoSkills: handleRedoSkills,
      canUndoSummary:
        canUseOriginalValues && summary !== originalValues.summary,
      canUndoHeadline:
        canUseOriginalValues && headline !== originalValues.headline,
      canUndoSkills:
        canUseOriginalValues && skillsJson !== originalValues.skillsJson,
      canRedoSummary: summary !== aiBaseline.summary,
      canRedoHeadline: headline !== aiBaseline.headline,
      canRedoSkills: skillsJson !== aiBaseline.skillsJson,
      undoDisabledReason: canUseOriginalValues
        ? null
        : "Original base CV unavailable.",
      onDescriptionChange: setJobDescription,
      onSkillGroupOpenChange: setOpenSkillGroupId,
      onAddSkillGroup: handleAddSkillGroup,
      onUpdateSkillGroup: handleUpdateSkillGroup,
      onRemoveSkillGroup: handleRemoveSkillGroup,
      onToggleProject: handleToggleProject,
      onTracerLinksEnabledChange: setTracerLinksEnabled,
    }),
    [
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      settings?.resumeProjects.value,
      isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      isTracerReadinessChecking,
      generateTarget,
      openSkillGroupId,
      disableInputs,
      handleGenerateSummary,
      handleGenerateHeadline,
      handleGenerateSkills,
      setSummary,
      setHeadline,
      handleUndoSummary,
      handleUndoHeadline,
      handleUndoSkills,
      handleRedoSummary,
      handleRedoHeadline,
      handleRedoSkills,
      canUseOriginalValues,
      originalValues,
      skillsJson,
      aiBaseline,
      setJobDescription,
      experienceView,
      experienceDisabled,
      handleGenerateExperience,
      handleResetExperience,
      handleExperienceChange,
      setOpenSkillGroupId,
      handleAddSkillGroup,
      handleUpdateSkillGroup,
      handleRemoveSkillGroup,
      handleToggleProject,
      setTracerLinksEnabled,
    ],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div
          className={`flex min-h-16 items-center justify-between gap-3 rounded-md border px-3 py-3 ${
            isDraftReady
              ? "border-emerald-500/20 bg-emerald-500/[0.04]"
              : "border-amber-500/20 bg-amber-500/[0.04]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                isDraftReady
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/45 bg-amber-500/10 text-amber-300"
              }`}
            >
              {isDraftReady ? (
                <Check className="h-4 w-4" />
              ) : (
                <CircleAlert className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground/90">
                {isDraftReady ? "Draft ready" : "Draft incomplete"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                {isDraftReady
                  ? "Review optional sections before generating the PDF."
                  : "Add a summary and headline to generate the PDF."}
              </p>
            </div>
          </div>
          <AutosaveStatusIcon status={autosaveStatus} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <Button
            onClick={handleGenerateAll}
            disabled={Boolean(generateTarget) || isGeneratingPdf}
            variant="outline"
            size="sm"
          >
            {generateTarget === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Generate all
          </Button>
          <Button
            onClick={handleGeneratePdf}
            disabled={
              Boolean(generateTarget) || isGeneratingPdf || !isDraftReady
            }
            size="sm"
          >
            {isGeneratingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Generate PDF
          </Button>
        </div>
      </div>

      <TailoringSections {...tailoringSectionsProps} />
    </div>
  );
};
