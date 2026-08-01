import { describe, expect, it, vi } from "vitest";
import type { PrivateProductionReadinessInput } from "@/domain/private-production-readiness";
import {
  loadReadinessWorkspacePageState,
  unavailableReadinessAssessmentRepository,
} from "@/lib/readiness-workspace-service";

const assessment: PrivateProductionReadinessInput = {
  assessmentId: "synthetic-readiness",
  assessmentVersion: "readiness-v1",
  assessedAt: "2026-07-23T01:00:00.000Z",
  evidenceCurrentThrough: "2026-07-23T00:00:00.000Z",
  evidenceFreshness: "current",
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

const now = new Date("2026-07-26T00:00:00.000Z");
const expectedHeadSha = "a".repeat(40);

function repository(value: PrivateProductionReadinessInput | null) {
  return {
    status: "ready" as const,
    loadLatestAssessmentByOwner: async () => ({
      assessment: value,
      acceptedAssessmentVersion: value?.assessmentVersion ?? null,
      publishedAt: value === null ? null : "2026-07-23T02:00:00.000Z",
    }),
  };
}

describe("Readiness workspace service", () => {
  it("returns fail-closed connection states without reading evidence", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
        expectedHeadSha,
        now,
      }),
    ).resolves.toEqual({
      assessmentId: null,
      assessmentVersion: null,
      assessedAt: null,
      evidenceCurrentThrough: null,
      evidenceFreshness: null,
      exactHeadSha: null,
      readiness: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableReadinessAssessmentRepository,
        expectedHeadSha,
        now,
      }),
    ).resolves.toMatchObject({
      readiness: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadLatestAssessmentByOwner = vi.fn(
      repository(assessment).loadLatestAssessmentByOwner,
    );
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadLatestAssessmentByOwner },
        expectedHeadSha,
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadLatestAssessmentByOwner).not.toHaveBeenCalled();
  });

  it("reports exact-head blockers without authorizing activation", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(assessment),
        expectedHeadSha,
        now,
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
          ...repository(null),
        },
        expectedHeadSha,
        now,
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
          ...repository({
            ...assessment,
            exactHeadSha: "not-a-sha",
          }),
        },
        expectedHeadSha,
        now,
      }),
    ).rejects.toThrow("SHA");
  });

  it.each([
    ["3-day boundary", "2026-07-23T00:00:00.000Z", "current"],
    ["4-day boundary", "2026-07-22T00:00:00.000Z", "ageing"],
    ["7-day boundary", "2026-07-19T00:00:00.000Z", "ageing"],
    ["8-day boundary", "2026-07-18T00:00:00.000Z", "stale"],
  ] as const)(
    "derives freshness at the exact %s",
    async (_, cutoff, freshness) => {
      const staged = {
        ...assessment,
        assessedAt: "2026-07-25T00:00:00.000Z",
        evidenceCurrentThrough: cutoff,
        evidenceFreshness: freshness,
      };
      const state = await loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          ...repository(staged),
          loadLatestAssessmentByOwner: async () => ({
            assessment: staged,
            acceptedAssessmentVersion: staged.assessmentVersion,
            publishedAt: "2026-07-25T01:00:00.000Z",
          }),
        },
        expectedHeadSha,
        now,
      });
      expect(state.evidenceFreshness).toBe(freshness);
      expect(
        state.readiness?.checks.find(
          ({ code }) => code === "EVIDENCE_FRESHNESS",
        )?.status,
      ).toBe(freshness === "current" ? "pass" : "review");
    },
  );

  it("rejects a stale version and a different deployed head", async () => {
    const baseRepository = repository(assessment);
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          ...baseRepository,
          loadLatestAssessmentByOwner: async () => ({
            ...(await baseRepository.loadLatestAssessmentByOwner()),
            acceptedAssessmentVersion: "readiness-v2",
          }),
        },
        expectedHeadSha,
        now,
      }),
    ).rejects.toThrow("version is stale");
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(assessment),
        expectedHeadSha: "b".repeat(40),
        now,
      }),
    ).rejects.toThrow("deployed exact head");
  });

  it("rejects future, inconsistent and non-canonical evidence", async () => {
    for (const [staged, publishedAt] of [
      [
        { ...assessment, assessedAt: "2026-07-27T00:00:00.000Z" },
        "2026-07-27T01:00:00.000Z",
      ],
      [
        {
          ...assessment,
          evidenceCurrentThrough: "2026-07-23T00:00:00Z",
        },
        "2026-07-23T02:00:00.000Z",
      ],
      [
        {
          ...assessment,
          evidenceCurrentThrough: "2026-07-23T01:00:00.001Z",
        },
        "2026-07-23T00:30:00.000Z",
      ],
    ] as const) {
      await expect(
        loadReadinessWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            loadLatestAssessmentByOwner: async () => ({
              assessment: staged,
              acceptedAssessmentVersion: staged.assessmentVersion,
              publishedAt,
            }),
          },
          expectedHeadSha,
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects stored freshness drift and malformed repository evidence", async () => {
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository({
          ...assessment,
          evidenceFreshness: "stale",
        }),
        expectedHeadSha,
        now,
      }),
    ).rejects.toThrow("server-derived freshness");
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadLatestAssessmentByOwner: async () => null as never,
        },
        expectedHeadSha,
        now,
      }),
    ).rejects.toThrow("repository evidence is invalid");
  });
});
