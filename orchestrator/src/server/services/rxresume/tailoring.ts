import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type {
  ResumeProjectCatalogItem,
  TailoredExperienceView,
  TailoredExperienceViewEntry,
  TailoredExperienceViewGroup,
  TailoredExperienceViewRole,
} from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import { JSDOM } from "jsdom";

type RecordLike = Record<string, unknown>;

export type TailoredSkillsInput =
  | Array<{ name: string; keywords: string[] }>
  | string[]
  | string
  | null
  | undefined;

export type TailoredExperienceGroup = {
  id: string;
  unitIds: string[];
};

export type TailoredExperienceRole = {
  id: string;
  groups: TailoredExperienceGroup[];
};

export type TailoredExperienceEntry = {
  id: string;
  groups: TailoredExperienceGroup[];
  roles?: TailoredExperienceRole[];
};

export type TailoredExperienceInput = {
  entries: TailoredExperienceEntry[];
};

export type TailoredExperienceSourceGroup = {
  id: string;
  units: Array<{ id: string; content: string }>;
};

export type TailoredExperienceSourceRole = {
  id: string;
  groups: TailoredExperienceSourceGroup[];
};

export type TailoredExperienceSourceEntry = {
  id: string;
  groups: TailoredExperienceSourceGroup[];
  roles: TailoredExperienceSourceRole[];
};

export type TailoredExperienceSource = {
  entries: TailoredExperienceSourceEntry[];
};

const textValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((id, index) => id === right[index]);

type StaleState = { value: boolean };

function buildExperienceViewGroups(
  sourceGroups: TailoredExperienceSourceGroup[],
  selectedGroups: TailoredExperienceGroup[] | undefined,
  stale: StaleState,
): TailoredExperienceViewGroup[] {
  const selectedById = new Map<string, TailoredExperienceGroup>();
  if (selectedGroups) {
    for (const group of selectedGroups) {
      if (selectedById.has(group.id)) stale.value = true;
      selectedById.set(group.id, group);
    }
    if (selectedById.size !== selectedGroups.length) stale.value = true;
  }

  return sourceGroups.map((sourceGroup) => {
    const originalIds = sourceGroup.units.map((unit) => unit.id);
    const selected = selectedById.get(sourceGroup.id);
    if (!selected) {
      if (selectedGroups) stale.value = true;
      return {
        id: sourceGroup.id,
        units: sourceGroup.units.map((unit) => ({
          id: unit.id,
          text: stripHtmlTags(unit.content).trim(),
        })),
        selectedUnitIds: originalIds,
      };
    }

    const sourceIds = new Set(originalIds);
    const selectedIds = selected.unitIds;
    if (
      selectedIds.length === 0 ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !sourceIds.has(id))
    ) {
      stale.value = true;
      return {
        id: sourceGroup.id,
        units: sourceGroup.units.map((unit) => ({
          id: unit.id,
          text: stripHtmlTags(unit.content).trim(),
        })),
        selectedUnitIds: originalIds,
      };
    }

    return {
      id: sourceGroup.id,
      units: sourceGroup.units.map((unit) => ({
        id: unit.id,
        text: stripHtmlTags(unit.content).trim(),
      })),
      selectedUnitIds: selectedIds,
    };
  });
}

function hasTailoredExperience(groups: TailoredExperienceViewGroup[]): boolean {
  return groups.some((group) => {
    const originalIds = group.units.map((unit) => unit.id);
    return !sameIds(originalIds, group.selectedUnitIds);
  });
}

