import { describe, expect, it, vi } from "vitest";
import type { PrivateProductionReadinessInput } from "@/domain/private-production-readiness";
import {
  loadReadinessWorkspacePageState,
  unavailableReadinessAssessmentRepository,
} from "@/lib/readiness-workspace-service";

const assessment: PrivateProductionReadinessInput = {
  assessmentId: "synthetic-readiness",
  exactHeadSha: "a".repeat(40),
  gates: {
    gateA: "accepted",
    gateB: "not_accepted",
    gateC: "not_accepted",
    gateD: "not_accepted",
    gateE: "not_accepted",
  },
  exactHeadCi: "not_run",
  representativePrivateImport: "not_run",
  recoveryValidation: "passed",
  performanceCapacity: "not_run",
  securityPrivacy: "not_run",
  accessibilityResponsive: "not_run",
  migrations: "not_verified",
  knownLimitationsDocumented: true,
  productionDisabled: true,
  customDomainAttached: false,
  publicRoutesExposed: false,
  fullPrivateDataInProduction: false,
  recurringPaidInfrastructureEnabled: false,
  ownerGateFApproval: false,
  activationRequested: false,
};

describe("Readiness workspace service", () => {
  it("returns fail-closed connection states without reading evidence", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
      }),
    ).resolves.toEqual({
      assessmentId: null,
      exactHeadSha: null,
      readiness: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
      }),
    ).resolves.toMatchObject({
      readiness: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadLatestAssessmentByOwner = vi.fn(async () => assessment);
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadLatestAssessmentByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(loadLatestAssessmentByOwner).not.toHaveBeenCalled();
  });

  it("reports exact-head blockers without authorizing activation", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return assessment;
          },
        },
      }),
    ).resolves.toMatchObject({
      assessmentId: "synthetic-readiness",
      exactHeadSha: "a".repeat(40),
      connectionStatus: "read_model_connected",
      readiness: {
        status: "review_required",
        activationAuthorized: false,
        productionMutationAllowed: false,
        gateFStatus: "client_only",
      },
    });
  });

  it("accepts an empty repository and rejects malformed assessment evidence", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => null,
        },
      }),
    ).resolves.toMatchObject({
      readiness: null,
      connectionStatus: "read_model_connected",
    });

    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => ({
            ...assessment,
            exactHeadSha: "not-a-sha",
          }),
        },
      }),
    ).rejects.toThrow("SHA");
  });
});
