import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../hooks/useSettings";
import { PageHeader } from "./layout";

vi.mock("../hooks/useSettings", () => ({ useSettings: vi.fn() }));
vi.mock("../hooks/useVersionCheck", () => ({
  useVersionCheck: () => ({ version: "v1.0.0", updateAvailable: false }),
}));
vi.mock("./StatusIndicator", () => ({ StatusBadgeIndicator: () => null }));

const LocationWatcher = ({
  onChange,
}: {
  onChange: (value: string) => void;
}) => {
  const location = useLocation();
  onChange(`${location.pathname}${location.hash}`);
  return null;
};

describe("PageHeader account navigation", () => {
  beforeEach(() => {
    vi.mocked(useSettings).mockReturnValue({
      settings: null,
      error: null,
      isLoading: false,
      showSponsorInfo: true,
      renderMarkdownInJobDescriptions: true,
      autoTailorOnManualImport: true,
      refreshSettings: vi.fn(),
    });
  });

  it("opens account management instead of signing out", () => {
    let location = "";
    render(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <LocationWatcher
          onChange={(value) => {
            location = value;
          }}
        />
        <PageHeader
          icon={() => null}
          title="Jobs"
          subtitle="Manage jobs"
          showVersionFooter={false}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    expect(location).toBe("/settings#account");
  });
});
