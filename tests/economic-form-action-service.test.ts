import { describe, expect, it, vi } from "vitest";

import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "../lib/economic-form-action-service";

describe("economic FormData action service", () => {
  it("denies an unverified owner before capability or parser access", async () => {
    const parse = vi.fn(() => ({ value: "parsed" }));

    const action = await runEconomicFormAction({
      authenticatedOwnerId: "other-owner",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: unavailableEconomicFormActionCapability,
      parse,
    });

    expect(action).toMatchObject({
      status: "identity_not_connected",
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns unavailable before parsing when persistence is absent", async () => {
    const parse = vi.fn(() => ({ value: "parsed" }));

    const action = await runEconomicFormAction({
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: unavailableEconomicFormActionCapability,
      parse,
    });

    expect(action).toMatchObject({
      status: "persistence_not_configured",
      title: "Evidence recording is unavailable",
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["recorded", "Evidence recorded"],
    ["replayed", "Evidence already recorded"],
    ["held", "Evidence needs review"],
  ] as const)("maps a privacy-safe %s result", async (status, title) => {
    const formData = new FormData();
    formData.set("amount", "private synthetic value");
    const execute = vi.fn(async () => ({ status }));

    const action = await runEconomicFormAction({
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData,
      capability: {
        status: "ready",
        configuration: { registry: "reviewed" },
        execute,
      },
      parse: () => ({ durableId: "server-generated" }),
    });

    expect(action).toMatchObject({
      status,
      title,
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(JSON.stringify(action)).not.toContain("private synthetic value");
  });

  it("collapses parser rejection to generic invalid-input feedback", async () => {
    const execute = vi.fn(async () => ({ status: "recorded" as const }));
    const action = await runEconomicFormAction({
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      formData: new FormData(),
      capability: {
        status: "ready",
        configuration: Object.freeze({}),
        execute,
      },
      parse: () => {
        throw new Error("private submitted value");
      },
    });

    expect(action).toMatchObject({
      status: "invalid_input",
      title: "Review the submitted evidence",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(action)).not.toContain("private submitted value");
  });

  it("redacts an unexpected connected-persistence exception", async () => {
    const action = await runEconomicFormAction({
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
      parse: () => ({ durableId: "server-generated" }),
    });

    expect(action).toMatchObject({
      status: "failed",
      title: "Evidence was not recorded",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(JSON.stringify(action)).not.toContain("private provider exception");
  });
});
