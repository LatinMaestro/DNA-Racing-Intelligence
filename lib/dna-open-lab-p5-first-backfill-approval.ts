import type { DnaOpenLabP5ReadinessAssessment } from "@/lib/dna-open-lab-p5-readiness";
import { DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES } from "@/lib/dna-open-lab-p5-capacity-measurement";
import { DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT } from "@/lib/dna-open-lab-unresolved-identity-policy";

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_STOP_CONDITIONS = Object.freeze([
  "projected_cost_exceeds_authorized_maximum",
  "paid_provider_capacity_required",
  "provider_budget_would_be_exceeded",
  "neon_headroom_is_not_positive",
  "api_rate_eligibility_or_response_failure",
  "evidence_checkpoint_or_generation_validation_failure",
  "authority_or_plan_drift",
  "unresolved_source_identity_authority",
] as const);

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_CLEANUP_CONDITIONS = Object.freeze([
  "keep_serving_last_good_generation",
  "preserve_last_committed_checkpoint",
  "delete_incomplete_generation",
  "verify_temporary_r2_and_neon_residue_is_zero",
] as const);

export type DnaOpenLabP5FirstBackfillStopCondition =
  (typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_STOP_CONDITIONS)[number];

export type DnaOpenLabP5FirstBackfillCleanupCondition =
  (typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_CLEANUP_CONDITIONS)[number];

export type DnaOpenLabP5FirstBackfillMeasuredUpperBound = Readonly<{
  measurementBasis: "complete_inventory_upper_bound";
  exactMainCommit: string;
  measuredAt: string;
  authorityCutoffAt: string;
  priceAuthorityEffectiveAt: string;
  sourceRecordUpperBound: number;
  apiRequestUpperBound: number;
  retainedR2BytesUpperBound: number;
  classAOperationsUpperBound: number;
  classBOperationsUpperBound: number;
  neonCapacityLimitBytes: number;
  neonPeakBytesUpperBound: number;
  projectedCostMicroUsd: number;
  unresolvedIdentityObservationUpperBound: number;
  evidenceRefs: readonly string[];
}>;

export type DnaOpenLabP5FirstBackfillOwnerAuthorization = Readonly<{
  maximumAuthorizedMicroUsd: number;
  approvalRef: string;
}>;

export type DnaOpenLabP5FirstBackfillIdentityOmissionAuthority = Readonly<{
  measurementEvidenceSha256: string;
  maximumObservationCount: number;
}>;

export type DnaOpenLabP5FirstBackfillApprovalStatus =
  | "blocked_technical_evidence"
  | "blocked_measured_upper_bound"
  | "blocked_capacity"
  | "blocked_source_authority"
  | "ready_for_owner_decision"
  | "approved_for_first_private_preview_backfill";

export type DnaOpenLabP5FirstBackfillApprovalPacket = Readonly<{
  status: DnaOpenLabP5FirstBackfillApprovalStatus;
  technicalEvidenceComplete: boolean;
  measuredUpperBoundComplete: boolean;
  neonCapacityWithinLimit: boolean;
  sourceAuthorityComplete: boolean;
  readyForOwnerDecision: boolean;
  ownerApprovalRecorded: boolean;
  firstPersistentPrivatePreviewBackfillAllowed: boolean;
  productionChangesAllowed: false;
  measuredUpperBound: DnaOpenLabP5FirstBackfillMeasuredUpperBound | null;
  identityOmissionAuthority: DnaOpenLabP5FirstBackfillIdentityOmissionAuthority | null;
  ownerAuthorization: DnaOpenLabP5FirstBackfillOwnerAuthorization | null;
  stopConditions: readonly DnaOpenLabP5FirstBackfillStopCondition[];
  cleanupConditions: readonly DnaOpenLabP5FirstBackfillCleanupCondition[];
}>;

function approvalPacketError(message: string): never {
  throw new Error(`DNA Open Lab P5 first backfill approval: ${message}`);
}

function requirePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    approvalPacketError(`${field} must be a positive safe integer`);
  }
}

function requireNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    approvalPacketError(`${field} must be a non-negative safe integer`);
  }
}

function requireIsoTimestamp(value: string, field: string): void {
  if (value.trim().length < 1 || !Number.isFinite(Date.parse(value))) {
    approvalPacketError(`${field} must be an ISO timestamp`);
  }
}