export function buildTailoredExperienceView(
  resumeData: RecordLike,
  tailoredExperience?: unknown,
): TailoredExperienceView {
  const source = extractTailoredExperienceSource(resumeData);
  const sections = asRecord(resumeData.sections);
  const experience = asRecord(sections?.experience);
  const items = asArray(experience?.items) ?? [];
  const itemById = new Map(
    items
      .map((rawItem) => {
        const item = asRecord(rawItem);
        const id = textValue(item?.id);
        return id ? ([id, item] as const) : null;
      })
      .filter((item): item is readonly [string, RecordLike] => item !== null),
  );
  const parsed =
    tailoredExperience == null
      ? null
      : parseTailoredExperienceInput(tailoredExperience);
  const stale: StaleState = { value: tailoredExperience != null && !parsed };
  const selectedEntries = new Map<string, TailoredExperienceEntry>();
  for (const entry of parsed?.entries ?? []) {
    if (selectedEntries.has(entry.id)) stale.value = true;
    selectedEntries.set(entry.id, entry);
  }
  if (parsed && selectedEntries.size !== parsed.entries.length) {
    stale.value = true;
  }

  const entries: TailoredExperienceViewEntry[] = source.entries.map(
    (sourceEntry) => {
      const item = itemById.get(sourceEntry.id);
      const selection = selectedEntries.get(sourceEntry.id);
      const groups = buildExperienceViewGroups(
        sourceEntry.groups,
        selection?.groups,
        stale,
      );
      const roles: TailoredExperienceViewRole[] = sourceEntry.roles.map(
        (sourceRole) => {
          const roleItem = asArray(item?.roles)?.find(
            (rawRole) => textValue(asRecord(rawRole)?.id) === sourceRole.id,
          );
          const roleSelection = selection?.roles?.find(
            (role) => role.id === sourceRole.id,
          );
          const roleGroups = buildExperienceViewGroups(
            sourceRole.groups,
            roleSelection?.groups,
            stale,
          );
          return {
            id: sourceRole.id,
            position: textValue(asRecord(roleItem)?.position),
            date: textValue(asRecord(roleItem)?.period),
            location: "",
            groups: roleGroups,
          };
        },
      );
      return {
        id: sourceEntry.id,
        company: textValue(item?.company),
        position: textValue(item?.position),
        date: textValue(item?.period),
        location: textValue(item?.location),
        groups,
        roles,
      };
    },
  );
  const sourceIds = new Set(source.entries.map((entry) => entry.id));
  if ([...selectedEntries.keys()].some((id) => !sourceIds.has(id))) {
    stale.value = true;
  }
  const hasTailored = entries.some(
    (entry) =>
      hasTailoredExperience(entry.groups) ||
      entry.roles.some((role) => hasTailoredExperience(role.groups)),
  );
  return {
    status: stale.value ? "stale" : hasTailored ? "tailored" : "original",
    entries,
  };
}

function parseTailoredExperienceGroups(
  value: unknown,
): TailoredExperienceGroup[] | null {
  if (!Array.isArray(value)) return null;
  const groups: TailoredExperienceGroup[] = [];
  for (const rawGroup of value) {
    const group = asRecord(rawGroup);
    const groupId = typeof group?.id === "string" ? group.id.trim() : "";
    if (!group || !groupId || !Array.isArray(group.unitIds)) return null;
    const unitIds = group.unitIds.filter(
      (unitId): unitId is string =>
        typeof unitId === "string" && unitId.trim().length > 0,
    );
    if (unitIds.length !== group.unitIds.length) return null;
    groups.push({ id: groupId, unitIds });
  }
  return groups;
}
export function parseTailoredExperienceInput(
  value: unknown,
): TailoredExperienceInput | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const root = parsed && typeof parsed === "object" ? parsed : null;
  const rawEntries = Array.isArray((root as RecordLike | null)?.entries)
    ? ((root as RecordLike).entries as unknown[])
    : null;
  if (!rawEntries) return null;

  const entries: TailoredExperienceEntry[] = [];
  for (const rawEntry of rawEntries) {
    const entry = asRecord(rawEntry);
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!entry || !id) return null;
    const groups = parseTailoredExperienceGroups(entry.groups);
    if (!groups) return null;

    const roles =
      entry.roles === undefined
        ? undefined
        : Array.isArray(entry.roles)
          ? entry.roles.map((rawRole) => {
              const role = asRecord(rawRole);
              const roleId = typeof role?.id === "string" ? role.id.trim() : "";
              const groups = parseTailoredExperienceGroups(role?.groups);
              return role && roleId && groups ? { id: roleId, groups } : null;
            })
          : null;
    if (roles === null || roles?.some((role): role is null => role === null)) {
      return null;
    }
    entries.push({
      id,
      groups,
      roles: roles as TailoredExperienceRole[] | undefined,
    });
  }

  return { entries };
}

