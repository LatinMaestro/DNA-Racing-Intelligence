import { describe, expect, it } from "vitest";

import {
  assessDnaOpenLabP5Readiness,
  DNA_OPEN_LAB_CURRENT_P5_READINESS,
  DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
  type DnaOpenLabP5ReadinessEvidence,
} from "@/lib/dna-open-lab-p5-readiness";

describe("DNA Open Lab P5 readiness", () => {
  it("keeps the current first-real-sync gate closed", () => {
    expect(DNA_OPEN_LAB_CURRENT_P5_READINESS).toEqual({
      technicalEvidenceComplete: true,
      readyForOwnerApproval: true,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
      blockingRequirementIds: [],
    });
  });

  it("binds all connected recovery requirements to the exact-main suite", () => {
    expect(
      DNA_OPEN_LAB_P5_READINESS_EVIDENCE.filter(
        (entry) => entry.status === "local_evidence_only",
      ).map((entry) => entry.requirementId),
    ).toEqual([]);
    expect(
      DNA_OPEN_LAB_P5_READINESS_EVIDENCE.filter(
        (entry) => entry.status === "pending_measurement",
      ).map((entry) => entry.requirementId),
    ).toEqual([]);
    const satisfied = DNA_OPEN_LAB_P5_READINESS_EVIDENCE.filter(
      (entry) => entry.status === "satisfied",
    );
    expect(satisfied.map((entry) => entry.requirementId)).toEqual([
      "restart_replay_idempotency",
      "partial_failure_rate_limit_recovery",
      "tier_loss_reinstatement_catch_up",
      "stale_cached_site_operation",
      "postgres_18_physical_peak_storage",
      "private_r2_footprint_cost",
      "positive_neon_headroom",
    ]);
    for (const entry of satisfied.slice(0, 4)) {
      expect(entry.evidenceRefs).toContain(
        "https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33467686923",
      );
      expect(entry.evidenceRefs).toContain(
        "github-actions:artifact/9785468669#sha256:4bdcb895a49211b168ea85e147a570ab07fbc14bba4715854411812b5e751ce0",
      );
    }
    for (const entry of satisfied.slice(4)) {
      expect(entry.evidenceRefs).toContain(
        "https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33227770750",
      );
      expect(entry.evidenceRefs).toContain(
        "github-actions:artifact/9707453042#sha256:3c9b47aff03ee63554eabf249304fd2f9009c7075c3ba407149ee3dac36823b9",
      );
    }
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
    const incomplete = DNA_OPEN_LAB_P5_READINESS_EVIDENCE.map((entry, index) =>
      index === 0
        ? { ...entry, status: "local_evidence_only" as const }
        : entry,
    );
    expect(() =>
      assessDnaOpenLabP5Readiness({
        evidence: incomplete,
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
