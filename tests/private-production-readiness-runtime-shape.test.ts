import { describe, expect, it } from "vitest";

import {
  assessPrivateProductionReadiness,
  type PrivateProductionReadinessInput,
} from "../domain/private-production-readiness";

function evidence(): PrivateProductionReadinessInput {
  return {
    assessmentId: "synthetic-runtime-shape",
    exactHeadSha: "a".repeat(40),
    gates: {
      gateA: "accepted",
      gateB: "accepted",
      gateC: "accepted",
      gateD: "accepted",
      gateE: "accepted",
    },
    exactHeadCi: "passed",
    representativePrivateImport: "passed",
    recoveryValidation: "passed",
    performanceCapacity: "passed",
    securityPrivacy: "passed",
    accessibilityResponsive: "passed",
    migrations: "reversible_verified",
    knownLimitationsDocumented: true,
    productionDisabled: true,
    customDomainAttached: false,
    publicRoutesExposed: false,
    fullPrivateDataInProduction: false,
    recurringPaidInfrastructureEnabled: false,
    ownerGateFApproval: false,
    activationRequested: false,
  };
}

describe("private Production readiness runtime shape", () => {
  it("rejects malformed boolean evidence instead of coercing strings", () => {
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        productionDisabled: "false" as unknown as boolean,
      }),
    ).toThrow("boolean evidence");
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        activationRequested: "false" as unknown as boolean,
      }),
    ).toThrow("boolean evidence");
  });

  it("rejects missing gate objects with a controlled error", () => {
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        gates: null as unknown as PrivateProductionReadinessInput["gates"],
      }),
    ).toThrow("Review-gate");
  });

  it("rejects unsupported operational and migration states", () => {
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        performanceCapacity:
          "unsupported" as PrivateProductionReadinessInput["performanceCapacity"],
      }),
    ).toThrow("Operational");
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        migrations:
          "unsupported" as PrivateProductionReadinessInput["migrations"],
      }),
    ).toThrow("Migration");
  });

  it("rejects non-string assessment identity evidence", () => {
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        assessmentId: 42 as unknown as string,
      }),
    ).toThrow("Assessment ID");
    expect(() =>
      assessPrivateProductionReadiness({
        ...evidence(),
        exactHeadSha: 42 as unknown as string,
      }),
    ).toThrow("Exact-head SHA");
  });
});