export function normalizeTailoredExperienceJson(value: unknown): string | null {
  const parsed = parseTailoredExperienceInput(value);
  return parsed ? JSON.stringify(parsed) : null;
}

export type TailorChunkInput = {
  headline?: string | null;
  summary?: string | null;
  skills?: TailoredSkillsInput;
  experience?: TailoredExperienceInput | null;
};

export type ResumeProjectSelectionItem = ResumeProjectCatalogItem & {
  summaryText: string;
};

export function cloneResumeData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
type ExperienceUnitGroup = {
  id: string;
  units: Array<{ id: string; content: string }>;
  render: (unitIds: readonly string[]) => string | null;
};

type ExperienceDescriptionModel = {
  groups: ExperienceUnitGroup[];
  render: (
    selections: ReadonlyMap<string, TailoredExperienceGroup>,
  ) => string | null;
};

function contentId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("base64url");
}

function createExperienceGroup(args: {
  ownerId: string;
  groupIndex: number;
  source: Element;
  unitNodes: Element[];
  list: boolean;
}): ExperienceUnitGroup {
  const groupId = contentId(
    args.ownerId,
    "group",
    String(args.groupIndex),
    args.source.outerHTML,
  );
  const units = args.unitNodes.map((node) => ({
    id: contentId(groupId, "unit", node.outerHTML),
    content: node.outerHTML,
  }));
  const unitById = new Map(units.map((unit) => [unit.id, unit.content]));

  return {
    id: groupId,
    units,
    render(selectedIds) {
      if (
        selectedIds.length === 0 ||
        new Set(selectedIds).size !== selectedIds.length ||
        selectedIds.some((unitId) => !unitById.has(unitId))
      ) {
        return null;
      }

      const selected = selectedIds.map((unitId) => unitById.get(unitId));
      if (selected.some((unit) => unit === undefined)) return null;
      if (!args.list) return selected.join("");

      const clone = args.source.cloneNode(false) as Element;
      clone.innerHTML = selected.join("");
      return clone.outerHTML;
    },
  };
}

function serializeNode(node: ChildNode): string {
  return node.nodeType === node.ELEMENT_NODE
    ? (node as Element).outerHTML
    : (node.textContent ?? "");
}

