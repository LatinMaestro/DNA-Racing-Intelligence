import { describe, expect, it } from "vitest";

import {
  assessDnaOpenLabP5Readiness,
  DNA_OPEN_LAB_CURRENT_P5_READINESS,
  DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
  DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS,
  type DnaOpenLabP5ReadinessEvidence,
} from "@/lib/dna-open-lab-p5-readiness";

describe("DNA Open Lab P5 readiness", () => {
  it("keeps the current first-real-sync gate closed", () => {
    expect(DNA_OPEN_LAB_CURRENT_P5_READINESS).toEqual({
      technicalEvidenceComplete: false,
      readyForOwnerApproval: false,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
      blockingRequirementIds: DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS,
    });
  });

  it("does not treat local recovery implementation as connected P5 evidence", () => {
    expect(
      DNA_OPEN_LAB_P5_READINESS_EVIDENCE.filter(
        (entry) => entry.status === "local_evidence_only",
      ).map((entry) => entry.requirementId),
    ).toEqual([
      "restart_replay_idempotency",
      "partial_failure_rate_limit_recovery",
      "tier_loss_reinstatement_catch_up",
      "stale_cached_site_operation",
    ]);
    expect(
      DNA_OPEN_LAB_P5_READINESS_EVIDENCE.filter(
        (entry) => entry.status === "pending_measurement",
      ).map((entry) => entry.requirementId),
    ).toEqual([
      "postgres_18_physical_peak_storage",
      "private_r2_footprint_cost",
      "positive_neon_headroom",
    ]);
  });

  it("still requires explicit approval after every technical requirement passes", () => {
    const satisfied = DNA_OPEN_LAB_P5_READINESS_EVIDENCE.map((entry) => ({
      ...entry,
      status: "satisfied" as const,
      evidenceRefs:
        entry.evidenceRefs.length > 0
          ? entry.evidenceRefs
          : Object.freeze([`evidence/${entry.requirementId}.json`]),
    }));

    expect(
      assessDnaOpenLabP5Readiness({
        evidence: satisfied,
        ownerApprovalRecorded: false,
      }),
    ).toMatchObject({
      technicalEvidenceComplete: true,
      readyForOwnerApproval: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(
      assessDnaOpenLabP5Readiness({
        evidence: satisfied,
        ownerApprovalRecorded: true,
      }),
    ).toMatchObject({
      firstPersistentPrivatePreviewSyncAllowed: true,
      productionChangesAllowed: false,
    });
  });

  it("rejects approval recorded before technical evidence is complete", () => {
    expect(() =>
      assessDnaOpenLabP5Readiness({
        evidence: DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
        ownerApprovalRecorded: true,
      }),
    ).toThrow("owner approval cannot precede complete technical evidence");
  });

  it("rejects incomplete, duplicate and unsupported evidence matrices", () => {
    expect(() =>
      assessDnaOpenLabP5Readiness({
        evidence: [],
        ownerApprovalRecorded: false,
      }),
    ).toThrow("missing requirements");

    expect(() =>
      assessDnaOpenLabP5Readiness({
        evidence: [
          ...DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
          DNA_OPEN_LAB_P5_READINESS_EVIDENCE[0]!,
        ],
        ownerApprovalRecorded: false,
      }),
    ).toThrow("duplicate requirement restart_replay_idempotency");

    const unsupported = {
      ...DNA_OPEN_LAB_P5_READINESS_EVIDENCE[0]!,
      requirementId: "production_deployment",
    } as unknown as DnaOpenLabP5ReadinessEvidence;
    expect(() =>
      assessDnaOpenLabP5Readiness({
        evidence: [unsupported, ...DNA_OPEN_LAB_P5_READINESS_EVIDENCE.slice(1)],
        ownerApprovalRecorded: false,
      }),
    ).toThrow("unsupported requirement production_deployment");
  });
});