function validateMeasuredUpperBound(
  value: DnaOpenLabP5FirstBackfillMeasuredUpperBound,
): DnaOpenLabP5FirstBackfillMeasuredUpperBound {
  if (value.measurementBasis !== "complete_inventory_upper_bound") {
    approvalPacketError("measurementBasis must cover the complete inventory");
  }
  if (!/^[a-f0-9]{40}$/.test(value.exactMainCommit)) {
    approvalPacketError("exactMainCommit must be a full lowercase Git commit");
  }
  requireIsoTimestamp(value.measuredAt, "measuredAt");
  requireIsoTimestamp(value.authorityCutoffAt, "authorityCutoffAt");
  requireIsoTimestamp(
    value.priceAuthorityEffectiveAt,
    "priceAuthorityEffectiveAt",
  );
  requirePositiveSafeInteger(
    value.sourceRecordUpperBound,
    "sourceRecordUpperBound",
  );
  requirePositiveSafeInteger(
    value.apiRequestUpperBound,
    "apiRequestUpperBound",
  );
  requirePositiveSafeInteger(
    value.retainedR2BytesUpperBound,
    "retainedR2BytesUpperBound",
  );
  requirePositiveSafeInteger(
    value.classAOperationsUpperBound,
    "classAOperationsUpperBound",
  );
  requirePositiveSafeInteger(
    value.classBOperationsUpperBound,
    "classBOperationsUpperBound",
  );
  requirePositiveSafeInteger(
    value.neonCapacityLimitBytes,
    "neonCapacityLimitBytes",
  );
  if (value.neonCapacityLimitBytes !== DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES) {
    approvalPacketError(
      "neonCapacityLimitBytes must match the approved capacity boundary",
    );
  }
  requirePositiveSafeInteger(
    value.neonPeakBytesUpperBound,
    "neonPeakBytesUpperBound",
  );
  requireNonNegativeSafeInteger(
    value.projectedCostMicroUsd,
    "projectedCostMicroUsd",
  );
  requireNonNegativeSafeInteger(
    value.unresolvedIdentityObservationUpperBound,
    "unresolvedIdentityObservationUpperBound",
  );
  if (
    value.evidenceRefs.length < 1 ||
    value.evidenceRefs.some((reference) => reference.trim().length < 1)
  ) {
    approvalPacketError(
      "measured upper bound requires sanitized evidence references",
    );
  }

  return Object.freeze({
    ...value,
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  });
}

/**
 * Builds the owner decision packet for the one-time persistent historical
 * Preview backfill. The packet deliberately cannot authorize Production and
 * cannot reuse synthetic capacity evidence or an unrelated historical census
 * in place of a measured complete API inventory upper bound.
 */