function extractExperienceDescription(
  ownerId: string,
  description: string,
): ExperienceDescriptionModel | null {
  const document = new JSDOM(`<body>${description}</body>`).window.document;
  const nodes = [...document.body.childNodes];
  if (nodes.length === 0) return null;

  const groups: ExperienceUnitGroup[] = [];
  const segments: Array<{ source: string; group?: ExperienceUnitGroup }> = [];
  for (let index = 0; index < nodes.length; ) {
    const node = nodes[index];
    if (node.nodeType !== node.ELEMENT_NODE) {
      segments.push({ source: serializeNode(node) });
      index += 1;
      continue;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    if (tagName === "ul" || tagName === "ol") {
      const unitNodes = [...element.children].filter(
        (child) => child.tagName.toLowerCase() === "li",
      );
      const hasUnsupportedDirectChild = [...element.children].some(
        (child) => child.tagName.toLowerCase() !== "li",
      );
      const hasUnsupportedDirectText = [...element.childNodes].some(
        (child) =>
          child.nodeType === child.TEXT_NODE && child.textContent?.trim(),
      );
      if (
        unitNodes.length === 0 ||
        hasUnsupportedDirectChild ||
        hasUnsupportedDirectText
      ) {
        segments.push({ source: element.outerHTML });
        index += 1;
        continue;
      }

      const group = createExperienceGroup({
        ownerId,
        groupIndex: groups.length,
        source: element,
        unitNodes,
        list: true,
      });
      groups.push(group);
      segments.push({ source: element.outerHTML, group });
      index += 1;
      continue;
    }

    if (tagName === "p") {
      const paragraphNodes = [element];
      let nextIndex = index + 1;
      while (nextIndex < nodes.length) {
        while (
          nextIndex < nodes.length &&
          nodes[nextIndex].nodeType === nodes[nextIndex].TEXT_NODE &&
          !nodes[nextIndex].textContent?.trim()
        ) {
          nextIndex += 1;
        }
        const next = nodes[nextIndex];
        if (
          !next ||
          next.nodeType !== next.ELEMENT_NODE ||
          (next as Element).tagName.toLowerCase() !== "p"
        ) {
          break;
        }
        paragraphNodes.push(next as Element);
        nextIndex += 1;
      }
      const source = document.createElement("div");
      source.innerHTML = paragraphNodes
        .map((paragraph) => paragraph.outerHTML)
        .join("");
      const group = createExperienceGroup({
        ownerId,
        groupIndex: groups.length,
        source,
        unitNodes: paragraphNodes,
        list: false,
      });
      groups.push(group);
      segments.push({
        source: nodes.slice(index, nextIndex).map(serializeNode).join(""),
        group,
      });
      index = nextIndex;
      continue;
    }

    segments.push({ source: element.outerHTML });
    index += 1;
  }

  if (groups.length === 0) return null;
  return {
    groups,
    render(selections) {
      const expectedIds = new Set(groups.map((group) => group.id));
      if (selections.size !== expectedIds.size) return null;
      for (const id of expectedIds) {
        if (!selections.has(id)) return null;
      }

      return segments
        .map((segment) => {
          if (!segment.group) return segment.source;
          const selection = selections.get(segment.group.id);
          const rendered = selection
            ? segment.group.render(selection.unitIds)
            : null;
          return rendered ?? segment.source;
        })
        .join("");
    },
  };
}

export function extractTailoredExperienceSource(
  resumeData: RecordLike,
): TailoredExperienceSource {
  const sections = asRecord(resumeData.sections);
  const experience = asRecord(sections?.experience);
  const items = asArray(experience?.items);
  if (!items) return { entries: [] };

  const entries: TailoredExperienceSourceEntry[] = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const id = typeof item?.id === "string" ? item.id : "";
    if (!item || !id) continue;

    const descriptionModel =
      typeof item.description === "string"
        ? extractExperienceDescription(id, item.description)
        : null;
    const groups =
      descriptionModel?.groups.map(({ id: groupId, units }) => ({
        id: groupId,
        units,
      })) ?? [];
    const roles =
      asArray(item.roles)?.flatMap((rawRole) => {
        const role = asRecord(rawRole);
        const roleId = typeof role?.id === "string" ? role.id : "";
        if (!role || !roleId) return [];
        const roleModel =
          typeof role.description === "string"
            ? extractExperienceDescription(`${id}:${roleId}`, role.description)
            : null;
        return [
          {
            id: roleId,
            groups:
              roleModel?.groups.map(({ id: groupId, units }) => ({
                id: groupId,
                units,
              })) ?? [],
          },
        ];
      }) ?? [];

    entries.push({ id, groups, roles });
  }
  return { entries };
}

function applyExperienceDescription(args: {
  ownerId: string;
  description: unknown;
  selection: TailoredExperienceEntry | TailoredExperienceRole | undefined;
}): string | null {
  if (typeof args.description !== "string" || !args.selection) return null;
  const model = extractExperienceDescription(args.ownerId, args.description);
  if (!model) return null;
  const selections = new Map(
    args.selection.groups.map((group) => [group.id, group]),
  );
  if (selections.size !== args.selection.groups.length) return null;
  return model.render(selections);
}

