import { describe, expect, it } from "vitest";

import {
  buildDnaOpenLabP5FirstBackfillApprovalPacket,
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_CLEANUP_CONDITIONS,
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_STOP_CONDITIONS,
  type DnaOpenLabP5FirstBackfillMeasuredUpperBound,
} from "@/lib/dna-open-lab-p5-first-backfill-approval";
import {
  assessDnaOpenLabP5Readiness,
  DNA_OPEN_LAB_CURRENT_P5_READINESS,
  DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
} from "@/lib/dna-open-lab-p5-readiness";

const measuredUpperBound: DnaOpenLabP5FirstBackfillMeasuredUpperBound = {
  measurementBasis: "complete_inventory_upper_bound",
  exactMainCommit: "0123456789abcdef0123456789abcdef01234567",
  measuredAt: "2026-09-01T00:00:00.000Z",
  authorityCutoffAt: "2026-08-31T23:59:59.999Z",
  priceAuthorityEffectiveAt: "2026-08-07T00:00:00.000Z",
  sourceRecordUpperBound: 650_000,
  apiRequestUpperBound: 6_500,
  retainedR2BytesUpperBound: 2_000_000_000,
  classAOperationsUpperBound: 6_500,
  classBOperationsUpperBound: 13_000,
  neonCapacityLimitBytes: 536_870_912,
  neonPeakBytesUpperBound: 400_000_000,
  projectedCostMicroUsd: 50_000,
  unresolvedIdentityObservationUpperBound: 0,
  evidenceRefs: Object.freeze(["evidence/sanitized-upper-bound.json"]),
};

const satisfiedReadiness = (ownerApprovalRecorded: boolean) =>
  assessDnaOpenLabP5Readiness({
    evidence: DNA_OPEN_LAB_P5_READINESS_EVIDENCE.map((entry) => ({
      ...entry,
      status: "satisfied" as const,
      evidenceRefs:
        entry.evidenceRefs.length > 0
          ? entry.evidenceRefs
          : Object.freeze([`evidence/${entry.requirementId}.json`]),
    })),
    ownerApprovalRecorded,
  });