export function buildDnaOpenLabP5FirstBackfillApprovalPacket(input: {
  readiness: DnaOpenLabP5ReadinessAssessment;
  measuredUpperBound: DnaOpenLabP5FirstBackfillMeasuredUpperBound | null;
  identityOmissionAuthority?: DnaOpenLabP5FirstBackfillIdentityOmissionAuthority | null;
  ownerAuthorization: DnaOpenLabP5FirstBackfillOwnerAuthorization | null;
}): DnaOpenLabP5FirstBackfillApprovalPacket {
  if (
    input.readiness.ownerApprovalRecorded &&
    !input.readiness.technicalEvidenceComplete
  ) {
    approvalPacketError("owner approval cannot precede technical evidence");
  }
  if (
    input.readiness.firstPersistentPrivatePreviewSyncAllowed !==
    (input.readiness.technicalEvidenceComplete &&
      input.readiness.ownerApprovalRecorded)
  ) {
    approvalPacketError("readiness sync authority is inconsistent");
  }
  const measuredUpperBound = input.measuredUpperBound
    ? validateMeasuredUpperBound(input.measuredUpperBound)
    : null;
  const identityOmissionAuthority = input.identityOmissionAuthority ?? null;
  if (identityOmissionAuthority !== null) {
    if (
      !/^[a-f0-9]{64}$/u.test(
        identityOmissionAuthority.measurementEvidenceSha256,
      ) ||
      !Number.isSafeInteger(
        identityOmissionAuthority.maximumObservationCount,
      ) ||
      identityOmissionAuthority.maximumObservationCount < 1 ||
      identityOmissionAuthority.maximumObservationCount >
        DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT
    ) {
      approvalPacketError("identity omission authority is invalid");
    }
    if (!measuredUpperBound) {
      approvalPacketError(
        "identity omission authority cannot precede the measured upper bound",
      );
    }
    if (
      measuredUpperBound.unresolvedIdentityObservationUpperBound !==
        identityOmissionAuthority.maximumObservationCount ||
      !measuredUpperBound.evidenceRefs.some((reference) =>
        reference.includes(identityOmissionAuthority.measurementEvidenceSha256),
      )
    ) {
      approvalPacketError(
        "identity omission authority must match the exact measured count and evidence",
      );
    }
  }

  if (
    input.readiness.ownerApprovalRecorded !== Boolean(input.ownerAuthorization)
  ) {
    approvalPacketError(
      "readiness owner approval and the bounded owner authorization must agree",
    );
  }
  if (input.ownerAuthorization) {
    requireNonNegativeSafeInteger(
      input.ownerAuthorization.maximumAuthorizedMicroUsd,
      "maximumAuthorizedMicroUsd",
    );
    if (input.ownerAuthorization.approvalRef.trim().length < 1) {
      approvalPacketError("approvalRef is required");
    }
    if (!measuredUpperBound) {
      approvalPacketError(
        "owner authorization cannot precede the measured upper bound",
      );
    }
    if (
      input.ownerAuthorization.maximumAuthorizedMicroUsd <
      measuredUpperBound.projectedCostMicroUsd
    ) {
      approvalPacketError(
        "maximumAuthorizedMicroUsd must cover the projected upper-bound cost",
      );
    }
  }

  const technicalEvidenceComplete = input.readiness.technicalEvidenceComplete;
  const measuredUpperBoundComplete = measuredUpperBound !== null;
  const neonCapacityWithinLimit =
    measuredUpperBound !== null &&
    measuredUpperBound.neonPeakBytesUpperBound <
      measuredUpperBound.neonCapacityLimitBytes;
  const sourceAuthorityComplete =
    measuredUpperBound !== null &&
    (measuredUpperBound.unresolvedIdentityObservationUpperBound === 0 ||
      identityOmissionAuthority !== null);
  const readyForOwnerDecision =
    technicalEvidenceComplete &&
    measuredUpperBoundComplete &&
    neonCapacityWithinLimit &&
    sourceAuthorityComplete;
  const ownerApprovalRecorded = input.ownerAuthorization !== null;
  if (ownerApprovalRecorded && !neonCapacityWithinLimit) {
    approvalPacketError(
      "owner authorization cannot override non-positive Neon headroom",
    );
  }
  if (ownerApprovalRecorded && !sourceAuthorityComplete) {
    approvalPacketError(
      "owner authorization cannot override unresolved source identity authority",
    );
  }
  const firstPersistentPrivatePreviewBackfillAllowed =
    readyForOwnerDecision &&
    ownerApprovalRecorded &&
    input.readiness.firstPersistentPrivatePreviewSyncAllowed;

  let status: DnaOpenLabP5FirstBackfillApprovalStatus;
  if (!technicalEvidenceComplete) {
    status = "blocked_technical_evidence";
  } else if (!measuredUpperBoundComplete) {
    status = "blocked_measured_upper_bound";
  } else if (!neonCapacityWithinLimit) {
    status = "blocked_capacity";
  } else if (!sourceAuthorityComplete) {
    status = "blocked_source_authority";
  } else if (!ownerApprovalRecorded) {
    status = "ready_for_owner_decision";
  } else {
    status = "approved_for_first_private_preview_backfill";
  }

  return Object.freeze({
    status,
    technicalEvidenceComplete,
    measuredUpperBoundComplete,
    neonCapacityWithinLimit,
    sourceAuthorityComplete,
    readyForOwnerDecision,
    ownerApprovalRecorded,
    firstPersistentPrivatePreviewBackfillAllowed,
    productionChangesAllowed: false,
    measuredUpperBound,
    identityOmissionAuthority,
    ownerAuthorization: input.ownerAuthorization
      ? Object.freeze({ ...input.ownerAuthorization })
      : null,
    stopConditions: DNA_OPEN_LAB_P5_FIRST_BACKFILL_STOP_CONDITIONS,
    cleanupConditions: DNA_OPEN_LAB_P5_FIRST_BACKFILL_CLEANUP_CONDITIONS,
  });
}
