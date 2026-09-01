import { createHash } from "node:crypto";

import {
  buildDnaOpenLabP5FirstBackfillMeasurementReport,
  type DnaOpenLabP5FirstBackfillFamilyMeasurement,
  type DnaOpenLabP5FirstBackfillMeasurementInput,
} from "./dna-open-lab-p5-first-backfill-measurement";

const SHA_1_PATTERN = /^[0-9a-f]{40}$/u;
const MAXIMUM_EVIDENCE_BYTES = 32_768;

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY =
  "bounded_non_persistent_complete_inventory" as const;

export type DnaOpenLabP5SanitizedFirstBackfillFamilyEvidence = Readonly<
  Omit<DnaOpenLabP5FirstBackfillFamilyMeasurement, "evidenceRef"> & {
    evidenceRefSha256: string;
  }
>;

export type DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence = Readonly<{
  schemaVersion: 3;
  evidenceKind: "dna_open_lab_p5_first_backfill_measurement";
  evidenceSha256: string;
  exactMainCommit: string;
  acquisitionPlanChecksum: string;
  measuredAt: string;
  authorityCutoffAt: string;
  connectedRecoverySuiteRunRefSha256: string;
  pricingAuthorityRefSha256: string;
  families: readonly DnaOpenLabP5SanitizedFirstBackfillFamilyEvidence[];
  r2CostMicroUsdUpperBound: number;
  dnaApiCostMicroUsdUpperBound: number;
  neonCostMicroUsdUpperBound: number;
  measuredUpperBound: Readonly<
    Omit<
      ReturnType<
        typeof buildDnaOpenLabP5FirstBackfillMeasurementReport
      >["measuredUpperBound"],
      "evidenceRefs"
    >
  >;
  sourceAuthorityComplete: boolean;
  unresolvedIdentityDisposition: ReturnType<
    typeof buildDnaOpenLabP5FirstBackfillMeasurementReport
  >["unresolvedIdentityDisposition"];
  ownerAuthorizedDeMinimisIdentityOmissionLimit: number;
  unresolvedIdentityCriticalNotificationThreshold: number;
  persistentOwnerDataWriteCount: 0;
  temporaryProviderResidueCount: 0;
  ownerApprovalRecorded: false;
  firstPersistentPrivatePreviewBackfillAllowed: false;
  productionChangesAllowed: false;
}>;

export type DnaOpenLabP5FirstBackfillMeasurementInvocationInput = Readonly<{
  authority: typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY;
  expectedCodeHeadSha: string;
  measurement: DnaOpenLabP5FirstBackfillMeasurementInput;
  emitEvidence: (canonicalJson: string) => Promise<void>;
}>;

function invocationError(): never {
  throw new Error(
    "DNA Open Lab P5 first backfill measurement invocation failed.",
  );
}

function exactHeadSha(value: string): string {
  const normalized = value.trim();
  if (!SHA_1_PATTERN.test(normalized)) invocationError();
  return normalized;
}

function authoritySha256(domain: string, value: string): string {
  return createHash("sha256")
    .update(`${domain}\u0000${value}`, "utf8")
    .digest("hex");
}

function sanitizeFamily(
  family: DnaOpenLabP5FirstBackfillFamilyMeasurement,
): DnaOpenLabP5SanitizedFirstBackfillFamilyEvidence {
  const { evidenceRef, ...safeFamily } = family;
  return Object.freeze({
    ...safeFamily,
    evidenceRefSha256: authoritySha256(
      `dna-open-lab-p5-first-backfill-family:${family.family}`,
      evidenceRef,
    ),
  });
}

/**
 * Exact-main connected measurement boundary. Only aggregate counts, bounds and
 * hash-addressed authority references may cross into an Actions artifact.
 */