export function applyTailoredExperience(
  resumeData: RecordLike,
  tailoredExperience?: unknown,
): void {
  const parsedExperience = parseTailoredExperienceInput(tailoredExperience);
  if (!parsedExperience) return;

  const selections = new Map(
    parsedExperience.entries.map((entry) => [entry.id, entry]),
  );
  if (selections.size !== parsedExperience.entries.length) return;

  const sections = asRecord(resumeData.sections);
  const experience = asRecord(sections?.experience);
  const items = asArray(experience?.items);
  if (!items) return;

  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const id = typeof item?.id === "string" ? item.id : "";
    const selection = selections.get(id);
    if (!item || !id || !selection) continue;

    const description = applyExperienceDescription({
      ownerId: id,
      description: item.description,
      selection,
    });
    if (description !== null) item.description = description;

    const roles = asArray(item.roles);
    if (!roles || !selection.roles) continue;
    const roleSelections = new Map(
      selection.roles.map((role) => [role.id, role]),
    );
    if (roleSelections.size !== selection.roles.length) continue;

    for (const rawRole of roles) {
      const role = asRecord(rawRole);
      const roleId = typeof role?.id === "string" ? role.id : "";
      const roleSelection = roleSelections.get(roleId);
      if (!role || !roleId || !roleSelection) continue;

      const roleDescription = applyExperienceDescription({
        ownerId: `${id}:${roleId}`,
        description: role.description,
        selection: roleSelection,
      });
      if (roleDescription !== null) role.description = roleDescription;
    }
  }
}

function parseTailoredSkills(
  skills: TailoredSkillsInput,
): Array<RecordLike | string> | null {
  if (!skills) return null;

  try {
    const parsed = Array.isArray(skills)
      ? skills
      : typeof skills === "string"
        ? (JSON.parse(skills) as unknown)
        : null;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item) => typeof item === "string" || (item && typeof item === "object"),
    ) as Array<RecordLike | string>;
  } catch {
    return null;
  }
}

export function applyTailoredHeadline(
  resumeData: RecordLike,
  headline?: string | null,
): void {
  if (!headline) return;
  const basics = asRecord(resumeData.basics);
  if (!basics) return;
  basics.headline = headline;
  // Preserve current behavior for legacy consumers/templates that use label.
  basics.label = headline;
}

export function applyTailoredSummary(
  resumeData: RecordLike,
  summary?: string | null,
): void {
  if (!summary) return;
  const topSummary = asRecord(resumeData.summary);
  if (topSummary) {
    if (
      typeof topSummary.content === "string" ||
      topSummary.content === undefined
    ) {
      topSummary.content = summary;
      return;
    }
    if (
      typeof topSummary.value === "string" ||
      topSummary.value === undefined
    ) {
      topSummary.value = summary;
      return;
    }
  }

  const sections = asRecord(resumeData.sections);
  const summarySection = asRecord(sections?.summary);
  if (summarySection) {
    summarySection.content = summary;
    return;
  }
}

