import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JobDescriptionPanel } from "./JobDescriptionPanel";

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: () => ({
    renderMarkdownInJobDescriptions: true,
  }),
}));

describe("JobDescriptionPanel", () => {
  it("renders sanitized HTML job descriptions with structure preserved", () => {
    const { container } = render(
      <JobDescriptionPanel
        collapsible={false}
        description={
          "<h2>Senior Engineer</h2><ul><li>Build systems</li></ul><script>alert(1)</script>"
        }
      />,
    );

    expect(
      screen.getByRole("heading", { name: /senior engineer/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Build systems")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps controlled expansion when the description changes", () => {
    let isOpen = false;
    let rerender: (ui: ReactNode) => void = () => {};
    const renderPanel = (description: string) => (
      <JobDescriptionPanel
        description={description}
        open={isOpen}
        onOpenChange={(nextOpen) => {
          isOpen = nextOpen;
          rerender(renderPanel("Updated description"));
        }}
      />
    );

    const rendered = render(renderPanel("Initial description"));
    rerender = rendered.rerender;

    const trigger = screen.getByRole("button", { name: /job description/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    rendered.rerender(renderPanel("Updated description"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
