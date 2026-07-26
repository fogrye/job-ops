import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useOrchestratorNavigation } from "./useOrchestratorNavigation";

const NavigationHarness = () => {
  const location = useLocation();
  const navigation = useOrchestratorNavigation({
    searchParams: new URLSearchParams(location.search),
    closureFilter: "active",
  });

  return (
    <>
      <output>{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={navigation.openClosedJobs}>
        View closed jobs
      </button>
      <button
        type="button"
        onClick={() =>
          navigation.navigateToCommandJob("all", "closed-job", "closed")
        }
      >
        Select closed command result
      </button>
    </>
  );
};

const renderNavigation = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/jobs/:tab/:jobId?" element={<NavigationHarness />} />
      </Routes>
    </MemoryRouter>,
  );

describe("useOrchestratorNavigation", () => {
  it("opens closed jobs through All Jobs while preserving existing filters", () => {
    renderNavigation("/jobs/applied?source=manual");

    fireEvent.click(screen.getByRole("button", { name: "View closed jobs" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "/jobs/all?source=manual&closure=closed",
    );
  });

  it("selects closed command results through the closed All Jobs filter", () => {
    renderNavigation("/jobs/ready?source=manual&closure=all");

    fireEvent.click(
      screen.getByRole("button", { name: "Select closed command result" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "/jobs/all/closed-job?closure=closed",
    );
  });

  it("redirects the removed archive route to Ready Jobs", async () => {
    renderNavigation("/jobs/archive");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("/jobs/ready"),
    );
  });
});