describe("DNA Open Lab P5 first historical backfill approval", () => {
  it("keeps the current packet blocked on the measured inventory upper bound", () => {
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: DNA_OPEN_LAB_CURRENT_P5_READINESS,
        measuredUpperBound: null,
        ownerAuthorization: null,
      }),
    ).toEqual({
      status: "blocked_measured_upper_bound",
      technicalEvidenceComplete: true,
      measuredUpperBoundComplete: false,
      neonCapacityWithinLimit: false,
      sourceAuthorityComplete: false,
      readyForOwnerDecision: false,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
      measuredUpperBound: null,
      identityOmissionAuthority: null,
      ownerAuthorization: null,
      stopConditions: DNA_OPEN_LAB_P5_FIRST_BACKFILL_STOP_CONDITIONS,
      cleanupConditions: DNA_OPEN_LAB_P5_FIRST_BACKFILL_CLEANUP_CONDITIONS,
    });
  });

  it("requires a measured complete inventory upper bound after technical evidence", () => {
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: null,
        ownerAuthorization: null,
      }),
    ).toMatchObject({
      status: "blocked_measured_upper_bound",
      readyForOwnerDecision: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
    });
  });

  it("becomes decision-ready without authorizing a write", () => {
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound,
        ownerAuthorization: null,
      }),
    ).toMatchObject({
      status: "ready_for_owner_decision",
      measuredUpperBoundComplete: true,
      neonCapacityWithinLimit: true,
      sourceAuthorityComplete: true,
      readyForOwnerDecision: true,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("emits a measured packet but blocks persistence when Neon headroom is not positive", () => {
    const overCapacity = {
      ...measuredUpperBound,
      neonPeakBytesUpperBound: measuredUpperBound.neonCapacityLimitBytes,
    };
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: overCapacity,
        ownerAuthorization: null,
      }),
    ).toMatchObject({
      status: "blocked_capacity",
      measuredUpperBoundComplete: true,
      neonCapacityWithinLimit: false,
      readyForOwnerDecision: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
    });

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(true),
        measuredUpperBound: overCapacity,
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 50_000,
          approvalRef: "owner-approval:test",
        },
      }),
    ).toThrow("cannot override non-positive Neon headroom");
  });

  it("keeps P5 closed until exact measured de minimis omission authority is bound", () => {
    const measurementEvidenceSha256 = "a".repeat(64);
    const conflicted = {
      ...measuredUpperBound,
      unresolvedIdentityObservationUpperBound: 1,
      evidenceRefs: Object.freeze([`sha256:${measurementEvidenceSha256}`]),
    };
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: conflicted,
        ownerAuthorization: null,
      }),
    ).toMatchObject({
      status: "blocked_source_authority",
      measuredUpperBoundComplete: true,
      sourceAuthorityComplete: false,
      readyForOwnerDecision: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
    });

    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: conflicted,
        identityOmissionAuthority: {
          measurementEvidenceSha256,
          maximumObservationCount: 1,
        },
        ownerAuthorization: null,
      }),
    ).toMatchObject({
      status: "ready_for_owner_decision",
      sourceAuthorityComplete: true,
      readyForOwnerDecision: true,
      identityOmissionAuthority: {
        measurementEvidenceSha256,
        maximumObservationCount: 1,
      },
    });

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(true),
        measuredUpperBound: conflicted,
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 50_000,
          approvalRef: "owner-approval:test",
        },
      }),
    ).toThrow("cannot override unresolved source identity authority");

    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(true),
        measuredUpperBound: conflicted,
        identityOmissionAuthority: {
          measurementEvidenceSha256,
          maximumObservationCount: 1,
        },
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 50_000,
          approvalRef: "owner-approval:exact-bounded-preview",
        },
      }),
    ).toMatchObject({
      status: "approved_for_first_private_preview_backfill",
      firstPersistentPrivatePreviewBackfillAllowed: true,
      sourceAuthorityComplete: true,
    });
  });

  it("rejects omission authority that exceeds or drifts from exact measurement evidence", () => {
    const measurementEvidenceSha256 = "a".repeat(64);
    const conflicted = {
      ...measuredUpperBound,
      unresolvedIdentityObservationUpperBound: 1,
      evidenceRefs: Object.freeze([`sha256:${measurementEvidenceSha256}`]),
    };

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: conflicted,
        identityOmissionAuthority: {
          measurementEvidenceSha256,
          maximumObservationCount: 26,
        },
        ownerAuthorization: null,
      }),
    ).toThrow("identity omission authority is invalid");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: conflicted,
        identityOmissionAuthority: {
          measurementEvidenceSha256: "b".repeat(64),
          maximumObservationCount: 1,
        },
        ownerAuthorization: null,
      }),
    ).toThrow("must match the exact measured count and evidence");
  });

  it("allows only the first private Preview backfill after bounded approval", () => {
    expect(
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(true),
        measuredUpperBound,
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 50_000,
          approvalRef: "owner-approval:issue-120-comment-redacted",
        },
      }),
    ).toMatchObject({
      status: "approved_for_first_private_preview_backfill",
      ownerApprovalRecorded: true,
      firstPersistentPrivatePreviewBackfillAllowed: true,
      productionChangesAllowed: false,
    });
  });

  it("makes exact-main measurement 33574168582 ready for the bounded owner decision", () => {
    const measurementEvidenceSha256 =
      "250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4";
    const packet = buildDnaOpenLabP5FirstBackfillApprovalPacket({
      readiness: satisfiedReadiness(false),
      measuredUpperBound: {
        measurementBasis: "complete_inventory_upper_bound",
        exactMainCommit: "9fc47d6b1ba95287349cbd18023254058dd744e0",
        measuredAt: "2026-09-02T02:09:19.270Z",
        authorityCutoffAt: "2026-09-02T00:11:55.961Z",
        priceAuthorityEffectiveAt: "2026-08-07T00:00:00.000Z",
        sourceRecordUpperBound: 1_136_911,
        apiRequestUpperBound: 34_906,
        retainedR2BytesUpperBound: 1_151_071_826,
        classAOperationsUpperBound: 34_952,
        classBOperationsUpperBound: 104_718,
        neonCapacityLimitBytes: 536_870_912,
        neonPeakBytesUpperBound: 489_717_760,
        projectedCostMicroUsd: 212_250,
        unresolvedIdentityObservationUpperBound: 1,
        evidenceRefs: Object.freeze([
          `github-actions:33574168582#sha256:${measurementEvidenceSha256}`,
        ]),
      },
      identityOmissionAuthority: {
        measurementEvidenceSha256,
        maximumObservationCount: 1,
      },
      ownerAuthorization: null,
    });

    expect(packet).toMatchObject({
      status: "ready_for_owner_decision",
      neonCapacityWithinLimit: true,
      sourceAuthorityComplete: true,
      readyForOwnerDecision: true,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
    });
  });

  it("rejects approval without matching readiness or sufficient cost authority", () => {
    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound,
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 50_000,
          approvalRef: "owner-approval:test",
        },
      }),
    ).toThrow(
      "readiness owner approval and the bounded owner authorization must agree",
    );

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(true),
        measuredUpperBound,
        ownerAuthorization: {
          maximumAuthorizedMicroUsd: 49_999,
          approvalRef: "owner-approval:test",
        },
      }),
    ).toThrow("must cover the projected upper-bound cost");
  });

  it("rejects synthetic, partial or unsourced measurements", () => {
    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: {
          ...measuredUpperBound,
          measurementBasis: "synthetic_capacity" as never,
        },
        ownerAuthorization: null,
      }),
    ).toThrow("measurementBasis must cover the complete inventory");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: { ...measuredUpperBound, evidenceRefs: [] },
        ownerAuthorization: null,
      }),
    ).toThrow("requires sanitized evidence references");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillApprovalPacket({
        readiness: satisfiedReadiness(false),
        measuredUpperBound: {
          ...measuredUpperBound,
          neonCapacityLimitBytes: 1_000_000_000,
        },
        ownerAuthorization: null,
      }),
    ).toThrow("must match the approved capacity boundary");
  });
});
