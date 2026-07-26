import { describe, expect, it, vi } from "vitest";

import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "@/lib/economic-form-action-service";

describe("economic FormData action service", () => {
  it("denies an unverified owner before capability or parser access", async () => {
    const parse = vi.fn(() => ({ value: "parsed" }));

    const result = await runEconomicFormAction({
      operation: "manual_ledger",
      authenticatedOwnerId: "other-owner",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: unavailableEconomicFormActionCapability,
      parse,
    });

    expect(result).toMatchObject({
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns unavailable before parsing when persistence is not configured", async () => {
    const parse = vi.fn(() => ({ value: "parsed" }));

    const result = await runEconomicFormAction({
      operation: "tournament_payout",
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: unavailableEconomicFormActionCapability,
      parse,
    });

    expect(result).toMatchObject({
      title: "Evidence recording is unavailable",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["recorded", "Evidence recorded"],
    ["replayed", "Evidence already recorded"],
    ["held", "Evidence needs review"],
  ] as const)(
    "parses only after owner verification and maps a %s result",
    async (status, title) => {
      const configuration = { asset: "DEZ" } as const;
      const parsed = { durableId: "server-generated-id" } as const;
      const parse = vi.fn(() => parsed);
      const execute = vi.fn(async () => ({ status }));
      const formData = new FormData();
      formData.set("amount", "private synthetic value");

      const result = await runEconomicFormAction({
        operation: "breeding_evidence",
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        formData,
        capability: {
          status: "ready",
          configuration,
          execute,
        },
        parse,
      });

      expect(parse).toHaveBeenCalledWith(formData, configuration);
      expect(execute).toHaveBeenCalledWith("owner-1", parsed);
      expect(result).toMatchObject({
        title,
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
      expect(JSON.stringify(result)).not.toContain("private synthetic value");
    },
  );

  it("collapses strict parser rejection to generic invalid-input feedback", async () => {
    const execute = vi.fn(async () => ({ status: "recorded" as const }));
    const formData = new FormData();
    formData.set("unknown_private_field", "private synthetic value");

    const result = await runEconomicFormAction({
      operation: "core_sale",
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData,
      capability: {
        status: "ready",
        configuration: Object.freeze({}),
        execute,
      },
      parse: () => {
        throw new Error("unknown_private_field: private synthetic value");
      },
    });

    expect(result).toMatchObject({
      title: "Review the submitted evidence",
      invalidFieldLabels: [],
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("unknown_private_field");
    expect(JSON.stringify(result)).not.toContain("private synthetic value");
  });

  it("redacts an unexpected connected-capability exception", async () => {
    const result = await runEconomicFormAction({
      operation: "burn_bgc_credit",
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: {
        status: "ready",
        configuration: Object.freeze({}),
        execute: async () => {
          throw new Error("private provider exception");
        },
      },
      parse: () => ({ durableId: "server-generated-id" }),
    });

    expect(result).toMatchObject({
      title: "Evidence was not recorded",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private provider exception");
  });
});