export async function invokeDnaOpenLabP5FirstBackfillMeasurement(
  input: DnaOpenLabP5FirstBackfillMeasurementInvocationInput,
): Promise<DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence> {
  let expectedCodeHeadSha: string;
  try {
    if (
      input.authority !==
      DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY
    ) {
      invocationError();
    }
    expectedCodeHeadSha = exactHeadSha(input.expectedCodeHeadSha);
    if (
      exactHeadSha(input.measurement.exactMainCommit) !== expectedCodeHeadSha ||
      typeof input.emitEvidence !== "function"
    ) {
      invocationError();
    }
  } catch {
    return invocationError();
  }

  let evidence: DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence;
  try {
    const report = buildDnaOpenLabP5FirstBackfillMeasurementReport(
      input.measurement,
    );
    const safeMeasuredUpperBound = Object.freeze({
      measurementBasis: report.measuredUpperBound.measurementBasis,
      exactMainCommit: report.measuredUpperBound.exactMainCommit,
      measuredAt: report.measuredUpperBound.measuredAt,
      authorityCutoffAt: report.measuredUpperBound.authorityCutoffAt,
      priceAuthorityEffectiveAt:
        report.measuredUpperBound.priceAuthorityEffectiveAt,
      sourceRecordUpperBound: report.measuredUpperBound.sourceRecordUpperBound,
      apiRequestUpperBound: report.measuredUpperBound.apiRequestUpperBound,
      retainedR2BytesUpperBound:
        report.measuredUpperBound.retainedR2BytesUpperBound,
      classAOperationsUpperBound:
        report.measuredUpperBound.classAOperationsUpperBound,
      classBOperationsUpperBound:
        report.measuredUpperBound.classBOperationsUpperBound,
      neonPeakBytesUpperBound:
        report.measuredUpperBound.neonPeakBytesUpperBound,
      projectedCostMicroUsd: report.measuredUpperBound.projectedCostMicroUsd,
      unresolvedIdentityObservationUpperBound:
        report.measuredUpperBound.unresolvedIdentityObservationUpperBound,
    });
    const evidenceWithoutChecksum = Object.freeze({
      schemaVersion: 3 as const,
      evidenceKind: "dna_open_lab_p5_first_backfill_measurement" as const,
      exactMainCommit: report.exactMainCommit,
      acquisitionPlanChecksum: report.acquisitionPlanChecksum,
      measuredAt: report.measuredUpperBound.measuredAt,
      authorityCutoffAt: report.measuredUpperBound.authorityCutoffAt,
      connectedRecoverySuiteRunRefSha256: authoritySha256(
        "dna-open-lab-p5-connected-recovery-run",
        input.measurement.connectedRecoverySuite.runRef,
      ),
      pricingAuthorityRefSha256: authoritySha256(
        "dna-open-lab-p5-first-backfill-price-authority",
        input.measurement.pricing.authorityRef,
      ),
      families: Object.freeze(input.measurement.families.map(sanitizeFamily)),
      r2CostMicroUsdUpperBound: report.r2CostMicroUsdUpperBound,
      dnaApiCostMicroUsdUpperBound: report.dnaApiCostMicroUsdUpperBound,
      neonCostMicroUsdUpperBound: report.neonCostMicroUsdUpperBound,
      measuredUpperBound: Object.freeze(safeMeasuredUpperBound),
      sourceAuthorityComplete: report.sourceAuthorityComplete,
      unresolvedIdentityDisposition: report.unresolvedIdentityDisposition,
      ownerAuthorizedDeMinimisIdentityOmissionLimit:
        report.ownerAuthorizedDeMinimisIdentityOmissionLimit,
      unresolvedIdentityCriticalNotificationThreshold:
        report.unresolvedIdentityCriticalNotificationThreshold,
      persistentOwnerDataWriteCount: 0 as const,
      temporaryProviderResidueCount: 0 as const,
      ownerApprovalRecorded: false as const,
      firstPersistentPrivatePreviewBackfillAllowed: false as const,
      productionChangesAllowed: false as const,
    });
    evidence = Object.freeze({
      ...evidenceWithoutChecksum,
      evidenceSha256: createHash("sha256")
        .update(JSON.stringify(evidenceWithoutChecksum), "utf8")
        .digest("hex"),
    });
  } catch {
    return invocationError();
  }

  const canonicalJson = JSON.stringify(evidence);
  if (Buffer.byteLength(canonicalJson, "utf8") > MAXIMUM_EVIDENCE_BYTES) {
    invocationError();
  }
  try {
    await input.emitEvidence(canonicalJson);
  } catch {
    return invocationError();
  }
  return evidence;
}