export function applyTailoredSkills(
  resumeData: RecordLike,
  tailoredSkills?: TailoredSkillsInput,
): void {
  const skills = parseTailoredSkills(tailoredSkills);
  if (!skills) return;

  const sections = asRecord(resumeData.sections);
  const skillsSection = asRecord(sections?.skills);
  const existingItems = asArray(skillsSection?.items);
  if (!skillsSection || !existingItems) return;
  const existing = existingItems
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => Boolean(item));

  const template = existing[0] ?? null;
  if (!template) return;

  if (skills.every((skill) => typeof skill === "string")) {
    const selected = new Set(
      skills.map((skill) => skill.trim().toLocaleLowerCase()),
    );
    const ordered = skills.flatMap((skill) => {
      const match = existing.find(
        (item) =>
          (typeof item.name === "string"
            ? item.name
            : ""
          ).toLocaleLowerCase() === skill.trim().toLocaleLowerCase(),
      );
      return match && selected.delete(skill.trim().toLocaleLowerCase())
        ? [{ ...match }]
        : [];
    });
    skillsSection.items = ordered;
    return;
  }

  const groupedSkills = skills.filter(
    (skill): skill is RecordLike => typeof skill !== "string",
  );
  skillsSection.items = groupedSkills.map((newSkill) => {
    const match =
      existing.find((item) => item.name === newSkill.name) ?? template;
    const next: RecordLike = { ...match };

    if ("id" in next) {
      next.id =
        (typeof newSkill.id === "string" && newSkill.id) ||
        (typeof match.id === "string" ? match.id : "") ||
        createId();
    }
    if ("name" in next) {
      next.name =
        (typeof newSkill.name === "string" ? newSkill.name : "") ||
        (typeof match.name === "string" ? match.name : "");
    }
    if ("keywords" in next) {
      next.keywords = Array.isArray(newSkill.keywords)
        ? newSkill.keywords.filter((k) => typeof k === "string")
        : Array.isArray(match.keywords)
          ? match.keywords.filter((k) => typeof k === "string")
          : [];
    }

    if ("description" in next) {
      next.description =
        typeof newSkill.description === "string"
          ? newSkill.description
          : typeof match.description === "string"
            ? match.description
            : "";
    }
    if ("proficiency" in next) {
      next.proficiency =
        typeof newSkill.proficiency === "string"
          ? newSkill.proficiency
          : typeof newSkill.description === "string"
            ? newSkill.description
            : typeof match.proficiency === "string"
              ? match.proficiency
              : "";
    }
    if ("level" in next) {
      next.level =
        typeof newSkill.level === "number"
          ? newSkill.level
          : typeof match.level === "number"
            ? match.level
            : next.level;
    }
    if ("hidden" in next) {
      next.hidden =
        typeof newSkill.hidden === "boolean"
          ? newSkill.hidden
          : typeof match.hidden === "boolean"
            ? match.hidden
            : next.hidden;
    }

    return next;
  });
}

export function extractProjectsFromResume(resumeData: RecordLike): {
  catalog: ResumeProjectCatalogItem[];
  selectionItems: ResumeProjectSelectionItem[];
} {
  const sections = asRecord(resumeData.sections);
  const projectsSection = asRecord(sections?.projects);
  const items = asArray(projectsSection?.items);
  if (!items) return { catalog: [], selectionItems: [] };

  const catalog: ResumeProjectCatalogItem[] = [];
  const selectionItems: ResumeProjectSelectionItem[] = [];

  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;

    const name = typeof item.name === "string" ? item.name : id;
    const description =
      typeof item.description === "string"
        ? stripHtmlTags(item.description)
        : "";
    const date = typeof item.period === "string" ? item.period : "";

    const isVisibleInBase = !(typeof item.hidden === "boolean"
      ? item.hidden
      : false);

    const summaryRaw = description;

    const base: ResumeProjectCatalogItem = {
      id,
      name,
      description,
      date,
      isVisibleInBase,
    };
    catalog.push(base);
    selectionItems.push({
      ...base,
      summaryText: stripHtmlTags(summaryRaw),
    });
  }

  return { catalog, selectionItems };
}

export function applyProjectVisibility(args: {
  resumeData: RecordLike;
  selectedProjectIds: ReadonlySet<string>;
  forceVisibleProjectsSection?: boolean;
}): void {
  const sections = asRecord(args.resumeData.sections);
  const projectsSection = asRecord(sections?.projects);
  const items = asArray(projectsSection?.items);
  if (!projectsSection || !items) return;

  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;

    if ("hidden" in item) {
      item.hidden = !args.selectedProjectIds.has(id);
    }
  }

  if (args.forceVisibleProjectsSection !== false) {
    if ("hidden" in projectsSection) {
      projectsSection.hidden = false;
    }
  }
}

export function applyTailoredChunks(args: {
  resumeData: RecordLike;
  tailoredContent: TailorChunkInput;
}): void {
  applyTailoredSkills(args.resumeData, args.tailoredContent.skills);
  applyTailoredSummary(args.resumeData, args.tailoredContent.summary);
  applyTailoredHeadline(args.resumeData, args.tailoredContent.headline);
  applyTailoredExperience(args.resumeData, args.tailoredContent.experience);
}
