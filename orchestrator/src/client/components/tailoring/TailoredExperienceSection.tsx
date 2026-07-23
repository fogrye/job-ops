import type {
  TailoredExperienceView,
  TailoredExperienceViewGroup,
} from "@shared/types";
import { ArrowDown, ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface TailoredExperienceSectionProps {
  view: TailoredExperienceView | null;
  disabled: boolean;
  generating: boolean;
  onGenerate: () => void;
  onReset: () => void;
  onChange: (value: string) => void;
}

const sectionClass =
  "overflow-hidden rounded-md border border-border/55 bg-background/25 px-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";
const triggerClass =
  "min-h-11 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/20 hover:no-underline data-[state=open]:border-b data-[state=open]:border-border/45";
const actionClass =
  "h-7 border-border/60 bg-background/45 px-2 text-[11px] text-muted-foreground hover:bg-muted/35 hover:text-foreground";

const statusCopy: Record<TailoredExperienceView["status"], string> = {
  original: "Original",
  tailored: "Tailored",
  stale: "Source changed",
};

const statusClass: Record<TailoredExperienceView["status"], string> = {
  original: "border-border/60 bg-muted/20 text-muted-foreground",
  tailored: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  stale: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

const sourceGroupPayload = (group: TailoredExperienceViewGroup) => ({
  id: group.id,
  unitIds: group.selectedUnitIds,
});

function serializeView(view: TailoredExperienceView): string {
  return JSON.stringify({
    entries: view.entries.map((entry) => ({
      id: entry.id,
      groups: entry.groups.map(sourceGroupPayload),
      ...(entry.roles.length > 0
        ? {
            roles: entry.roles.map((role) => ({
              id: role.id,
              groups: role.groups.map(sourceGroupPayload),
            })),
          }
        : {}),
    })),
  });
}

function updateGroup(
  view: TailoredExperienceView,
  entryId: string,
  roleId: string | null,
  groupId: string,
  update: (ids: string[]) => string[],
): string {
  const next: TailoredExperienceView = {
    ...view,
    entries: view.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      if (!roleId) {
        return {
          ...entry,
          groups: entry.groups.map((group) =>
            group.id === groupId
              ? { ...group, selectedUnitIds: update(group.selectedUnitIds) }
              : group,
          ),
        };
      }
      return {
        ...entry,
        roles: entry.roles.map((role) =>
          role.id !== roleId
            ? role
            : {
                ...role,
                groups: role.groups.map((group) =>
                  group.id === groupId
                    ? {
                        ...group,
                        selectedUnitIds: update(group.selectedUnitIds),
                      }
                    : group,
                ),
              },
        ),
      };
    }),
  };
  return serializeView(next);
}

