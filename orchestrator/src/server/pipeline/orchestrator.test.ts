import { beforeEach, describe, expect, it, vi } from "vitest";

const events: string[] = [];
const mocks = vi.hoisted(() => ({
  getJobById: vi.fn(),
  updateJob: vi.fn(),
  getSetting: vi.fn(),
  getProfile: vi.fn(),
  generateTailoring: vi.fn(),
  reserveHostedUsage: vi.fn(),
  settleHostedUsageReservation: vi.fn(),
  refundHostedUsageReservation: vi.fn(),
}));

vi.mock("@infra/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@infra/product-analytics", () => ({
  trackServerProductEvent: vi.fn(),
}));
vi.mock("@infra/request-context", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@server/repositories/jobs", () => ({
  getJobById: mocks.getJobById,
  updateJob: mocks.updateJob,
}));
vi.mock("@server/repositories/settings", () => ({
  getSetting: mocks.getSetting,
}));
vi.mock("@server/services/hosted-usage", () => ({
  reserveHostedUsage: mocks.reserveHostedUsage,
  settleHostedUsageReservation: mocks.settleHostedUsageReservation,
  refundHostedUsageReservation: mocks.refundHostedUsageReservation,
}));
vi.mock("@server/services/profile", () => ({ getProfile: mocks.getProfile }));
vi.mock("@server/services/summary", () => ({
  generateTailoring: mocks.generateTailoring,
}));

import { summarizeJob } from "./orchestrator";

describe("summarizeJob tailoring usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    mocks.getJobById.mockResolvedValue({
      id: "job-1",
      jobDescription: "Build APIs",
      tailoredSummary: null,
      tailoredHeadline: "Engineer",
      tailoredSkills: null,
      tailoredExperience: null,
      selectedProjectIds: null,
    });
    mocks.getSetting.mockResolvedValue(null);
    mocks.getProfile.mockResolvedValue({ basics: { name: "Test User" } });
    mocks.updateJob.mockResolvedValue(undefined);
    mocks.reserveHostedUsage.mockImplementation(async () => {
      events.push("reserve");
      return { reservation: { id: "reservation-1" } };
    });
    mocks.settleHostedUsageReservation.mockImplementation(async () => {
      events.push("settle");
    });
    mocks.refundHostedUsageReservation.mockImplementation(async () => {
      events.push("refund");
    });
    mocks.generateTailoring.mockImplementation(async () => {
      events.push("generate");
      return {
        success: true,
        data: { summary: "Tailored", headline: "Engineer", skills: [] },
      };
    });
  });

  it("reserves before targeted tailoring and settles successful usage", async () => {
    await expect(
      summarizeJob("job-1", { fields: ["summary"] }),
    ).resolves.toEqual({ success: true });

    expect(events).toEqual(["reserve", "generate", "settle"]);
    expect(mocks.reserveHostedUsage).toHaveBeenCalledWith({
      action: "tailoring",
    });
    expect(mocks.settleHostedUsageReservation).toHaveBeenCalledWith({
      reservationId: "reservation-1",
      usedUnits: 1,
    });
  });

  it("settles zero usage when targeted tailoring fails", async () => {
    mocks.generateTailoring.mockImplementation(async () => {
      events.push("generate");
      return { success: false, error: "provider failed" };
    });

    await expect(
      summarizeJob("job-1", { fields: ["summary"] }),
    ).resolves.toEqual({
      success: false,
      error: "Tailoring failed: provider failed",
    });

    expect(events).toEqual(["reserve", "generate", "settle"]);
    expect(mocks.settleHostedUsageReservation).toHaveBeenCalledWith({
      reservationId: "reservation-1",
      usedUnits: 0,
    });
    expect(mocks.refundHostedUsageReservation).not.toHaveBeenCalled();
  });

  it("refunds the reservation when targeted result persistence throws", async () => {
    mocks.updateJob.mockRejectedValue(new Error("database failed"));

    await expect(
      summarizeJob("job-1", { fields: ["summary"] }),
    ).resolves.toEqual({ success: false, error: "database failed" });

    expect(events).toEqual(["reserve", "generate", "refund"]);
    expect(mocks.refundHostedUsageReservation).toHaveBeenCalledWith(
      "reservation-1",
    );
    expect(mocks.settleHostedUsageReservation).not.toHaveBeenCalled();
  });
});
