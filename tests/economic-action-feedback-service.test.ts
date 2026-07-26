import { describe, expect, it } from "vitest";

import {
  EconomicActionConflictError,
  EconomicActionIdentityError,
} from "@/lib/economic-action-errors";
import { runEconomicActionForFeedback } from "@/lib/economic-action-feedback-service";

describe("economic action feedback service", () => {
  it.each([
    ["identity_not_connected", "Owner verification required", "error"],
    [
      "persistence_not_configured",
      "Evidence recording is unavailable",
      "warning",
    ],
    ["recorded", "Evidence recorded", "success"],
    ["replayed", "Evidence already recorded", "neutral"],
    ["held", "Evidence needs review", "warning"],
  ] as const)(
    "maps the fixed %s service outcome",
    async (status, title, tone) => {
      await expect(
        runEconomicActionForFeedback({
          operation: "manual_ledger",
          execute: async () => ({ status }),
        }),
      ).resolves.toMatchObject({
        title,
        tone,
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
    },
  );

  it("maps typed owner denial and durable conflict without inspecting messages", async () => {
    await expect(
      runEconomicActionForFeedback({
        operation: "core_sale",
        execute: async () => {
          throw new EconomicActionIdentityError("private owner detail");
        },
      }),
    ).resolves.toMatchObject({
      title: "Owner verification required",
      rawErrorEchoed: false,
    });

    await expect(
      runEconomicActionForFeedback({
        operation: "core_burn",
        execute: async () => {
          throw new EconomicActionConflictError("private conflict detail");
        },
      }),
    ).resolves.toMatchObject({
      title: "Conflicting durable evidence",
      rawErrorEchoed: false,
    });
  });

  it("collapses an unexpected exception to generic fail-closed feedback", async () => {
    const feedback = await runEconomicActionForFeedback({
      operation: "burn_bgc_credit",
      execute: async () => {
        throw new Error("private submitted value and provider exception");
      },
    });

    expect(feedback).toMatchObject({
      title: "Evidence was not recorded",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(JSON.stringify(feedback)).not.toContain("private submitted value");
    expect(JSON.stringify(feedback)).not.toContain("provider exception");
  });
});
