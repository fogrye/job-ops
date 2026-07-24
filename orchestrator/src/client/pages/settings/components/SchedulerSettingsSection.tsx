import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { SchedulerValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { PipelineSearchPreset } from "@shared/types.js";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type SchedulerSettingsSectionProps = {
  values: SchedulerValues;
  presets: PipelineSearchPreset[];
  isLoadingPresets: boolean;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

// Radix Select rejects an empty-string item value, so "Auto" uses this
// sentinel and is translated back to "" (the stored default) on change.
const AUTO_PRESET_VALUE = "auto";

export const SchedulerSettingsSection: React.FC<
  SchedulerSettingsSectionProps
> = ({
  values,
  presets,
  isLoadingPresets,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    dailySearchEnabled,
    dailySearchHour,
    dailySearchPresetId,
    mailboxSyncEnabled,
    mailboxSyncHour,
  } = values;
  const { control, watch } = useFormContext<UpdateSettingsInput>();

  const currentDailySearchEnabled =
    watch("dailySearchEnabled") ?? dailySearchEnabled.default;
  const currentMailboxSyncEnabled =
    watch("mailboxSyncEnabled") ?? mailboxSyncEnabled.default;

  const effectivePresetName =
    presets.find((preset) => preset.id === dailySearchPresetId.effective)
      ?.name ?? null;

  return (
    <SettingsSectionFrame mode={layoutMode} title="Scheduler" value="scheduler">
      <div className="space-y-6">
        <div className="space-y-6">
          <div className="text-sm font-medium">Daily active search</div>
          <div className="flex items-start space-x-3">
            <Controller
              name="dailySearchEnabled"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="dailySearchEnabled"
                  checked={field.value ?? dailySearchEnabled.default}
                  onCheckedChange={(checked) => {
                    field.onChange(
                      checked === "indeterminate" ? null : checked === true,
                    );
                  }}
                  disabled={isLoading || isSaving}
                />
              )}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="dailySearchEnabled"
                className="cursor-pointer text-sm font-medium leading-none"
              >
                Enable daily active search
              </label>
              <p className="text-xs text-muted-foreground">
                Automatically run the active-search pipeline once a day using a
                saved search preset.
              </p>
            </div>
          </div>

          {currentDailySearchEnabled && (
            <div className="grid gap-6 pl-7 md:grid-cols-2">
              <Controller
                name="dailySearchHour"
                control={control}
                render={({ field }) => (
                  <SettingsInput
                    label="Daily Search Hour"
                    type="number"
                    inputProps={{
                      ...field,
                      inputMode: "numeric",
                      min: 0,
                      max: 23,
                      value: field.value ?? dailySearchHour.default,
                      onChange: (event) => {
                        const value = parseInt(event.target.value, 10);
                        if (Number.isNaN(value)) {
                          field.onChange(null);
                        } else {
                          field.onChange(Math.min(23, Math.max(0, value)));
                        }
                      },
                    }}
                    disabled={isLoading || isSaving}
                    helper="Hour of the day (0-23) in UTC when the daily active-search run should fire."
                    current={`Effective: ${dailySearchHour.effective}:00 UTC | Default: ${dailySearchHour.default}:00 UTC`}
                  />
                )}
              />

              <div className="space-y-2">
                <label
                  htmlFor="dailySearchPresetId"
                  className="text-sm font-medium"
                >
                  Search Preset
                </label>
                <Controller
                  name="dailySearchPresetId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value || AUTO_PRESET_VALUE}
                      onValueChange={(value) => {
                        field.onChange(
                          value === AUTO_PRESET_VALUE ? null : value,
                        );
                      }}
                      disabled={isLoading || isSaving || isLoadingPresets}
                    >
                      <SelectTrigger id="dailySearchPresetId">
                        <SelectValue
                          placeholder={
                            isLoadingPresets
                              ? "Loading saved searches…"
                              : "Auto (most recently used preset)"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO_PRESET_VALUE}>
                          Auto (most recently used preset)
                        </SelectItem>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {presets.length === 0 && !isLoadingPresets && (
                  <p className="text-xs text-muted-foreground">
                    No saved searches yet — daily search will use your global
                    search settings.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-6">
          <div className="text-sm font-medium">Mailbox sync</div>
          <div className="flex items-start space-x-3">
            <Controller
              name="mailboxSyncEnabled"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="mailboxSyncEnabled"
                  checked={field.value ?? mailboxSyncEnabled.default}
                  onCheckedChange={(checked) => {
                    field.onChange(
                      checked === "indeterminate" ? null : checked === true,
                    );
                  }}
                  disabled={isLoading || isSaving}
                />
              )}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="mailboxSyncEnabled"
                className="cursor-pointer text-sm font-medium leading-none"
              >
                Enable daily mailbox sync
              </label>
              <p className="text-xs text-muted-foreground">
                Automatically sync Gmail for all connected accounts once a day.
              </p>
            </div>
          </div>

          {currentMailboxSyncEnabled && (
            <div className="grid gap-6 pl-7 md:grid-cols-2">
              <Controller
                name="mailboxSyncHour"
                control={control}
                render={({ field }) => (
                  <SettingsInput
                    label="Mailbox Sync Hour"
                    type="number"
                    inputProps={{
                      ...field,
                      inputMode: "numeric",
                      min: 0,
                      max: 23,
                      value: field.value ?? mailboxSyncHour.default,
                      onChange: (event) => {
                        const value = parseInt(event.target.value, 10);
                        if (Number.isNaN(value)) {
                          field.onChange(null);
                        } else {
                          field.onChange(Math.min(23, Math.max(0, value)));
                        }
                      },
                    }}
                    disabled={isLoading || isSaving}
                    helper="Hour of the day (0-23) in UTC when Gmail should be synced for all connected accounts."
                    current={`Effective: ${mailboxSyncHour.effective}:00 UTC | Default: ${mailboxSyncHour.default}:00 UTC`}
                  />
                )}
              />
            </div>
          )}
        </div>

        <Separator />

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Daily Search</div>
            <div className="break-words font-mono text-xs">
              Effective: {dailySearchEnabled.effective ? "Yes" : "No"} |
              Default: {dailySearchEnabled.default ? "Yes" : "No"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Daily Search Hour
            </div>
            <div className="break-words font-mono text-xs">
              Effective: {dailySearchHour.effective}:00 UTC | Default:{" "}
              {dailySearchHour.default}:00 UTC
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Search Preset</div>
            <div className="break-words font-mono text-xs">
              Effective: {effectivePresetName ?? "Auto (most recently used)"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Mailbox Sync</div>
            <div className="break-words font-mono text-xs">
              Effective: {mailboxSyncEnabled.effective ? "Yes" : "No"} |
              Default: {mailboxSyncEnabled.default ? "Yes" : "No"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Mailbox Sync Hour
            </div>
            <div className="break-words font-mono text-xs">
              Effective: {mailboxSyncHour.effective}:00 UTC | Default:{" "}
              {mailboxSyncHour.default}:00 UTC
            </div>
          </div>
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
