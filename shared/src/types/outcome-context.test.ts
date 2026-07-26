import { describe, expect, it } from "vitest";
import {
  OUTCOME_LABELS,
  outcomesForStage,
  outcomesForStatus,
} from "./jobs";

describe("outcome context", () => {
  it("only exposes close outcomes for applied statuses", () => {
    expect(outcomesForStatus("ready")).toEqual([]);
    expect(outcomesForStatus("applied")).toEqual(["rejected", "ghosted"]);
  });

  it("uses stage-specific close outcomes", () => {
    expect(outcomesForStage("offer")).toEqual([
      "offer_accepted",
      "offer_declined",
      "withdrawn",
    ]);
    expect(outcomesForStage("technical_interview")).toEqual([
      "rejected",
      "withdrawn",
      "ghosted",
    ]);
  });

  it("returns only labelled outcomes", () => {
    for (const outcomes of [
      outcomesForStatus("ready"),
      outcomesForStatus("applied"),
      outcomesForStatus("in_progress"),
      outcomesForStage("offer"),
      outcomesForStage("technical_interview"),
    ]) {
      expect(outcomes.every((outcome) => outcome in OUTCOME_LABELS)).toBe(true);
    }
  });
});