const GroupUnits: React.FC<{
  view: TailoredExperienceView;
  entryId: string;
  roleId: string | null;
  group: TailoredExperienceViewGroup;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ view, entryId, roleId, group, disabled, onChange }) => {
  const selected = new Set(group.selectedUnitIds);
  return (
    <div className="space-y-1 rounded-md border border-border/45 bg-background/35 p-2">
      {group.units.map((unit, index) => {
        const isSelected = selected.has(unit.id);
        const selectedIndex = group.selectedUnitIds.indexOf(unit.id);
        return (
          <div
            key={unit.id}
            className={cn(
              "flex items-start gap-2 rounded px-2 py-1.5",
              isSelected ? "bg-muted/25" : "opacity-60",
            )}
          >
            <Checkbox
              checked={isSelected}
              disabled={
                disabled || (isSelected && group.selectedUnitIds.length === 1)
              }
              onCheckedChange={(checked) =>
                onChange(
                  updateGroup(view, entryId, roleId, group.id, (ids) => {
                    if (checked)
                      return ids.includes(unit.id) ? ids : [...ids, unit.id];
                    return ids.filter((id) => id !== unit.id);
                  }),
                )
              }
              aria-label={`${isSelected ? "Keep" : "Include"} experience unit ${index + 1}`}
            />
            <span className="min-w-0 flex-1 text-xs leading-5 text-foreground/85">
              {unit.text || "Source content"}
            </span>
            {isSelected ? (
              <span className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  disabled={disabled || selectedIndex <= 0}
                  onClick={() =>
                    onChange(
                      updateGroup(view, entryId, roleId, group.id, (ids) => {
                        const next = [...ids];
                        [next[selectedIndex - 1], next[selectedIndex]] = [
                          next[selectedIndex],
                          next[selectedIndex - 1],
                        ];
                        return next;
                      }),
                    )
                  }
                  aria-label={`Move experience unit ${index + 1} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  disabled={
                    disabled ||
                    selectedIndex >= group.selectedUnitIds.length - 1
                  }
                  onClick={() =>
                    onChange(
                      updateGroup(view, entryId, roleId, group.id, (ids) => {
                        const next = [...ids];
                        [next[selectedIndex], next[selectedIndex + 1]] = [
                          next[selectedIndex + 1],
                          next[selectedIndex],
                        ];
                        return next;
                      }),
                    )
                  }
                  aria-label={`Move experience unit ${index + 1} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export const TailoredExperienceSection: React.FC<
  TailoredExperienceSectionProps
> = ({ view, disabled, generating, onGenerate, onReset, onChange }) => {
  const [draftView, setDraftView] = useState(view);

  useEffect(() => {
    setDraftView(view);
  }, [view]);

  const handleChange = (value: string) => {
    if (!draftView) return;
    try {
      const payload = JSON.parse(value) as {
        entries: Array<{
          id: string;
          groups: Array<{ id: string; unitIds: string[] }>;
          roles?: Array<{
            id: string;
            groups: Array<{ id: string; unitIds: string[] }>;
          }>;
        }>;
      };
      const entrySelections = new Map(
        payload.entries.map((entry) => [entry.id, entry]),
      );
      const nextView: TailoredExperienceView = {
        ...draftView,
        status: "tailored",
        entries: draftView.entries.map((entry) => {
          const selection = entrySelections.get(entry.id);
          if (!selection) return entry;
          const groups = new Map(
            selection.groups.map((group) => [group.id, group.unitIds]),
          );
          const roles = new Map(
            (selection.roles ?? []).map((role) => [
              role.id,
              new Map(role.groups.map((group) => [group.id, group.unitIds])),
            ]),
          );
          return {
            ...entry,
            groups: entry.groups.map((group) =>
              groups.has(group.id)
                ? {
                    ...group,
                    selectedUnitIds:
                      groups.get(group.id) ?? group.selectedUnitIds,
                  }
                : group,
            ),
            roles: entry.roles.map((role) => {
              const roleGroups = roles.get(role.id);
              return roleGroups
                ? {
                    ...role,
                    groups: role.groups.map((group) =>
                      roleGroups.has(group.id)
                        ? {
                            ...group,
                            selectedUnitIds:
                              roleGroups.get(group.id) ?? group.selectedUnitIds,
                          }
                        : group,
                    ),
                  }
                : role;
            }),
          };
        }),
      };
      setDraftView(nextView);
      onChange(value);
    } catch {
      onChange(value);
    }
  };

  if (!draftView) {
    return (
      <AccordionItem value="experience" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Experience">
          Experience
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3 text-xs text-muted-foreground">
          Loading source work history...
        </AccordionContent>
      </AccordionItem>
    );
  }

  const hasEntries = draftView.entries.length > 0;
  const reason =
    draftView.status === "stale"
      ? "The base resume changed. Regenerate or reset this job's experience selection."
      : disabled
        ? "Enable Emphasize relevant work history in Settings to generate or edit this selection."
        : "Only existing source content can be selected and reordered.";

  return (
    <AccordionItem value="experience" className={sectionClass}>
      <AccordionTrigger className={triggerClass} aria-label="Experience">
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
          <span className="truncate text-sm font-semibold text-foreground/85">
            Experience
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
              statusClass[draftView.status],
            )}
          >
            {statusCopy[draftView.status]}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 px-3 pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={actionClass}
            disabled={disabled || generating || !hasEntries}
            onClick={onGenerate}
            aria-label="Generate experience"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            {generating ? "Generating..." : "Generate"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={actionClass}
            disabled={disabled || generating || draftView.status === "original"}
            onClick={onReset}
            aria-label="Reset experience to original"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">{reason}</p>
        {!hasEntries ? (
          <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-4 text-center text-[11px] text-muted-foreground">
            No work history is available in the base resume.
          </div>
        ) : (
          <div className="space-y-3">
            {draftView.entries.map((entry) => (
              <div key={entry.id} className="space-y-2">
                <div className="text-xs font-semibold text-foreground/85">
                  {entry.company || "Employer"} · {entry.position || "Role"}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {[entry.date, entry.location].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {entry.groups.map((group) => (
                  <GroupUnits
                    key={group.id}
                    view={draftView}
                    entryId={entry.id}
                    roleId={null}
                    group={group}
                    disabled={disabled || draftView.status === "stale"}
                    onChange={handleChange}
                  />
                ))}
                {entry.roles.map((role) => (
                  <div
                    key={role.id}
                    className="ml-3 space-y-2 border-l border-border/50 pl-3"
                  >
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {role.position || "Role"}
                      {[role.date, role.location].filter(Boolean).length > 0
                        ? ` · ${[role.date, role.location].filter(Boolean).join(" · ")}`
                        : ""}
                    </div>
                    {role.groups.map((group) => (
                      <GroupUnits
                        key={group.id}
                        entryId={entry.id}
                        view={draftView}
                        roleId={role.id}
                        group={group}
                        disabled={disabled || draftView.status === "stale"}
                        onChange={handleChange}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};
