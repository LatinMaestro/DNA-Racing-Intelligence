import { createHash } from "node:crypto";

import type { DnaOpenLabP5CapacityMeasurementReport } from "./dna-open-lab-p5-capacity-measurement";
import {
  runDnaOpenLabP5PrivatePreviewCapacityMeasurement,
  type DnaOpenLabP5PrivatePreviewCapacityConfiguration,
} from "./dna-open-lab-p5-private-preview-capacity";

const SHA_1_PATTERN = /^[0-9a-f]{40}$/u;
const MAXIMUM_EVIDENCE_BYTES = 16_384;

export const DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY =
  "bounded_private_preview_capacity_measurement" as const;

export type DnaOpenLabP5SanitizedCapacityEvidence = Readonly<{
  schemaVersion: 1;
  evidenceKind: "dna_open_lab_p5_private_preview_capacity";
  evidenceSha256: string;
  codeHeadSha: string;
  planChecksum: string;
  providerScope: "private_preview";
  measurementAuthoritySha256: string;
  measuredAt: string;
  postgresMajorVersion: 18;
  postgres: DnaOpenLabP5CapacityMeasurementReport["postgres"];
  r2: Readonly<
    Omit<DnaOpenLabP5CapacityMeasurementReport["r2"], "priceAuthorityRef"> & {
      priceAuthoritySha256: string;
    }
  >;
  connectedCapacityEvidenceComplete: boolean;
  readyToUpdateP5CapacityRows: boolean;
  firstPersistentPrivatePreviewSyncAllowed: false;
  productionChangesAllowed: false;
}>;

export type DnaOpenLabP5CapacityInvocationInput = Readonly<{
  authority: typeof DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY;
  expectedCodeHeadSha: string;
  configuration: DnaOpenLabP5PrivatePreviewCapacityConfiguration;
  emitEvidence: (canonicalJson: string) => Promise<void>;
}>;

function invocationError(): never {
  throw new Error(
    "DNA Open Lab P5 private Preview capacity invocation failed.",
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

function sanitizeCapacityEvidence(
  report: DnaOpenLabP5CapacityMeasurementReport,
  expectedCodeHeadSha: string,
): DnaOpenLabP5SanitizedCapacityEvidence {
  if (
    report.codeHeadSha !== expectedCodeHeadSha ||
    report.providerScope !== "private_preview" ||
    !report.connectedCapacityEvidenceComplete ||
    report.firstPersistentPrivatePreviewSyncAllowed !== false ||
    report.productionChangesAllowed !== false ||
    report.persistentOwnerDataWriteCount !== 0 ||
    report.residueObjectCount !== 0 ||
    report.rawPayloadIncluded !== false ||
    report.secretMaterialIncluded !== false
  ) {
    invocationError();
  }

  const evidenceWithoutChecksum = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "dna_open_lab_p5_private_preview_capacity" as const,
    codeHeadSha: report.codeHeadSha,
    planChecksum: report.planChecksum,
    providerScope: "private_preview" as const,
    measurementAuthoritySha256: authoritySha256(
      "dna-open-lab-p5-measurement-authority",
      report.measurementAuthorityRef,
    ),
    measuredAt: report.measuredAt,
    postgresMajorVersion: 18 as const,
    postgres: report.postgres,
    r2: Object.freeze({
      retainedObjectCount: report.r2.retainedObjectCount,
      retainedPayloadBytes: report.r2.retainedPayloadBytes,
      retainedMetadataBytes: report.r2.retainedMetadataBytes,
      retainedTotalBytes: report.r2.retainedTotalBytes,
      projectedMonthlyClassAOperations:
        report.r2.projectedMonthlyClassAOperations,
      projectedMonthlyClassBOperations:
        report.r2.projectedMonthlyClassBOperations,
      priceAuthoritySha256: authoritySha256(
        "dna-open-lab-p5-price-authority",
        report.r2.priceAuthorityRef,
      ),
      priceEffectiveAt: report.r2.priceEffectiveAt,
      bytesPerBillableGb: report.r2.bytesPerBillableGb,
      storageMicroUsdPerGbMonth: report.r2.storageMicroUsdPerGbMonth,
      classAMicroUsdPerMillion: report.r2.classAMicroUsdPerMillion,
      classBMicroUsdPerMillion: report.r2.classBMicroUsdPerMillion,
      projectedMonthlyCostMicroUsd: report.r2.projectedMonthlyCostMicroUsd,
    }),
    connectedCapacityEvidenceComplete: report.connectedCapacityEvidenceComplete,
    readyToUpdateP5CapacityRows: report.readyToUpdateP5CapacityRows,
    firstPersistentPrivatePreviewSyncAllowed: false as const,
    productionChangesAllowed: false as const,
  });
  const evidenceSha256 = createHash("sha256")
    .update(JSON.stringify(evidenceWithoutChecksum), "utf8")
    .digest("hex");
  return Object.freeze({
    ...evidenceWithoutChecksum,
    evidenceSha256,
  });
}

/**
 * Explicit connected invocation boundary. It emits only a bounded whitelist
 * record; provider configuration, owner identity, object identities, cursors,
 * raw authority references, credentials and provider errors never cross it.
 */
export async function invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement(
  input: DnaOpenLabP5CapacityInvocationInput,
): Promise<DnaOpenLabP5SanitizedCapacityEvidence> {
  let expectedCodeHeadSha: string;
  try {
    if (input.authority !== DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY) {
      invocationError();
    }
    expectedCodeHeadSha = exactHeadSha(input.expectedCodeHeadSha);
    if (
      exactHeadSha(input.configuration.codeHeadSha) !== expectedCodeHeadSha ||
      typeof input.emitEvidence !== "function"
    ) {
      invocationError();
    }
  } catch {
    return invocationError();
  }

  let evidence: DnaOpenLabP5SanitizedCapacityEvidence;
  try {
    evidence = sanitizeCapacityEvidence(
      await runDnaOpenLabP5PrivatePreviewCapacityMeasurement(
        input.configuration,
      ),
      expectedCodeHeadSha,
    );
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
