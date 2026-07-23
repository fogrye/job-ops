import * as api from "@client/api";
import type { Job, ResumeProjectCatalogItem } from "@shared/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTailoredSkillDraftId,
  type EditableSkillGroup,
  fromEditableSkillGroups,
  parseTailoredSkills,
  serializeTailoredSkills,
  type TailoredSkillsDraft,
  toEditableSkillGroups,
} from "../tailoring-utils";

const parseSelectedIds = (value: string | null | undefined) =>
  new Set(value?.split(",").filter(Boolean) ?? []);

const toSelectedIdsCsv = (ids: Set<string>) => Array.from(ids).sort().join(",");

const hasSelectionDiff = (current: Set<string>, saved: Set<string>) => {
  if (current.size !== saved.size) return true;
  for (const id of current) {
    if (!saved.has(id)) return true;
  }
  return false;
};

export interface TailoringSavePayload {
  tailoredSummary: string;
  tailoredHeadline: string;
  tailoredSkills: string;
  tailoredExperience: string | null;
  jobDescription: string;
  selectedProjectIds: string;
  tracerLinksEnabled: boolean;
}

export const getTailoringSavePayloadKey = (
  payload: TailoringSavePayload,
): string =>
  JSON.stringify({
    tailoredSummary: payload.tailoredSummary,
    tailoredHeadline: payload.tailoredHeadline,
    tailoredSkills: payload.tailoredSkills,
    tailoredExperience: payload.tailoredExperience,
    jobDescription: payload.jobDescription,
    selectedProjectIds: toSelectedIdsCsv(
      parseSelectedIds(payload.selectedProjectIds),
    ),
    tracerLinksEnabled: payload.tracerLinksEnabled,
  });

const parseIncomingDraft = (incomingJob: Job) => {
  const summary = incomingJob.tailoredSummary || "";
  const headline = incomingJob.tailoredHeadline || "";
  const description = incomingJob.jobDescription || "";
  const selectedIds = parseSelectedIds(incomingJob.selectedProjectIds);
  const tailoredSkills = parseTailoredSkills(incomingJob.tailoredSkills);
  const skillsDraft = toEditableSkillGroups(tailoredSkills);
  const skillsJson = serializeTailoredSkills(
    fromEditableSkillGroups(skillsDraft, tailoredSkills.mode),
  );
  const tracerLinksEnabled = Boolean(incomingJob.tracerLinksEnabled);

  return {
    summary,
    headline,
    description,
    selectedIds,
    tailoredSkills,
    skillsDraft,
    skillsJson,
    tailoredExperience: incomingJob.tailoredExperience,
    tracerLinksEnabled,
  };
};

