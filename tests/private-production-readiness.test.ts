import { describe, expect, it } from "vitest";
import {
  assessPrivateProductionReadiness,
  type PrivateProductionReadinessInput,
} from "@/domain/private-production-readiness";

function input(
  overrides: Partial<PrivateProductionReadinessInput> = {},
): PrivateProductionReadinessInput {
  return {
    assessmentId: "private-readiness-2026-07-24",
    exactHeadSha: "c".repeat(40),
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
    ...overrides,
  };
}

describe("Phase 9 private Production readiness", () => {
  it("identifies a complete package ready for client-only Gate F review", () => {
    const readiness = assessPrivateProductionReadiness(input());

    expect(readiness.status).toBe("ready_for_gate_f_review");
    expect(readiness).toMatchObject({
      activationAuthorized: false,
      productionMutationAllowed: false,
      gateFStatus: "client_only",
    });
  });

  it("keeps unaccepted evidence gates review-required", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        gates: { ...input().gates, gateC: "not_accepted" },
      }),
    );

    expect(readiness.status).toBe("review_required");
    expect(
      readiness.checks.find((item) => item.code === "GATES_A_TO_E"),
    ).toMatchObject({ status: "review" });
  });

  it("blocks an explicitly failed evidence gate", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        gates: { ...input().gates, gateB: "blocked" },
      }),
    );
    expect(readiness.status).toBe("blocked");
  });

  it("keeps missing operational evidence review-required", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        representativePrivateImport: "not_run",
        performanceCapacity: "not_run",
        accessibilityResponsive: "not_run",
      }),
    );

    expect(readiness.status).toBe("review_required");
  });

  it("blocks failed CI, security or recovery evidence", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        exactHeadCi: "failed",
        recoveryValidation: "failed",
        securityPrivacy: "failed",
      }),
    );

    expect(readiness.status).toBe("blocked");
  });

  it("keeps unverified migrations and limitations review-required", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        migrations: "not_verified",
        knownLimitationsDocumented: false,
      }),
    );
    expect(readiness.status).toBe("review_required");
  });

  it("blocks irreversible migrations", () => {
    const readiness = assessPrivateProductionReadiness(
      input({ migrations: "irreversible" }),
    );
    expect(readiness.status).toBe("blocked");
  });

  it("requires Production to remain fully fail-closed", () => {
    const readiness = assessPrivateProductionReadiness(
      input({
        productionDisabled: false,
        customDomainAttached: true,
        publicRoutesExposed: true,
        fullPrivateDataInProduction: true,
        recurringPaidInfrastructureEnabled: true,
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(
      readiness.checks.find((item) => item.code === "PRODUCTION_FAIL_CLOSED"),
    ).toMatchObject({ status: "block" });
  });

  it("records owner approval without authorising activation", () => {
    const readiness = assessPrivateProductionReadiness(
      input({ ownerGateFApproval: true }),
    );

    expect(readiness.status).toBe("gate_f_approval_recorded");
    expect(readiness.activationAuthorized).toBe(false);
    expect(readiness.productionMutationAllowed).toBe(false);
  });

  it("blocks an activation request inside the assessment", () => {
    const readiness = assessPrivateProductionReadiness(
      input({ ownerGateFApproval: true, activationRequested: true }),
    );
    expect(readiness.status).toBe("blocked");
  });

  it("rejects a non-exact repository head", () => {
    expect(() =>
      assessPrivateProductionReadiness(input({ exactHeadSha: "main" })),
    ).toThrow(/40 hexadecimal/);
  });

  it("rejects unsupported runtime readiness states", () => {
    expect(() =>
      assessPrivateProductionReadiness(
        input({
          gates: {
            ...input().gates,
            gateC:
              "unsupported" as PrivateProductionReadinessInput["gates"]["gateC"],
          },
        }),
      ),
    ).toThrow(/Review-gate/);

    expect(() =>
      assessPrivateProductionReadiness(
        input({
          performanceCapacity:
            "unsupported" as PrivateProductionReadinessInput["performanceCapacity"],
        }),
      ),
    ).toThrow(/Operational/);

    expect(() =>
      assessPrivateProductionReadiness(
        input({
          migrations:
            "unsupported" as PrivateProductionReadinessInput["migrations"],
        }),
      ),
    ).toThrow(/Migration/);
  });
});
