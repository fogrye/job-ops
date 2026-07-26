import { Archive } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { FilterPill } from "./FilterPill";
import type { ArchiveFilterPillProps } from "./types";

const options = [
  { value: "active", label: "Active jobs" },
  { value: "archived", label: "Archived jobs" },
  { value: "all", label: "All jobs" },
] as const;

export const ArchiveFilterPill: React.FC<ArchiveFilterPillProps> = ({
  archiveFilter,
  onArchiveFilterChange,
}) => (
  <FilterPill
    icon={<Archive />}
    label="Archive"
    active={archiveFilter !== "active"}
    summary={
      archiveFilter === "active"
        ? null
        : options.find((option) => option.value === archiveFilter)?.label
    }
  >
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={archiveFilter === option.value ? "default" : "outline"}
          onClick={() => onArchiveFilterChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  </FilterPill>
);
