import * as api from "@client/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsSection } from "./AccountSettingsSection";

vi.mock("@client/api", () => ({
  changeOwnPassword: vi.fn(),
  getCurrentAuthUser: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AccountSettingsSection layoutMode="panel" />
    </QueryClientProvider>,
  );
};

describe("AccountSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCurrentAuthUser).mockResolvedValue({
      id: "user-1",
      username: "ada",
      displayName: "Ada Lovelace",
      isSystemAdmin: false,
      isDisabled: false,
      workspaceId: "workspace-1",
      workspaceName: "Ada's workspace",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("lets the signed-in user change their password and sign out deliberately", async () => {
    vi.mocked(api.changeOwnPassword).mockResolvedValue();
    renderSection();

    expect(await screen.findByText("ada")).toBeInTheDocument();
    const password = screen.getByLabelText("New password");
    fireEvent.change(password, { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => {
      expect(api.changeOwnPassword).toHaveBeenCalledWith("new-password");
    });
    expect(password).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(api.logout).toHaveBeenCalledWith();
  });
});
