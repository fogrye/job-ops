import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { TailoredExperienceSection } from "./TailoredExperienceSection";

const view = {
  status: "original" as const,
  entries: [
    {
      id: "entry-1",
      company: "Acme Labs",
      position: "Backend Engineer",
      date: "2022–2024",
      location: "Remote",
      groups: [
        {
          id: "entry-1-group-1",
          units: [
            { id: "unit-1", text: "Built reliable APIs." },
            { id: "unit-2", text: "Improved query performance." },
          ],
          selectedUnitIds: ["unit-1", "unit-2"],
        },
      ],
      roles: [],
    },
  ],
};

const renderSection = (disabled = false) =>
  render(
    <Accordion type="multiple">
      <TailoredExperienceSection
        view={view}
        disabled={disabled}
        generating={false}
        onGenerate={vi.fn()}
        onReset={vi.fn()}
        onChange={vi.fn()}
      />
    </Accordion>,
  );
describe("TailoredExperienceSection", () => {
  it("exposes source units and ordering controls accessibly", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Experience" }));

    expect(
      screen.getByText("Acme Labs · Backend Engineer"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Keep experience unit 1" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Keep experience unit 2" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Move experience unit 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move experience unit 1 down" }),
    ).toBeEnabled();
  });

  it("explains and disables selection controls when tailoring is off", () => {
    renderSection(true);
    fireEvent.click(screen.getByRole("button", { name: "Experience" }));

    expect(
      screen.getByText(/Enable Emphasize relevant work history in Settings/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Keep experience unit 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Generate experience" }),
    ).toBeDisabled();
  });
});
