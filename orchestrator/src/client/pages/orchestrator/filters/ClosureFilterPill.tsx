import { APPLICATION_OUTCOMES, OUTCOME_LABELS } from "@shared/types";
import { Archive } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import type { ClosureFilter } from "../constants";
import { FilterPill } from "./FilterPill";
import type { ClosureFilterPillProps } from "./types";

const options: Array<{ value: ClosureFilter; label: string }> = [
  { value: "active", label: "Active jobs" },
  { value: "closed", label: "Closed jobs" },
  ...APPLICATION_OUTCOMES.map((value) => ({
    value,
    label: OUTCOME_LABELS[value],
  })),
  { value: "all", label: "All jobs" },
];

export const ClosureFilterPill: React.FC<ClosureFilterPillProps> = ({
  closureFilter,
  onClosureFilterChange,
}) => (
  <FilterPill
    icon={<Archive />}
    label="Status"
    active={closureFilter !== "active"}
    summary={
      closureFilter === "active"
        ? null
        : options.find((option) => option.value === closureFilter)?.label
    }
  >
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={closureFilter === option.value ? "default" : "outline"}
          onClick={() => onClosureFilterChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  </FilterPill>
);
