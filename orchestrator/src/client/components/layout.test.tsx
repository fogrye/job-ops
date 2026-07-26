import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../hooks/useSettings";
import { NavigationPanel, PageHeader } from "./layout";

vi.mock("../hooks/useSettings", () => ({ useSettings: vi.fn() }));
vi.mock("../hooks/useVersionCheck", () => ({
  useVersionCheck: () => ({ version: "v1.0.0", updateAvailable: false }),
}));
vi.mock("./StatusIndicator", () => ({ StatusBadgeIndicator: () => null }));
vi.mock("../pages/settings/components/AccountSettingsSection", () => ({
  AccountSettingsSection: () => <div>Account controls</div>,
}));

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

  it("opens account management in place instead of navigating or signing out", () => {
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

    expect(location).toBe("/jobs/ready");
    expect(screen.getByText("Account controls")).toBeInTheDocument();
  });
});

describe("NavigationPanel", () => {
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

  it("collapses labels while preserving accessible navigation controls", () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <NavigationPanel collapsed={false} onCollapse={onCollapse} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Jobs")).not.toHaveClass("sr-only");
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse navigation" }),
    );
    expect(onCollapse).toHaveBeenCalledOnce();

    rerender(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <NavigationPanel collapsed onCollapse={onCollapse} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Jobs")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand navigation" }),
    ).toBeInTheDocument();
  });

  it("opens account management in place", () => {
    let location = "";
    const recordLocation = (value: string) => {
      location = value;
    };
    render(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <LocationWatcher onChange={recordLocation} />
        <NavigationPanel collapsed={false} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(location).toBe("/jobs/ready");
    expect(screen.getByText("Account controls")).toBeInTheDocument();
  });

  it("hides the sponsor link when sponsor information is unavailable", () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: null,
      error: null,
      isLoading: false,
      showSponsorInfo: false,
      renderMarkdownInJobDescriptions: true,
      autoTailorOnManualImport: true,
      refreshSettings: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <NavigationPanel collapsed={false} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: /visa sponsors/i }),
    ).not.toBeInTheDocument();
  });
});
