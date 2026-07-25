import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { PipelineSearchPreset } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { SchedulerSettingsSection } from "./SchedulerSettingsSection";

vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void;
  } | null>(null);

  const Select = ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => {
    return (
      <SelectContext.Provider value={{ onValueChange }}>
        <div>
          <input readOnly value={value ?? ""} aria-label="select-value" />
          {children}
        </div>
      </SelectContext.Provider>
    );
  };

  const SelectContent = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    const context = React.useContext(SelectContext);

    return (
      <button type="button" onClick={() => context?.onValueChange?.(value)}>
        {children}
      </button>
    );
  };
  const SelectTrigger = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" role="combobox" aria-expanded="false" {...props}>
      {children}
    </button>
  );
  const SelectValue = () => null;

  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

const PRESETS: PipelineSearchPreset[] = [
  {
    id: "preset-1",
    name: "Remote Backend Roles",
    config: {} as PipelineSearchPreset["config"],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastUsedAt: null,
  },
  {
    id: "preset-2",
    name: "Frontend in Berlin",
    config: {} as PipelineSearchPreset["config"],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastUsedAt: null,
  },
];

const SchedulerSettingsHarness = ({
  presets = PRESETS,
  isLoadingPresets = false,
}: {
  presets?: PipelineSearchPreset[];
  isLoadingPresets?: boolean;
} = {}) => {
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      dailySearchEnabled: null,
      dailySearchHour: null,
      dailySearchWeekendEnabled: null,
      dailySearchPresetId: null,
      mailboxSyncEnabled: null,
      mailboxSyncHour: null,
      mailboxSyncWeekendEnabled: null,
    },
  });

  return (
    <FormProvider {...methods}>
      <Accordion type="multiple" defaultValue={["scheduler"]}>
        <SchedulerSettingsSection
          values={{
            dailySearchEnabled: { effective: true, default: true },
            dailySearchHour: { effective: 6, default: 6 },
            dailySearchWeekendEnabled: { effective: true, default: true },
            dailySearchPresetId: { effective: "", default: "" },
            mailboxSyncEnabled: { effective: true, default: true },
            mailboxSyncHour: { effective: 7, default: 7 },
            mailboxSyncWeekendEnabled: { effective: true, default: true },
          }}
          presets={presets}
          isLoadingPresets={isLoadingPresets}
          isLoading={false}
          isSaving={false}
        />
      </Accordion>
    </FormProvider>
  );
};

describe("SchedulerSettingsSection", () => {
  it("renders the daily-search enable checkbox, hour input, and preset options", () => {
    render(<SchedulerSettingsHarness />);

    expect(
      screen.getByLabelText("Enable daily active search"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Daily Search Hour")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Run daily active search on weekends"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remote Backend Roles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Frontend in Berlin" }),
    ).toBeInTheDocument();
  });

  it("toggles the daily-search enabled field via the checkbox", () => {
    render(<SchedulerSettingsHarness />);

    const checkbox = screen.getByLabelText("Enable daily active search");
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("toggles weekend automation independently from the daily schedule", () => {
    render(<SchedulerSettingsHarness />);

    const weekendCheckbox = screen.getByLabelText(
      "Run daily active search on weekends",
    );
    expect(weekendCheckbox).toHaveAttribute("aria-checked", "true");

    fireEvent.click(weekendCheckbox);

    expect(weekendCheckbox).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Enable daily active search")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("updates the preset field when a preset is selected", () => {
    render(<SchedulerSettingsHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Frontend in Berlin" }));

    expect(screen.getByLabelText("select-value")).toHaveValue("preset-2");
  });

  it("shows a helper note instead of preset options when there are no saved searches", () => {
    render(<SchedulerSettingsHarness presets={[]} />);

    expect(
      screen.getByText(
        "No saved searches yet — daily search will use your global search settings.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remote Backend Roles" }),
    ).not.toBeInTheDocument();
  });

  it("renders the mailbox-sync enable checkbox and hour input", () => {
    render(<SchedulerSettingsHarness />);

    expect(
      screen.getByLabelText("Enable daily mailbox sync"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Run mailbox sync on weekends"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Mailbox Sync Hour")).toBeInTheDocument();
  });
});