interface UseTailoringDraftParams {
  job: Job;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function useTailoringDraft({
  job,
  onDirtyChange,
}: UseTailoringDraftParams) {
  const [catalog, setCatalog] = useState<ResumeProjectCatalogItem[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [summary, setSummary] = useState(job.tailoredSummary || "");
  const [headline, setHeadline] = useState(job.tailoredHeadline || "");
  const [jobDescription, setJobDescription] = useState(
    job.jobDescription || "",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    parseSelectedIds(job.selectedProjectIds),
  );
  const [skillsMode, setSkillsMode] = useState<TailoredSkillsDraft["mode"]>(
    () => parseTailoredSkills(job.tailoredSkills).mode,
  );
  const [skillsDraft, setSkillsDraft] = useState<EditableSkillGroup[]>(() =>
    toEditableSkillGroups(parseTailoredSkills(job.tailoredSkills)),
  );
  const [openSkillGroupId, setOpenSkillGroupId] = useState<string>("");
  const [tailoredExperience, setTailoredExperience] = useState<string | null>(
    job.tailoredExperience,
  );
  const [tracerLinksEnabled, setTracerLinksEnabled] = useState(
    Boolean(job.tracerLinksEnabled),
  );

  const [savedSummary, setSavedSummary] = useState(job.tailoredSummary || "");
  const [savedHeadline, setSavedHeadline] = useState(
    job.tailoredHeadline || "",
  );
  const [savedDescription, setSavedDescription] = useState(
    job.jobDescription || "",
  );
  const [savedSelectedIds, setSavedSelectedIds] = useState<Set<string>>(() =>
    parseSelectedIds(job.selectedProjectIds),
  );
  const [savedSkillsJson, setSavedSkillsJson] = useState(() =>
    serializeTailoredSkills(parseTailoredSkills(job.tailoredSkills)),
  );
  const [savedTailoredExperience, setSavedTailoredExperience] = useState<
    string | null
  >(job.tailoredExperience);
  const [savedTracerLinksEnabled, setSavedTracerLinksEnabled] = useState(
    Boolean(job.tracerLinksEnabled),
  );

  const lastJobIdRef = useRef(job.id);
  const jobRef = useRef(job);

  const skillsJson = useMemo(
    () =>
      serializeTailoredSkills(fromEditableSkillGroups(skillsDraft, skillsMode)),
    [skillsDraft, skillsMode],
  );

  const selectedIdsCsv = useMemo(
    () => toSelectedIdsCsv(selectedIds),
    [selectedIds],
  );

  const isDirty = useMemo(() => {
    if (summary !== savedSummary) return true;
    if (headline !== savedHeadline) return true;
    if (jobDescription !== savedDescription) return true;
    if (skillsJson !== savedSkillsJson) return true;
    if (tailoredExperience !== savedTailoredExperience) return true;
    if (tracerLinksEnabled !== savedTracerLinksEnabled) return true;
    return hasSelectionDiff(selectedIds, savedSelectedIds);
  }, [
    summary,
    savedSummary,
    headline,
    savedHeadline,
    jobDescription,
    savedDescription,
    skillsJson,
    savedSkillsJson,
    tailoredExperience,
    savedTailoredExperience,
    tracerLinksEnabled,
    savedTracerLinksEnabled,
    selectedIds,
    savedSelectedIds,
  ]);

  const savedPayloadKey = useMemo(
    () =>
      getTailoringSavePayloadKey({
        tailoredSummary: savedSummary,
        tailoredHeadline: savedHeadline,
        tailoredSkills: savedSkillsJson,
        jobDescription: savedDescription,
        selectedProjectIds: toSelectedIdsCsv(savedSelectedIds),
        tracerLinksEnabled: savedTracerLinksEnabled,
        tailoredExperience: savedTailoredExperience,
      }),
    [
      savedSummary,
      savedHeadline,
      savedSkillsJson,
      savedDescription,
      savedSelectedIds,
      savedTailoredExperience,
      savedTracerLinksEnabled,
    ],
  );

  const applyIncomingDraft = useCallback((incomingJob: Job) => {
    const next = parseIncomingDraft(incomingJob);
    setSummary(next.summary);
    setHeadline(next.headline);
    setJobDescription(next.description);
    setSelectedIds(next.selectedIds);
    setSkillsMode(next.tailoredSkills.mode);
    setSkillsDraft(next.skillsDraft);
    setSavedSummary(next.summary);
    setSavedHeadline(next.headline);
    setSavedDescription(next.description);
    setSavedSelectedIds(next.selectedIds);
    setSavedSkillsJson(next.skillsJson);
    setTracerLinksEnabled(next.tracerLinksEnabled);
    setTailoredExperience(next.tailoredExperience);
    setSavedTracerLinksEnabled(next.tracerLinksEnabled);
  }, []);

  const markSavedSnapshot = useCallback((snapshot: TailoringSavePayload) => {
    setSavedSummary(snapshot.tailoredSummary);
    setSavedHeadline(snapshot.tailoredHeadline);
    setSavedDescription(snapshot.jobDescription);
    setSavedSelectedIds(parseSelectedIds(snapshot.selectedProjectIds));
    setSavedSkillsJson(snapshot.tailoredSkills);
    setSavedTailoredExperience(snapshot.tailoredExperience);
    setSavedTracerLinksEnabled(snapshot.tracerLinksEnabled);
  }, []);

  const markSavedJob = useCallback((incomingJob: Job) => {
    const next = parseIncomingDraft(incomingJob);
    setSavedSummary(next.summary);
    setSavedHeadline(next.headline);
    setSavedDescription(next.description);
    setSavedSelectedIds(next.selectedIds);
    setSavedSkillsJson(next.skillsJson);
    setSavedTailoredExperience(next.tailoredExperience);
    setSavedTracerLinksEnabled(next.tracerLinksEnabled);
  }, []);

  const loadCatalog = useCallback(async (silently = false) => {
    if (!silently) setIsCatalogLoading(true);
    try {
      const nextCatalog = await api.getResumeProjectsCatalog();
      setCatalog(nextCatalog);
    } catch {
      if (!silently) setCatalog([]);
    } finally {
      if (!silently) setIsCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    void loadCatalog(false);

    const refreshCatalog = () => {
      void loadCatalog(true);
    };

    window.addEventListener("focus", refreshCatalog);
    document.addEventListener("visibilitychange", refreshCatalog);
    return () => {
      window.removeEventListener("focus", refreshCatalog);
      document.removeEventListener("visibilitychange", refreshCatalog);
    };
  }, [loadCatalog]);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  // Only sync when job ID changes (user switched to a different job)
  // User edits persist until explicitly saved - no auto-sync from server
  useEffect(() => {
    if (job.id !== lastJobIdRef.current) {
      lastJobIdRef.current = job.id;
      applyIncomingDraft(jobRef.current);
    }
  }, [job.id, applyIncomingDraft]);

  useEffect(() => {
    if (
      openSkillGroupId.length > 0 &&
      !skillsDraft.some((group) => group.id === openSkillGroupId)
    ) {
      setOpenSkillGroupId("");
    }
  }, [skillsDraft, openSkillGroupId]);

  const handleToggleProject = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddSkillGroup = useCallback(() => {
    const nextId = createTailoredSkillDraftId();
    setSkillsDraft((prev) => [
      ...prev,
      { id: nextId, name: "", keywordsText: "" },
    ]);
    setOpenSkillGroupId(nextId);
  }, []);

  const handleUpdateSkillGroup = useCallback(
    (id: string, key: "name" | "keywordsText", value: string) => {
      setSkillsDraft((prev) =>
        prev.map((group) =>
          group.id === id ? { ...group, [key]: value } : group,
        ),
      );
    },
    [],
  );

  const handleRemoveSkillGroup = useCallback((id: string) => {
    setSkillsDraft((prev) => prev.filter((group) => group.id !== id));
  }, []);

  return {
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
    skillsMode,
    setSkillsMode,
    skillsDraft,
    setSkillsDraft,
    openSkillGroupId,
    setOpenSkillGroupId,
    skillsJson,
    tracerLinksEnabled,
    setTracerLinksEnabled,
    isDirty,
    savedPayloadKey,
    applyIncomingDraft,
    markSavedSnapshot,
    markSavedJob,
    handleToggleProject,
    handleAddSkillGroup,
    handleUpdateSkillGroup,
    handleRemoveSkillGroup,
    tailoredExperience,
    setTailoredExperience,
  };
}
