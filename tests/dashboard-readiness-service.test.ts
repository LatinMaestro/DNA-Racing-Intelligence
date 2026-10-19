import { describe, expect, it, vi } from "vitest";

import type { PrivateProductionReadinessInput } from "@/domain/private-production-readiness";
import { loadDashboardReadinessPageState } from "@/lib/dashboard-readiness-service";
import { unavailableReadinessAssessmentRepository } from "@/lib/readiness-workspace-service";

const assessment: PrivateProductionReadinessInput = {
  assessmentId: "dashboard-readiness",
  assessmentVersion: "readiness-v1",
  assessedAt: "2026-10-18T00:30:00.000Z",
  evidenceCurrentThrough: "2026-10-18T00:00:00.000Z",
  evidenceFreshness: "current",
  exactHeadSha: "a".repeat(40),
  gates: {
    gateA: "accepted",
    gateB: "not_accepted",
    gateC: "not_accepted",
    gateD: "not_accepted",
    gateE: "not_accepted",
  },
  exactHeadCi: "passed",
  representativePrivateImport: "not_run",
  recoveryValidation: "passed",
  performanceCapacity: "not_run",
  securityPrivacy: "not_run",
  accessibilityResponsive: "not_run",
  moduleBoundaries: {
    dashboardReadiness: {
      aggregateReadModel: "connected_verified",
      freshnessUi: "fixture_verified",
    },
    vaultCoreSearch: {
      ownedCoreReadModel: "fixture_verified",
      exactFormatHistoryUi: "not_verified",
    },
    vaultPerformance: {
      readModel: "fixture_verified",
      economicEvidenceWrites: "not_verified",
    },
    openRace: {
      readModel: "failed",
      fieldLock: "not_verified",
      postLockObservation: "not_verified",
    },
    lifecycle: {
      readModel: "fixture_verified",
      economicEvidenceWrites: "not_verified",
    },
  },
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

const now = new Date("2026-10-18T01:00:00.000Z");
const snapshotSha256 = "b".repeat(64);

describe("Dashboard readiness service", () => {
  it("fails closed before a verified owner or configured repository", async () => {
    await expect(
      loadDashboardReadinessPageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
        expectedHeadSha: assessment.exactHeadSha,
        now,
      }),
    ).resolves.toMatchObject({ connectionStatus: "identity_not_connected" });
    await expect(
      loadDashboardReadinessPageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
        expectedHeadSha: assessment.exactHeadSha,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      readiness: null,
    });
  });

  it("denies a different owner before reading persistence", async () => {
    const loadLatestAssessmentByOwner = vi.fn();
    await expect(
      loadDashboardReadinessPageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadLatestAssessmentByOwner },
        expectedHeadSha: assessment.exactHeadSha,
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadLatestAssessmentByOwner).not.toHaveBeenCalled();
  });

  it("returns accepted exact-head readiness without enabling activation", async () => {
    await expect(
      loadDashboardReadinessPageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => ({
            assessment,
            acceptedAssessmentVersion: assessment.assessmentVersion,
            publishedAt: "2026-10-18T00:45:00.000Z",
            snapshotSha256,
          }),
        },
        expectedHeadSha: assessment.exactHeadSha,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "assessment_connected",
      exactHeadSha: assessment.exactHeadSha,
      assessmentId: assessment.assessmentId,
      assessmentVersion: assessment.assessmentVersion,
      assessmentSnapshotSha256: snapshotSha256,
      publishedAt: "2026-10-18T00:45:00.000Z",
      evidenceFreshness: "current",
      moduleBoundarySummary: {
        total: 23,
        notVerified: 17,
        fixtureVerified: 4,
        connectedVerified: 1,
        failed: 1,
      },
      readiness: {
        activationAuthorized: false,
        productionMutationAllowed: false,
      },
    });
  });

  it("keeps missing or invalid repository evidence explicit and private", async () => {
    const base = {
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      expectedHeadSha: assessment.exactHeadSha,
      now,
    } as const;
    await expect(
      loadDashboardReadinessPageState({
        ...base,
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => ({
            assessment: null,
            acceptedAssessmentVersion: null,
            publishedAt: null,
            snapshotSha256: null,
          }),
        },
      }),
    ).resolves.toMatchObject({ connectionStatus: "assessment_unavailable" });
    await expect(
      loadDashboardReadinessPageState({
        ...base,
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => {
            throw new Error("private provider detail");
          },
        },
      }),
    ).resolves.toEqual({
      connectionStatus: "assessment_read_failed",
      assessmentId: null,
      assessmentVersion: null,
      assessmentSnapshotSha256: null,
      exactHeadSha: null,
      publishedAt: null,
      evidenceCurrentThrough: null,
      evidenceFreshness: null,
      moduleBoundarySummary: null,
      readiness: null,
    });
    await expect(
      loadDashboardReadinessPageState({
        ...base,
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => ({
            assessment: {
              ...assessment,
              exactHeadSha: "not-an-exact-sha",
            },
            acceptedAssessmentVersion: assessment.assessmentVersion,
            publishedAt: "2026-10-18T00:45:00.000Z",
            snapshotSha256,
          }),
        },
      }),
    ).resolves.toEqual({
      connectionStatus: "assessment_integrity_failed",
      assessmentId: null,
      assessmentVersion: null,
      assessmentSnapshotSha256: null,
      exactHeadSha: null,
      publishedAt: null,
      evidenceCurrentThrough: null,
      evidenceFreshness: null,
      moduleBoundarySummary: null,
      readiness: null,
    });
  });
});
