import { createHash } from "node:crypto";

import type { DnaPopulationEntrantAuthorityCheckpointRepository } from "./dna-population-entrant-authority-checkpoint";
import { DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE } from "./dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
import {
  dnaPopulationEntrantAuthorityRecord,
  isDnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "./dna-population-entrant-authority-record";
import type { DnaPopulationEntrantAuthorityR2RecoveryPort } from "./dna-population-entrant-authority-recovery";
import { replayDnaPopulationEntrantAuthority } from "./dna-population-entrant-authority-replay";
import type { DnaPopulationEntrantAuthorityExactMainGuard } from "./dna-population-entrant-authority-successor-commissioning";
import { loadDnaPopulationCoreHistoryEntrantAuthority } from "./dna-population-core-history-entrant-source";
import { hydrateDnaRaceDocumentsWithQuarantine } from "./dna-open-lab-race-document-quarantine-hydrator";
import {
  createDnaOpenLabR2CanonicalRaceDocumentReader,
  type DnaOpenLabR2CanonicalRaceDocumentStoragePort,
} from "./dna-open-lab-r2-race-evidence";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceCanonicalJson } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const JSON_CONTENT_TYPE = "application/json";
const MAXIMUM_MANIFEST_BYTES = 256 * 1024;

export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND_VERSION =
  "dna-population-entrant-authority-remediation-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_INTENT =
  "retain_first_private_preview_entrant_remediation_evidence" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND_VERSION =
  "dna-population-entrant-authority-remediation-continuation-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_INTENT =
  "retain_next_private_preview_entrant_remediation_evidence" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION =
  "dna-population-entrant-authority-remediation-cohort-3-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT =
  "retain_third_private_preview_entrant_remediation_evidence" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_RACES =
  20 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES =
  100 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS =
  63 as const;

export type DnaPopulationEntrantAuthorityRemediationStoragePort =
  DnaOpenLabR2CanonicalRaceDocumentStoragePort &
    Pick<PrivateDatasetEvidenceObjectStoragePort, "putObjectIfAbsent">;

export type DnaPopulationEntrantAuthorityRemediationManifest = Readonly<{
  version: 1;
  status: "retained_private_preview_remediation";
  baseGenerationId: string;
  baseRecordSetSha256: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  cohortOrdinal: 1;
  observedAt: string;
  selectedRaceIds: readonly string[];
  selectedRaceSetSha256: string;
  replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
  providerRequestCount: number;
  aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
  previewOnly: true;
  publicationActivated: false;
  lastGoodBasePreserved: true;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthorityRemediationContinuationManifest =
  Readonly<{
    version: 1;
    status: "retained_private_preview_remediation_continuation";
    baseGenerationId: string;
    baseRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    cohortOrdinal: 2;
    priorManifestSha256: string;
    priorSelectedRaceSetSha256: string;
    observedAt: string;
    selectedRaceIds: readonly string[];
    selectedRaceSetSha256: string;
    replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
    providerRequestCount: number;
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    previewOnly: true;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthorityRemediationCohort3Manifest =
  Readonly<{
    version: 1;
    status: "retained_private_preview_remediation_cohort_3";
    baseGenerationId: string;
    baseRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    cohortOrdinal: 3;
    priorManifestSha256: string;
    priorSelectedRaceSetSha256: string;
    observedAt: string;
    selectedRaceIds: readonly string[];
    selectedRaceSetSha256: string;
    replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
    providerRequestCount: number;
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    previewOnly: true;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthorityRemediationVerification = Readonly<{
  status: "verified_replacements" | "verified_no_replacements";
  exactCodeHeadSha: string;
  selectedRaceCount: number;
  replacementRaceCount: number;
  quarantinedRaceCountBefore: number;
  quarantinedRaceCountAfterEvidence: number;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  publicationActivated: false;
  previewOnly: true;
  paidUsageAllowed: false;
  lastGoodBasePreserved: true;
}>;

export type DnaPopulationEntrantAuthorityRemediationContinuationReadiness =
  Readonly<{
    status: "ready_for_continuation";
    exactCodeHeadSha: string;
    completedCohortCount: 1;
    nextCohortOrdinal: 2;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    nextSelectedRaceCount: number;
    quarantinedRaceCountBefore: number;
    remainingUnscannedQuarantineCount: number;
    capacityObservedAt: string;
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationCohort3Readiness =
  Readonly<{
    status: "ready_for_cohort_3";
    exactCodeHeadSha: string;
    completedCohortCount: 2;
    nextCohortOrdinal: 3;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    nextSelectedRaceCount: number;
    quarantinedRaceCountBefore: number;
    remainingUnscannedQuarantineCount: number;
    capacityObservedAt: string;
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationContinuationVerification =
  Readonly<{
    status: "verified_replacements" | "verified_no_replacements";
    exactCodeHeadSha: string;
    cohortOrdinal: 2;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    selectedRaceCount: number;
    replacementRaceCount: number;
    baseRecordSetSha256: string;
    selectedRaceSetSha256: string;
    replacementSetSha256: string;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfterEvidence: number;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationCohort3Verification =
  Readonly<{
    status: "verified_replacements" | "verified_no_replacements";
    exactCodeHeadSha: string;
    cohortOrdinal: 3;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    selectedRaceCount: number;
    replacementRaceCount: number;
    baseRecordSetSha256: string;
    selectedRaceSetSha256: string;
    replacementSetSha256: string;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfterEvidence: number;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationReceipt = Readonly<{
  status: "committed_unpublished" | "existing_verified";
  exactCodeHeadSha: string;
  selectedRaceCount: number;
  replacementRaceCount: number;
  quarantinedRaceCountBefore: number;
  quarantinedRaceCountAfterEvidence: number;
  providerRequestCount: number;
  storageStatus: "created" | "existing";
  aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
  persistentWritePerformed: boolean;
  providerWritePerformed: false;
  publicationActivated: false;
  previewOnly: true;
  paidUsageAllowed: false;
  lastGoodBasePreserved: true;
}>;

export type DnaPopulationEntrantAuthorityRemediationContinuationReceipt =
  Readonly<{
    status: "committed_unpublished" | "existing_verified";
    exactCodeHeadSha: string;
    cohortOrdinal: 2;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    selectedRaceCount: number;
    replacementRaceCount: number;
    baseRecordSetSha256: string;
    selectedRaceSetSha256: string;
    replacementSetSha256: string;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfterEvidence: number;
    providerRequestCount: number;
    storageStatus: "created" | "existing";
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    persistentWritePerformed: boolean;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationCohort3Receipt =
  Readonly<{
    status: "committed_unpublished" | "existing_verified";
    exactCodeHeadSha: string;
    cohortOrdinal: 3;
    priorSelectedRaceCount: number;
    priorReplacementRaceCount: number;
    selectedRaceCount: number;
    replacementRaceCount: number;
    baseRecordSetSha256: string;
    selectedRaceSetSha256: string;
    replacementSetSha256: string;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfterEvidence: number;
    providerRequestCount: number;
    storageStatus: "created" | "existing";
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    persistentWritePerformed: boolean;
    providerWritePerformed: false;
    publicationActivated: false;
    previewOnly: true;
    paidUsageAllowed: false;
    lastGoodBasePreserved: true;
  }>;

export type DnaPopulationEntrantAuthorityRemediationInvocation = Readonly<{
  commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND_VERSION;
  intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  cohortObservedAt: string;
}>;

export type DnaPopulationEntrantAuthorityRemediationContinuationInvocation =
  Readonly<{
    commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND_VERSION;
    intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_INTENT;
    allowPersistentWrite: true;
    exactCodeHeadSha: string;
    cohortObservedAt: string;
  }>;

export type DnaPopulationEntrantAuthorityRemediationCohort3Invocation =
  Readonly<{
    commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION;
    intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT;
    allowPersistentWrite: true;
    exactCodeHeadSha: string;
    cohortObservedAt: string;
  }>;

export type DnaPopulationEntrantAuthorityRemediationDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "main_guard_unavailable"
  | "authority_unavailable"
  | "authority_drift"
  | "base_authority_unavailable"
  | "base_authority_incomplete"
  | "no_quarantine_available"
  | "invalid_observation_time"
  | "request_budget_invalid"
  | "capacity_unavailable"
  | "provider_request_limit"
  | "hydration_unavailable"
  | "manifest_unavailable"
  | "manifest_conflict"
  | "verification_failed";

export class DnaPopulationEntrantAuthorityRemediationError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityRemediationDiagnostic;

  constructor(diagnostic: DnaPopulationEntrantAuthorityRemediationDiagnostic) {
    super("Population entrant remediation is unavailable");
    this.name = "DnaPopulationEntrantAuthorityRemediationError";
    this.diagnostic = diagnostic;
  }
}

function remediationError(
  diagnostic: DnaPopulationEntrantAuthorityRemediationDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityRemediationError(diagnostic);
}

function exactHead(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !GIT_SHA_PATTERN.test(value)
  ) {
    remediationError("exact_head_mismatch");
  }
  return value;
}

async function assertCurrentMain(input: {
  mainGuard: DnaPopulationEntrantAuthorityExactMainGuard;
  expectedHeadSha: string;
}): Promise<void> {
  try {
    const result = await input.mainGuard.assertCurrentMain(
      input.expectedHeadSha,
    );
    if (exactHead(result.currentMainSha) !== input.expectedHeadSha) {
      remediationError("exact_head_mismatch");
    }
  } catch (error) {
    if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
      throw error;
    }
    remediationError("main_guard_unavailable");
  }
}

function safeText(value: string, field: string): string {
  if (
    field.length < 1 ||
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    remediationError("invalid_configuration");
  }
  return value;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    remediationError("manifest_conflict");
  }
  return value;
}

function timestamp(value: string): string {
  if (typeof value !== "string") remediationError("invalid_observation_time");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    remediationError("invalid_observation_time");
  }
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function raceSetSha256(raceIds: readonly string[]): string {
  return digest(
    [
      "dna_open_lab",
      "population_history",
      "entrant_remediation",
      ...raceIds,
    ].join("\u0000"),
  );
}

function replacementSetSha256(
  replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[],
): string {
  return digest(
    [
      "dna_open_lab",
      "population_history",
      "entrant_remediation_replacements",
      dnaOpenLabRawEvidenceCanonicalJson(replacements),
    ].join("\u0000"),
  );
}

function ownerPrefix(ownerId: string): string {
  return digest(`dna-population-entrant-remediation-owner\u0000${ownerId}`);
}

function manifestKey(ownerId: string, baseGenerationId: string): string {
  return [
    "dna-open-lab",
    "v1",
    ownerPrefix(ownerId),
    "population-entrant-authority",
    "remediation",
    baseGenerationId,
    "cohorts",
    "000001.json",
  ].join("/");
}

function continuationManifestKey(
  ownerId: string,
  baseGenerationId: string,
): string {
  return [
    "dna-open-lab",
    "v1",
    ownerPrefix(ownerId),
    "population-entrant-authority",
    "remediation",
    baseGenerationId,
    "cohorts",
    "000002.json",
  ].join("/");
}

function canonicalManifest(
  manifest: DnaPopulationEntrantAuthorityRemediationManifest,
): string {
  return dnaOpenLabRawEvidenceCanonicalJson(manifest);
}

function canonicalContinuationManifest(
  manifest: DnaPopulationEntrantAuthorityRemediationContinuationManifest,
): string {
  return dnaOpenLabRawEvidenceCanonicalJson(manifest);
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function oneChunk(value: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield value;
  })();
}

function assertPrivateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    input.publicAccessDisabled !== true ||
    input.r2DevDisabled !== true ||
    input.customDomainCount !== 0
  ) {
    remediationError("manifest_unavailable");
  }
}

async function collectBody(
  body: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > MAXIMUM_MANIFEST_BYTES
  ) {
    remediationError("manifest_conflict");
  }
  const output = new Uint8Array(expectedBytes);
  let offset = 0;
  for await (const chunk of body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > output.byteLength
    ) {
      remediationError("manifest_conflict");
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== output.byteLength) remediationError("manifest_conflict");
  return output;
}

function exactResolvedRecord(
  value: DnaPopulationEntrantAuthorityResolvedRecord,
): DnaPopulationEntrantAuthorityResolvedRecord {
  const sourceRaceId = safeText(value.sourceRaceId, "sourceRaceId");
  const observedAt = timestamp(value.observedAt);
  const rawEvidenceSha256 = sha256(value.rawEvidenceSha256);
  if (
    (value.mode !== "bike" && value.mode !== "car" && value.mode !== "horse") ||
    value.entrantCoreIds === undefined ||
    value.entrantCoreIds.length < 1 ||
    value.entrantCoreIds.some(
      (coreId) =>
        typeof coreId !== "string" ||
        !/^[1-9]\d*$/u.test(coreId) ||
        !Number.isSafeInteger(Number(coreId)),
    ) ||
    new Set(value.entrantCoreIds).size !== value.entrantCoreIds.length ||
    value.modeEvidenceStatus !== undefined ||
    value.entrantCoreIdsEvidenceStatus !== undefined
  ) {
    remediationError("manifest_conflict");
  }
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256,
    mode: value.mode,
    entrantCoreIds: Object.freeze([...value.entrantCoreIds]),
  });
}

function validateManifestShape(
  value: DnaPopulationEntrantAuthorityRemediationManifest,
): DnaPopulationEntrantAuthorityRemediationManifest {
  if (
    value.version !== 1 ||
    value.status !== "retained_private_preview_remediation" ||
    value.cohortOrdinal !== 1 ||
    !Number.isSafeInteger(value.unresolvedRaceCount) ||
    value.unresolvedRaceCount < 1 ||
    !Number.isSafeInteger(value.providerRequestCount) ||
    value.providerRequestCount < 0 ||
    value.providerRequestCount >
      DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS ||
    value.aggregateRequestsPerMinute !==
      DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE ||
    value.previewOnly !== true ||
    value.publicationActivated !== false ||
    value.lastGoodBasePreserved !== true ||
    value.paidUsageAllowed !== false ||
    value.selectedRaceIds.length < 1 ||
    value.selectedRaceIds.length >
      DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_RACES
  ) {
    remediationError("manifest_conflict");
  }
  const selectedRaceIds = Object.freeze(
    value.selectedRaceIds.map((raceId) => safeText(raceId, "sourceRaceId")),
  );
  if (
    new Set(selectedRaceIds).size !== selectedRaceIds.length ||
    raceSetSha256(selectedRaceIds) !== value.selectedRaceSetSha256
  ) {
    remediationError("manifest_conflict");
  }
  const replacements = Object.freeze(
    value.replacements.map(exactResolvedRecord),
  );
  if (
    new Set(replacements.map((record) => record.sourceRaceId)).size !==
      replacements.length ||
    replacements.some(
      (record) => !selectedRaceIds.includes(record.sourceRaceId),
    )
  ) {
    remediationError("manifest_conflict");
  }
  return Object.freeze({
    version: 1 as const,
    status: "retained_private_preview_remediation" as const,
    baseGenerationId: sha256(value.baseGenerationId),
    baseRecordSetSha256: sha256(value.baseRecordSetSha256),
    unresolvedRaceCount: value.unresolvedRaceCount,
    unresolvedRaceSetSha256: sha256(value.unresolvedRaceSetSha256),
    cohortOrdinal: 1 as const,
    observedAt: timestamp(value.observedAt),
    selectedRaceIds,
    selectedRaceSetSha256: sha256(value.selectedRaceSetSha256),
    replacements,
    providerRequestCount: value.providerRequestCount,
    aggregateRequestsPerMinute:
      DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
    previewOnly: true as const,
    publicationActivated: false as const,
    lastGoodBasePreserved: true as const,
    paidUsageAllowed: false as const,
  });
}

function validateContinuationManifestShape(
  value: DnaPopulationEntrantAuthorityRemediationContinuationManifest,
): DnaPopulationEntrantAuthorityRemediationContinuationManifest {
  if (
    value.version !== 1 ||
    value.status !== "retained_private_preview_remediation_continuation" ||
    value.cohortOrdinal !== 2 ||
    !Number.isSafeInteger(value.unresolvedRaceCount) ||
    value.unresolvedRaceCount < 1 ||
    !Number.isSafeInteger(value.providerRequestCount) ||
    value.providerRequestCount < 0 ||
    value.providerRequestCount >
      DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS ||
    value.aggregateRequestsPerMinute !==
      DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE ||
    value.previewOnly !== true ||
    value.publicationActivated !== false ||
    value.lastGoodBasePreserved !== true ||
    value.paidUsageAllowed !== false ||
    value.selectedRaceIds.length < 1 ||
    value.selectedRaceIds.length >
      DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_RACES
  ) {
    remediationError("manifest_conflict");
  }
  const selectedRaceIds = Object.freeze(
    value.selectedRaceIds.map((raceId) => safeText(raceId, "sourceRaceId")),
  );
  if (
    new Set(selectedRaceIds).size !== selectedRaceIds.length ||
    raceSetSha256(selectedRaceIds) !== value.selectedRaceSetSha256
  ) {
    remediationError("manifest_conflict");
  }
  const replacements = Object.freeze(
    value.replacements.map(exactResolvedRecord),
  );
  if (
    new Set(replacements.map((record) => record.sourceRaceId)).size !==
      replacements.length ||
    replacements.some(
      (record) => !selectedRaceIds.includes(record.sourceRaceId),
    )
  ) {
    remediationError("manifest_conflict");
  }
  return Object.freeze({
    version: 1 as const,
    status: "retained_private_preview_remediation_continuation" as const,
    baseGenerationId: sha256(value.baseGenerationId),
    baseRecordSetSha256: sha256(value.baseRecordSetSha256),
    unresolvedRaceCount: value.unresolvedRaceCount,
    unresolvedRaceSetSha256: sha256(value.unresolvedRaceSetSha256),
    cohortOrdinal: 2 as const,
    priorManifestSha256: sha256(value.priorManifestSha256),
    priorSelectedRaceSetSha256: sha256(value.priorSelectedRaceSetSha256),
    observedAt: timestamp(value.observedAt),
    selectedRaceIds,
    selectedRaceSetSha256: sha256(value.selectedRaceSetSha256),
    replacements,
    providerRequestCount: value.providerRequestCount,
    aggregateRequestsPerMinute:
      DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
    previewOnly: true as const,
    publicationActivated: false as const,
    lastGoodBasePreserved: true as const,
    paidUsageAllowed: false as const,
  });
}

export function createDnaPopulationEntrantAuthorityRemediationManifestStore(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaPopulationEntrantAuthorityRemediationStoragePort;
}): Readonly<{
  read: (request: {
    baseGenerationId: string;
  }) => Promise<DnaPopulationEntrantAuthorityRemediationManifest | null>;
  write: (
    manifest: DnaPopulationEntrantAuthorityRemediationManifest,
  ) => Promise<Readonly<{ storageStatus: "created" | "existing" }>>;
  readContinuation: (request: {
    baseGenerationId: string;
  }) => Promise<DnaPopulationEntrantAuthorityRemediationContinuationManifest | null>;
  writeContinuation: (
    manifest: DnaPopulationEntrantAuthorityRemediationContinuationManifest,
  ) => Promise<Readonly<{ storageStatus: "created" | "existing" }>>;
}> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const bucketName = safeText(input.bucketName, "bucketName");
  let privacy: Promise<void> | null = null;

  async function privateStorage(): Promise<void> {
    privacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await privacy;
  }

  async function read(request: {
    baseGenerationId: string;
  }): Promise<DnaPopulationEntrantAuthorityRemediationManifest | null> {
    const baseGenerationId = sha256(request.baseGenerationId);
    const key = manifestKey(ownerId, baseGenerationId);
    await privateStorage();
    const head = await input.storage.headObject({ bucketName, key });
    if (head.status === "missing") return null;
    if (
      head.status !== "ready" ||
      head.contentType !== JSON_CONTENT_TYPE ||
      !Number.isSafeInteger(head.byteLength) ||
      head.byteLength < 1 ||
      head.byteLength > MAXIMUM_MANIFEST_BYTES ||
      !SHA_256_PATTERN.test(head.checksumSha256) ||
      head.metadata["dna-source"] !== "dna_open_lab" ||
      head.metadata["dna-version"] !== "v1" ||
      head.metadata["dna-purpose"] !== "entrant_remediation" ||
      head.metadata["dna-base-generation"] !== baseGenerationId ||
      head.metadata["dna-body-sha256"] !== head.checksumSha256
    ) {
      remediationError("manifest_conflict");
    }
    const object = await input.storage.getObject({ bucketName, key });
    if (object.status !== "ready") remediationError("manifest_unavailable");
    const body = await collectBody(object.body, head.byteLength);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (digest(decoded) !== head.checksumSha256) {
      remediationError("manifest_conflict");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      remediationError("manifest_conflict");
    }
    const manifest = validateManifestShape(
      parsed as DnaPopulationEntrantAuthorityRemediationManifest,
    );
    if (
      manifest.baseGenerationId !== baseGenerationId ||
      canonicalManifest(manifest) !== decoded
    ) {
      remediationError("manifest_conflict");
    }
    return manifest;
  }

  async function readContinuation(request: {
    baseGenerationId: string;
  }): Promise<DnaPopulationEntrantAuthorityRemediationContinuationManifest | null> {
    const baseGenerationId = sha256(request.baseGenerationId);
    const key = continuationManifestKey(ownerId, baseGenerationId);
    await privateStorage();
    const head = await input.storage.headObject({ bucketName, key });
    if (head.status === "missing") return null;
    if (
      head.status !== "ready" ||
      head.contentType !== JSON_CONTENT_TYPE ||
      !Number.isSafeInteger(head.byteLength) ||
      head.byteLength < 1 ||
      head.byteLength > MAXIMUM_MANIFEST_BYTES ||
      !SHA_256_PATTERN.test(head.checksumSha256) ||
      head.metadata["dna-source"] !== "dna_open_lab" ||
      head.metadata["dna-version"] !== "v1" ||
      head.metadata["dna-purpose"] !== "entrant_remediation_continuation" ||
      head.metadata["dna-base-generation"] !== baseGenerationId ||
      head.metadata["dna-cohort-ordinal"] !== "2" ||
      head.metadata["dna-body-sha256"] !== head.checksumSha256
    ) {
      remediationError("manifest_conflict");
    }
    const object = await input.storage.getObject({ bucketName, key });
    if (object.status !== "ready") remediationError("manifest_unavailable");
    const body = await collectBody(object.body, head.byteLength);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (digest(decoded) !== head.checksumSha256) {
      remediationError("manifest_conflict");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      remediationError("manifest_conflict");
    }
    const manifest = validateContinuationManifestShape(
      parsed as DnaPopulationEntrantAuthorityRemediationContinuationManifest,
    );
    if (
      manifest.baseGenerationId !== baseGenerationId ||
      canonicalContinuationManifest(manifest) !== decoded
    ) {
      remediationError("manifest_conflict");
    }
    return manifest;
  }

  return Object.freeze({
    read,
    readContinuation,
    async write(manifestInput) {
      const manifest = validateManifestShape(manifestInput);
      const bodyText = canonicalManifest(manifest);
      const body = bytes(bodyText);
      if (body.byteLength < 1 || body.byteLength > MAXIMUM_MANIFEST_BYTES) {
        remediationError("manifest_conflict");
      }
      const bodySha256 = digest(bodyText);
      const key = manifestKey(ownerId, manifest.baseGenerationId);
      await privateStorage();
      const stored = await input.storage.putObjectIfAbsent({
        bucketName,
        key,
        body: oneChunk(body),
        contentType: JSON_CONTENT_TYPE,
        byteLength: body.byteLength,
        checksumSha256: bodySha256,
        metadata: Object.freeze({
          "dna-source": "dna_open_lab",
          "dna-version": "v1",
          "dna-purpose": "entrant_remediation",
          "dna-base-generation": manifest.baseGenerationId,
          "dna-body-sha256": bodySha256,
        }),
      });
      if (stored.status !== "created" && stored.status !== "existing") {
        remediationError("manifest_unavailable");
      }
      const reopened = await read({
        baseGenerationId: manifest.baseGenerationId,
      });
      if (
        reopened === null ||
        canonicalManifest(reopened) !== canonicalManifest(manifest)
      ) {
        remediationError("manifest_conflict");
      }
      return Object.freeze({ storageStatus: stored.status });
    },
    async writeContinuation(manifestInput) {
      const manifest = validateContinuationManifestShape(manifestInput);
      const bodyText = canonicalContinuationManifest(manifest);
      const body = bytes(bodyText);
      if (body.byteLength < 1 || body.byteLength > MAXIMUM_MANIFEST_BYTES) {
        remediationError("manifest_conflict");
      }
      const bodySha256 = digest(bodyText);
      const key = continuationManifestKey(ownerId, manifest.baseGenerationId);
      await privateStorage();
      const stored = await input.storage.putObjectIfAbsent({
        bucketName,
        key,
        body: oneChunk(body),
        contentType: JSON_CONTENT_TYPE,
        byteLength: body.byteLength,
        checksumSha256: bodySha256,
        metadata: Object.freeze({
          "dna-source": "dna_open_lab",
          "dna-version": "v1",
          "dna-purpose": "entrant_remediation_continuation",
          "dna-base-generation": manifest.baseGenerationId,
          "dna-cohort-ordinal": "2",
          "dna-body-sha256": bodySha256,
        }),
      });
      if (stored.status !== "created" && stored.status !== "existing") {
        remediationError("manifest_unavailable");
      }
      const reopened = await readContinuation({
        baseGenerationId: manifest.baseGenerationId,
      });
      if (
        reopened === null ||
        canonicalContinuationManifest(reopened) !==
          canonicalContinuationManifest(manifest)
      ) {
        remediationError("manifest_conflict");
      }
      return Object.freeze({ storageStatus: stored.status });
    },
  });
}

const QUARANTINE_PRIORITY = Object.freeze({
  provider_document_unusable: 0,
  provider_document_missing: 1,
  entrant_authority_unresolved: 2,
} satisfies Readonly<
  Record<
    DnaPopulationEntrantAuthorityQuarantineRecord["quarantineReason"],
    number
  >
>);

function orderedQuarantines(
  records: readonly (
    | DnaPopulationEntrantAuthorityQuarantineRecord
    | DnaPopulationEntrantAuthorityResolvedRecord
  )[],
): readonly DnaPopulationEntrantAuthorityQuarantineRecord[] {
  return Object.freeze(
    records
      .filter(isDnaPopulationEntrantAuthorityQuarantineRecord)
      .sort((left, right) => {
        const priority =
          QUARANTINE_PRIORITY[left.quarantineReason] -
          QUARANTINE_PRIORITY[right.quarantineReason];
        if (priority !== 0) return priority;
        return left.sourceRaceId < right.sourceRaceId
          ? -1
          : left.sourceRaceId > right.sourceRaceId
            ? 1
            : 0;
      }),
  );
}

function selectFirstCohort(
  records: readonly (
    | DnaPopulationEntrantAuthorityQuarantineRecord
    | DnaPopulationEntrantAuthorityResolvedRecord
  )[],
): readonly DnaPopulationEntrantAuthorityQuarantineRecord[] {
  return Object.freeze(
    orderedQuarantines(records).slice(
      0,
      DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_RACES,
    ),
  );
}

function selectContinuationCohort(
  records: readonly (
    | DnaPopulationEntrantAuthorityQuarantineRecord
    | DnaPopulationEntrantAuthorityResolvedRecord
  )[],
  priorSelectedRaceIds: readonly string[],
): readonly DnaPopulationEntrantAuthorityQuarantineRecord[] {
  const excluded = new Set(
    priorSelectedRaceIds.map((raceId) => safeText(raceId, "sourceRaceId")),
  );
  if (excluded.size !== priorSelectedRaceIds.length) {
    remediationError("manifest_conflict");
  }
  return Object.freeze(
    orderedQuarantines(records)
      .filter((record) => !excluded.has(record.sourceRaceId))
      .slice(0, DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_RACES),
  );
}

async function loadBase(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}) {
  let audit: Awaited<
    ReturnType<DnaPopulationEntrantAuthorityLiveAuditSource["load"]>
  >;
  try {
    audit = await input.authoritySource.load({
      ownerId: input.ownerId,
      exactCodeHeadSha: input.exactCodeHeadSha,
    });
  } catch {
    remediationError("authority_unavailable");
  }

  try {
    const base = await loadDnaPopulationCoreHistoryEntrantAuthority({
      ownerId: input.ownerId,
      authority: audit.authority,
      checkpointRepository: input.checkpointRepository,
      r2Store: input.r2Store,
    });
    const replay = replayDnaPopulationEntrantAuthority({
      records: base.records,
      expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
      expectedUnresolvedRaceSetSha256: audit.authority.unresolvedRaceSetSha256,
    });
    if (
      replay.exactReplayDuplicateCount !== 0 ||
      replay.quarantinedRaceCount < 1 ||
      replay.recordSetSha256.length !== 64
    ) {
      remediationError("base_authority_incomplete");
    }
    return Object.freeze({ audit, base, replay });
  } catch (error) {
    if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
      throw error;
    }
    remediationError("base_authority_unavailable");
  }
}

function validateCapacityApproval(
  approval: Awaited<
    ReturnType<
      DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
    >
  >,
  authority: Parameters<
    DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
  >[0],
): void {
  if (
    approval.version !== 1 ||
    approval.generationId !== authority.generationId ||
    approval.unresolvedRaceCount !== authority.unresolvedRaceCount ||
    approval.unresolvedRaceSetSha256 !== authority.unresolvedRaceSetSha256 ||
    approval.capacityAllowed !== true ||
    approval.paidUsageAllowed !== false ||
    Number.isNaN(Date.parse(approval.observedAt)) ||
    new Date(approval.observedAt).toISOString() !== approval.observedAt
  ) {
    remediationError("capacity_unavailable");
  }
}

function sameBaseAuthority(
  before: Awaited<ReturnType<typeof loadBase>>,
  after: Awaited<ReturnType<typeof loadBase>>,
): boolean {
  return (
    before.audit.authority.generationId ===
      after.audit.authority.generationId &&
    before.audit.authority.unresolvedRaceCount ===
      after.audit.authority.unresolvedRaceCount &&
    before.audit.authority.unresolvedRaceSetSha256 ===
      after.audit.authority.unresolvedRaceSetSha256 &&
    before.base.checkpointUpdatedAt === after.base.checkpointUpdatedAt &&
    before.replay.recordSetSha256 === after.replay.recordSetSha256 &&
    dnaOpenLabRawEvidenceCanonicalJson(
      selectFirstCohort(before.base.records),
    ) ===
      dnaOpenLabRawEvidenceCanonicalJson(selectFirstCohort(after.base.records))
  );
}

function validateRequestBudget(requestBudget: DnaOpenLabRequestBudget): void {
  const snapshot = requestBudget.snapshot();
  if (
    !Number.isSafeInteger(snapshot.effectiveRequestsPerMinute) ||
    snapshot.effectiveRequestsPerMinute < 1 ||
    snapshot.effectiveRequestsPerMinute >
      DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE ||
    !Number.isSafeInteger(snapshot.requestsInCurrentWindow) ||
    snapshot.requestsInCurrentWindow < 0
  ) {
    remediationError("request_budget_invalid");
  }
}

function boundedRequestBudget(
  requestBudget: DnaOpenLabRequestBudget,
  counter: { value: number },
): DnaOpenLabRequestBudget {
  return Object.freeze({
    async execute(request) {
      if (
        counter.value >=
        DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS
      ) {
        remediationError("provider_request_limit");
      }
      counter.value += 1;
      return requestBudget.execute(request);
    },
    observeRateLimit: requestBudget.observeRateLimit,
    reduceEffectiveRequestsPerMinute:
      requestBudget.reduceEffectiveRequestsPerMinute,
    snapshot: requestBudget.snapshot,
  });
}

async function verifyManifest(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
  manifestStore: ReturnType<
    typeof createDnaPopulationEntrantAuthorityRemediationManifestStore
  >;
  raceDocumentReader: ReturnType<
    typeof createDnaOpenLabR2CanonicalRaceDocumentReader
  >;
}): Promise<
  Readonly<{
    manifest: DnaPopulationEntrantAuthorityRemediationManifest;
    verification: DnaPopulationEntrantAuthorityRemediationVerification;
  }>
> {
  const loaded = await loadBase(input);
  const manifest = await input.manifestStore.read({
    baseGenerationId: loaded.audit.authority.generationId,
  });
  if (manifest === null) remediationError("manifest_unavailable");

  const selected = selectFirstCohort(loaded.base.records);
  const selectedRaceIds = selected.map((record) => record.sourceRaceId);
  if (
    manifest.baseGenerationId !== loaded.audit.authority.generationId ||
    manifest.baseRecordSetSha256 !== loaded.replay.recordSetSha256 ||
    manifest.unresolvedRaceCount !==
      loaded.audit.authority.unresolvedRaceCount ||
    manifest.unresolvedRaceSetSha256 !==
      loaded.audit.authority.unresolvedRaceSetSha256 ||
    manifest.selectedRaceIds.length !== selectedRaceIds.length ||
    manifest.selectedRaceIds.some(
      (raceId, index) => raceId !== selectedRaceIds[index],
    )
  ) {
    remediationError("verification_failed");
  }

  const baseByRaceId = new Map(
    selected.map((record) => [record.sourceRaceId, record] as const),
  );
  for (const replacement of manifest.replacements) {
    const previous = baseByRaceId.get(replacement.sourceRaceId);
    if (
      previous === undefined ||
      Date.parse(replacement.observedAt) <= Date.parse(previous.observedAt)
    ) {
      remediationError("verification_failed");
    }
    let evidence;
    try {
      evidence = await input.raceDocumentReader.read({
        sourceRaceId: replacement.sourceRaceId,
        observedAt: replacement.observedAt,
        rawEvidenceSha256: replacement.rawEvidenceSha256,
      });
    } catch {
      remediationError("verification_failed");
    }
    const reopened = exactResolvedRecord(
      dnaPopulationEntrantAuthorityRecord(
        evidence,
      ) as DnaPopulationEntrantAuthorityResolvedRecord,
    );
    if (
      dnaOpenLabRawEvidenceCanonicalJson(reopened) !==
      dnaOpenLabRawEvidenceCanonicalJson(replacement)
    ) {
      remediationError("verification_failed");
    }
  }

  const replacementRaceCount = manifest.replacements.length;
  return Object.freeze({
    manifest,
    verification: Object.freeze({
      status:
        replacementRaceCount > 0
          ? ("verified_replacements" as const)
          : ("verified_no_replacements" as const),
      exactCodeHeadSha: input.exactCodeHeadSha,
      selectedRaceCount: manifest.selectedRaceIds.length,
      replacementRaceCount,
      baseRecordSetSha256: manifest.baseRecordSetSha256,
      selectedRaceSetSha256: manifest.selectedRaceSetSha256,
      replacementSetSha256: replacementSetSha256(manifest.replacements),
      quarantinedRaceCountBefore: loaded.replay.quarantinedRaceCount,
      quarantinedRaceCountAfterEvidence:
        loaded.replay.quarantinedRaceCount - replacementRaceCount,
      providerRequestPerformed: false as const,
      persistentWritePerformed: false as const,
      publicationActivated: false as const,
      previewOnly: true as const,
      paidUsageAllowed: false as const,
      lastGoodBasePreserved: true as const,
    }),
  });
}

async function verifyContinuationManifest(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
  manifestStore: ReturnType<
    typeof createDnaPopulationEntrantAuthorityRemediationManifestStore
  >;
  raceDocumentReader: ReturnType<
    typeof createDnaOpenLabR2CanonicalRaceDocumentReader
  >;
}): Promise<
  Readonly<{
    firstManifest: DnaPopulationEntrantAuthorityRemediationManifest;
    manifest: DnaPopulationEntrantAuthorityRemediationContinuationManifest;
    verification: DnaPopulationEntrantAuthorityRemediationContinuationVerification;
  }>
> {
  const loaded = await loadBase(input);
  const first = await verifyManifest(input);
  const manifest = await input.manifestStore.readContinuation({
    baseGenerationId: loaded.audit.authority.generationId,
  });
  if (manifest === null) remediationError("manifest_unavailable");

  const selected = selectContinuationCohort(
    loaded.base.records,
    first.manifest.selectedRaceIds,
  );
  const selectedRaceIds = selected.map((record) => record.sourceRaceId);
  if (
    manifest.baseGenerationId !== loaded.audit.authority.generationId ||
    manifest.baseRecordSetSha256 !== loaded.replay.recordSetSha256 ||
    manifest.unresolvedRaceCount !==
      loaded.audit.authority.unresolvedRaceCount ||
    manifest.unresolvedRaceSetSha256 !==
      loaded.audit.authority.unresolvedRaceSetSha256 ||
    manifest.priorManifestSha256 !==
      digest(canonicalManifest(first.manifest)) ||
    manifest.priorSelectedRaceSetSha256 !==
      first.manifest.selectedRaceSetSha256 ||
    Date.parse(manifest.observedAt) <= Date.parse(first.manifest.observedAt) ||
    manifest.selectedRaceIds.length !== selectedRaceIds.length ||
    manifest.selectedRaceIds.some(
      (raceId, index) => raceId !== selectedRaceIds[index],
    )
  ) {
    remediationError("verification_failed");
  }

  const firstSelected = new Set(first.manifest.selectedRaceIds);
  const firstReplacements = new Set(
    first.manifest.replacements.map((record) => record.sourceRaceId),
  );
  if (
    manifest.selectedRaceIds.some((raceId) => firstSelected.has(raceId)) ||
    manifest.replacements.some((record) =>
      firstReplacements.has(record.sourceRaceId),
    )
  ) {
    remediationError("verification_failed");
  }

  const baseByRaceId = new Map(
    selected.map((record) => [record.sourceRaceId, record] as const),
  );
  for (const replacement of manifest.replacements) {
    const previous = baseByRaceId.get(replacement.sourceRaceId);
    if (
      previous === undefined ||
      replacement.observedAt !== manifest.observedAt ||
      Date.parse(replacement.observedAt) <= Date.parse(previous.observedAt)
    ) {
      remediationError("verification_failed");
    }
    let evidence;
    try {
      evidence = await input.raceDocumentReader.read({
        sourceRaceId: replacement.sourceRaceId,
        observedAt: replacement.observedAt,
        rawEvidenceSha256: replacement.rawEvidenceSha256,
      });
    } catch {
      remediationError("verification_failed");
    }
    const reopened = exactResolvedRecord(
      dnaPopulationEntrantAuthorityRecord(
        evidence,
      ) as DnaPopulationEntrantAuthorityResolvedRecord,
    );
    if (
      dnaOpenLabRawEvidenceCanonicalJson(reopened) !==
      dnaOpenLabRawEvidenceCanonicalJson(replacement)
    ) {
      remediationError("verification_failed");
    }
  }

  const replacementRaceCount = manifest.replacements.length;
  const totalReplacementRaceCount =
    first.manifest.replacements.length + replacementRaceCount;
  if (
    totalReplacementRaceCount > loaded.replay.quarantinedRaceCount ||
    new Set([
      ...first.manifest.replacements.map((record) => record.sourceRaceId),
      ...manifest.replacements.map((record) => record.sourceRaceId),
    ]).size !== totalReplacementRaceCount
  ) {
    remediationError("verification_failed");
  }

  return Object.freeze({
    firstManifest: first.manifest,
    manifest,
    verification: Object.freeze({
      status:
        replacementRaceCount > 0
          ? ("verified_replacements" as const)
          : ("verified_no_replacements" as const),
      exactCodeHeadSha: input.exactCodeHeadSha,
      cohortOrdinal: 2 as const,
      priorSelectedRaceCount: first.manifest.selectedRaceIds.length,
      priorReplacementRaceCount: first.manifest.replacements.length,
      selectedRaceCount: manifest.selectedRaceIds.length,
      replacementRaceCount,
      baseRecordSetSha256: manifest.baseRecordSetSha256,
      selectedRaceSetSha256: manifest.selectedRaceSetSha256,
      replacementSetSha256: replacementSetSha256(manifest.replacements),
      quarantinedRaceCountBefore: loaded.replay.quarantinedRaceCount,
      quarantinedRaceCountAfterEvidence:
        loaded.replay.quarantinedRaceCount - totalReplacementRaceCount,
      providerRequestPerformed: false as const,
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      publicationActivated: false as const,
      previewOnly: true as const,
      paidUsageAllowed: false as const,
      lastGoodBasePreserved: true as const,
    }),
  });
}

export function createDnaPopulationEntrantAuthorityRemediation(input: {
  ownerId: string;
  runtimeCodeHeadSha: string;
  mainGuard: DnaPopulationEntrantAuthorityExactMainGuard;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  manifestStore: ReturnType<
    typeof createDnaPopulationEntrantAuthorityRemediationManifestStore
  >;
  raceDocumentReader: ReturnType<
    typeof createDnaOpenLabR2CanonicalRaceDocumentReader
  >;
}): Readonly<{
  execute: (
    invocation: DnaPopulationEntrantAuthorityRemediationInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityRemediationReceipt>;
  executeContinuation: (
    invocation: DnaPopulationEntrantAuthorityRemediationContinuationInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityRemediationContinuationReceipt>;
  verify: () => Promise<DnaPopulationEntrantAuthorityRemediationVerification>;
  verifyContinuation: () => Promise<DnaPopulationEntrantAuthorityRemediationContinuationVerification>;
  inspectContinuationReadiness: () => Promise<DnaPopulationEntrantAuthorityRemediationContinuationReadiness>;
}> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const runtimeCodeHeadSha = exactHead(input.runtimeCodeHeadSha);

  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        remediationError("not_explicitly_armed");
      }
      const requestedHead = exactHead(invocation.exactCodeHeadSha);
      if (requestedHead !== runtimeCodeHeadSha) {
        remediationError("exact_head_mismatch");
      }
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });
      const cohortObservedAt = timestamp(invocation.cohortObservedAt);
      const loaded = await loadBase({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      const selected = selectFirstCohort(loaded.base.records);
      if (selected.length < 1) remediationError("no_quarantine_available");

      const existing = await input.manifestStore.read({
        baseGenerationId: loaded.audit.authority.generationId,
      });
      if (existing !== null) {
        const verified = await verifyManifest({
          ownerId,
          exactCodeHeadSha: requestedHead,
          authoritySource: input.authoritySource,
          checkpointRepository: input.checkpointRepository,
          r2Store: input.r2Store,
          manifestStore: input.manifestStore,
          raceDocumentReader: input.raceDocumentReader,
        });
        return Object.freeze({
          status: "existing_verified" as const,
          exactCodeHeadSha: requestedHead,
          selectedRaceCount: verified.verification.selectedRaceCount,
          replacementRaceCount: verified.verification.replacementRaceCount,
          quarantinedRaceCountBefore:
            verified.verification.quarantinedRaceCountBefore,
          quarantinedRaceCountAfterEvidence:
            verified.verification.quarantinedRaceCountAfterEvidence,
          providerRequestCount: existing.providerRequestCount,
          storageStatus: "existing" as const,
          aggregateRequestsPerMinute:
            DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
          persistentWritePerformed: false,
          providerWritePerformed: false as const,
          publicationActivated: false as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          lastGoodBasePreserved: true as const,
        });
      }

      if (
        selected.some(
          (record) =>
            Date.parse(cohortObservedAt) <= Date.parse(record.observedAt),
        )
      ) {
        remediationError("invalid_observation_time");
      }

      validateRequestBudget(input.requestBudget);
      let capacity: Awaited<
        ReturnType<
          DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
        >
      >;
      try {
        capacity = await input.capacityGate.assertFreshCurrentCapacity(
          loaded.audit.authority,
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES,
        );
      } catch {
        remediationError("capacity_unavailable");
      }
      validateCapacityApproval(capacity, loaded.audit.authority);
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });

      const providerCounter = { value: 0 };
      let hydration: Awaited<
        ReturnType<typeof hydrateDnaRaceDocumentsWithQuarantine>
      >;
      try {
        hydration = await hydrateDnaRaceDocumentsWithQuarantine({
          raceIds: selected.map((record) => record.sourceRaceId),
          client: input.client,
          requestBudget: boundedRequestBudget(
            input.requestBudget,
            providerCounter,
          ),
          observedAt: cohortObservedAt,
        });
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
          throw error;
        }
        remediationError("hydration_unavailable");
      }
      if (
        providerCounter.value !== hydration.providerRequestCount ||
        hydration.requestedRaceCount !== selected.length ||
        hydration.outcomes.length !== selected.length ||
        providerCounter.value < 1 ||
        providerCounter.value >
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS
      ) {
        remediationError("hydration_unavailable");
      }

      const replacements = Object.freeze(
        hydration.outcomes
          .filter(
            (
              outcome,
            ): outcome is Extract<
              (typeof hydration.outcomes)[number],
              { status: "resolved" }
            > => outcome.status === "resolved",
          )
          .map((outcome) =>
            exactResolvedRecord(
              dnaPopulationEntrantAuthorityRecord(
                outcome.evidence,
              ) as DnaPopulationEntrantAuthorityResolvedRecord,
            ),
          ),
      );

      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });
      const currentBase = await loadBase({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      if (!sameBaseAuthority(loaded, currentBase)) {
        remediationError("authority_drift");
      }

      try {
        capacity = await input.capacityGate.assertFreshCurrentCapacity(
          currentBase.audit.authority,
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES,
        );
      } catch {
        remediationError("capacity_unavailable");
      }
      validateCapacityApproval(capacity, currentBase.audit.authority);
      validateRequestBudget(input.requestBudget);
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });

      const selectedRaceIds = Object.freeze(
        selected.map((record) => record.sourceRaceId),
      );
      const manifest: DnaPopulationEntrantAuthorityRemediationManifest =
        Object.freeze({
          version: 1 as const,
          status: "retained_private_preview_remediation" as const,
          baseGenerationId: loaded.audit.authority.generationId,
          baseRecordSetSha256: loaded.replay.recordSetSha256,
          unresolvedRaceCount: loaded.audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256:
            loaded.audit.authority.unresolvedRaceSetSha256,
          cohortOrdinal: 1 as const,
          observedAt: cohortObservedAt,
          selectedRaceIds,
          selectedRaceSetSha256: raceSetSha256(selectedRaceIds),
          replacements,
          providerRequestCount: providerCounter.value,
          aggregateRequestsPerMinute:
            DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
          previewOnly: true as const,
          publicationActivated: false as const,
          lastGoodBasePreserved: true as const,
          paidUsageAllowed: false as const,
        });

      let stored;
      try {
        stored = await input.manifestStore.write(manifest);
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
          throw error;
        }
        remediationError("manifest_unavailable");
      }

      const verified = await verifyManifest({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });

      return Object.freeze({
        status: "committed_unpublished" as const,
        exactCodeHeadSha: requestedHead,
        selectedRaceCount: verified.verification.selectedRaceCount,
        replacementRaceCount: verified.verification.replacementRaceCount,
        quarantinedRaceCountBefore:
          verified.verification.quarantinedRaceCountBefore,
        quarantinedRaceCountAfterEvidence:
          verified.verification.quarantinedRaceCountAfterEvidence,
        providerRequestCount: providerCounter.value,
        storageStatus: stored.storageStatus,
        aggregateRequestsPerMinute:
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
        persistentWritePerformed: stored.storageStatus === "created",
        providerWritePerformed: false as const,
        publicationActivated: false as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        lastGoodBasePreserved: true as const,
      });
    },

    async executeContinuation(invocation) {
      if (
        invocation.commandVersion !==
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        remediationError("not_explicitly_armed");
      }
      const requestedHead = exactHead(invocation.exactCodeHeadSha);
      if (requestedHead !== runtimeCodeHeadSha) {
        remediationError("exact_head_mismatch");
      }
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });
      const cohortObservedAt = timestamp(invocation.cohortObservedAt);
      const loaded = await loadBase({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      const first = await verifyManifest({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });
      const selected = selectContinuationCohort(
        loaded.base.records,
        first.manifest.selectedRaceIds,
      );
      if (selected.length < 1) remediationError("no_quarantine_available");

      const existing = await input.manifestStore.readContinuation({
        baseGenerationId: loaded.audit.authority.generationId,
      });
      if (existing !== null) {
        const verified = await verifyContinuationManifest({
          ownerId,
          exactCodeHeadSha: requestedHead,
          authoritySource: input.authoritySource,
          checkpointRepository: input.checkpointRepository,
          r2Store: input.r2Store,
          manifestStore: input.manifestStore,
          raceDocumentReader: input.raceDocumentReader,
        });
        return Object.freeze({
          status: "existing_verified" as const,
          exactCodeHeadSha: requestedHead,
          cohortOrdinal: 2 as const,
          priorSelectedRaceCount: verified.verification.priorSelectedRaceCount,
          priorReplacementRaceCount:
            verified.verification.priorReplacementRaceCount,
          selectedRaceCount: verified.verification.selectedRaceCount,
          replacementRaceCount: verified.verification.replacementRaceCount,
          baseRecordSetSha256: verified.verification.baseRecordSetSha256,
          selectedRaceSetSha256: verified.verification.selectedRaceSetSha256,
          replacementSetSha256: verified.verification.replacementSetSha256,
          quarantinedRaceCountBefore:
            verified.verification.quarantinedRaceCountBefore,
          quarantinedRaceCountAfterEvidence:
            verified.verification.quarantinedRaceCountAfterEvidence,
          providerRequestCount: existing.providerRequestCount,
          storageStatus: "existing" as const,
          aggregateRequestsPerMinute:
            DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
          persistentWritePerformed: false,
          providerWritePerformed: false as const,
          publicationActivated: false as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          lastGoodBasePreserved: true as const,
        });
      }

      if (
        Date.parse(cohortObservedAt) <= Date.parse(first.manifest.observedAt) ||
        selected.some(
          (record) =>
            Date.parse(cohortObservedAt) <= Date.parse(record.observedAt),
        )
      ) {
        remediationError("invalid_observation_time");
      }

      validateRequestBudget(input.requestBudget);
      let capacity: Awaited<
        ReturnType<
          DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
        >
      >;
      try {
        capacity = await input.capacityGate.assertFreshCurrentCapacity(
          loaded.audit.authority,
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES,
        );
      } catch {
        remediationError("capacity_unavailable");
      }
      validateCapacityApproval(capacity, loaded.audit.authority);
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });

      const providerCounter = { value: 0 };
      let hydration: Awaited<
        ReturnType<typeof hydrateDnaRaceDocumentsWithQuarantine>
      >;
      try {
        hydration = await hydrateDnaRaceDocumentsWithQuarantine({
          raceIds: selected.map((record) => record.sourceRaceId),
          client: input.client,
          requestBudget: boundedRequestBudget(
            input.requestBudget,
            providerCounter,
          ),
          observedAt: cohortObservedAt,
        });
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
          throw error;
        }
        remediationError("hydration_unavailable");
      }
      if (
        providerCounter.value !== hydration.providerRequestCount ||
        hydration.requestedRaceCount !== selected.length ||
        hydration.outcomes.length !== selected.length ||
        providerCounter.value < 1 ||
        providerCounter.value >
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_MAXIMUM_PROVIDER_REQUESTS
      ) {
        remediationError("hydration_unavailable");
      }

      const replacements = Object.freeze(
        hydration.outcomes
          .filter(
            (
              outcome,
            ): outcome is Extract<
              (typeof hydration.outcomes)[number],
              { status: "resolved" }
            > => outcome.status === "resolved",
          )
          .map((outcome) =>
            exactResolvedRecord(
              dnaPopulationEntrantAuthorityRecord(
                outcome.evidence,
              ) as DnaPopulationEntrantAuthorityResolvedRecord,
            ),
          ),
      );

      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });
      const currentBase = await loadBase({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      if (!sameBaseAuthority(loaded, currentBase)) {
        remediationError("authority_drift");
      }
      const currentFirst = await verifyManifest({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });
      if (
        canonicalManifest(currentFirst.manifest) !==
        canonicalManifest(first.manifest)
      ) {
        remediationError("authority_drift");
      }
      const currentSelected = selectContinuationCohort(
        currentBase.base.records,
        currentFirst.manifest.selectedRaceIds,
      );
      if (
        dnaOpenLabRawEvidenceCanonicalJson(currentSelected) !==
        dnaOpenLabRawEvidenceCanonicalJson(selected)
      ) {
        remediationError("authority_drift");
      }

      try {
        capacity = await input.capacityGate.assertFreshCurrentCapacity(
          currentBase.audit.authority,
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES,
        );
      } catch {
        remediationError("capacity_unavailable");
      }
      validateCapacityApproval(capacity, currentBase.audit.authority);
      validateRequestBudget(input.requestBudget);
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: requestedHead,
      });

      const selectedRaceIds = Object.freeze(
        selected.map((record) => record.sourceRaceId),
      );
      const manifest: DnaPopulationEntrantAuthorityRemediationContinuationManifest =
        Object.freeze({
          version: 1 as const,
          status: "retained_private_preview_remediation_continuation" as const,
          baseGenerationId: loaded.audit.authority.generationId,
          baseRecordSetSha256: loaded.replay.recordSetSha256,
          unresolvedRaceCount: loaded.audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256:
            loaded.audit.authority.unresolvedRaceSetSha256,
          cohortOrdinal: 2 as const,
          priorManifestSha256: digest(canonicalManifest(first.manifest)),
          priorSelectedRaceSetSha256: first.manifest.selectedRaceSetSha256,
          observedAt: cohortObservedAt,
          selectedRaceIds,
          selectedRaceSetSha256: raceSetSha256(selectedRaceIds),
          replacements,
          providerRequestCount: providerCounter.value,
          aggregateRequestsPerMinute:
            DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
          previewOnly: true as const,
          publicationActivated: false as const,
          lastGoodBasePreserved: true as const,
          paidUsageAllowed: false as const,
        });

      let stored;
      try {
        stored = await input.manifestStore.writeContinuation(manifest);
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
          throw error;
        }
        remediationError("manifest_unavailable");
      }

      const verified = await verifyContinuationManifest({
        ownerId,
        exactCodeHeadSha: requestedHead,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });

      return Object.freeze({
        status: "committed_unpublished" as const,
        exactCodeHeadSha: requestedHead,
        cohortOrdinal: 2 as const,
        priorSelectedRaceCount: verified.verification.priorSelectedRaceCount,
        priorReplacementRaceCount:
          verified.verification.priorReplacementRaceCount,
        selectedRaceCount: verified.verification.selectedRaceCount,
        replacementRaceCount: verified.verification.replacementRaceCount,
        baseRecordSetSha256: verified.verification.baseRecordSetSha256,
        selectedRaceSetSha256: verified.verification.selectedRaceSetSha256,
        replacementSetSha256: verified.verification.replacementSetSha256,
        quarantinedRaceCountBefore:
          verified.verification.quarantinedRaceCountBefore,
        quarantinedRaceCountAfterEvidence:
          verified.verification.quarantinedRaceCountAfterEvidence,
        providerRequestCount: providerCounter.value,
        storageStatus: stored.storageStatus,
        aggregateRequestsPerMinute:
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
        persistentWritePerformed: stored.storageStatus === "created",
        providerWritePerformed: false as const,
        publicationActivated: false as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        lastGoodBasePreserved: true as const,
      });
    },

    async verifyContinuation() {
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: runtimeCodeHeadSha,
      });
      const verified = await verifyContinuationManifest({
        ownerId,
        exactCodeHeadSha: runtimeCodeHeadSha,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: runtimeCodeHeadSha,
      });
      return verified.verification;
    },

    async verify() {
      const verified = await verifyManifest({
        ownerId,
        exactCodeHeadSha: runtimeCodeHeadSha,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });
      return verified.verification;
    },

    async inspectContinuationReadiness() {
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: runtimeCodeHeadSha,
      });
      const loaded = await loadBase({
        ownerId,
        exactCodeHeadSha: runtimeCodeHeadSha,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      const first = await verifyManifest({
        ownerId,
        exactCodeHeadSha: runtimeCodeHeadSha,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
        manifestStore: input.manifestStore,
        raceDocumentReader: input.raceDocumentReader,
      });
      const nextSelected = selectContinuationCohort(
        loaded.base.records,
        first.manifest.selectedRaceIds,
      );
      if (nextSelected.length < 1) {
        remediationError("no_quarantine_available");
      }

      let capacity: Awaited<
        ReturnType<
          DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
        >
      >;
      try {
        capacity = await input.capacityGate.assertFreshCurrentCapacity(
          loaded.audit.authority,
          DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CAPACITY_RESERVATION_RACES,
        );
      } catch {
        remediationError("capacity_unavailable");
      }
      validateCapacityApproval(capacity, loaded.audit.authority);

      await assertCurrentMain({
        mainGuard: input.mainGuard,
        expectedHeadSha: runtimeCodeHeadSha,
      });
      const currentBase = await loadBase({
        ownerId,
        exactCodeHeadSha: runtimeCodeHeadSha,
        authoritySource: input.authoritySource,
        checkpointRepository: input.checkpointRepository,
        r2Store: input.r2Store,
      });
      if (!sameBaseAuthority(loaded, currentBase)) {
        remediationError("authority_drift");
      }
      const currentNextSelected = selectContinuationCohort(
        currentBase.base.records,
        first.manifest.selectedRaceIds,
      );
      if (
        dnaOpenLabRawEvidenceCanonicalJson(currentNextSelected) !==
        dnaOpenLabRawEvidenceCanonicalJson(nextSelected)
      ) {
        remediationError("authority_drift");
      }

      const remainingUnscannedQuarantineCount =
        loaded.replay.quarantinedRaceCount -
        first.manifest.selectedRaceIds.length -
        nextSelected.length;
      if (
        !Number.isSafeInteger(remainingUnscannedQuarantineCount) ||
        remainingUnscannedQuarantineCount < 0
      ) {
        remediationError("verification_failed");
      }

      return Object.freeze({
        status: "ready_for_continuation" as const,
        exactCodeHeadSha: runtimeCodeHeadSha,
        completedCohortCount: 1 as const,
        nextCohortOrdinal: 2 as const,
        priorSelectedRaceCount: first.manifest.selectedRaceIds.length,
        priorReplacementRaceCount: first.verification.replacementRaceCount,
        nextSelectedRaceCount: nextSelected.length,
        quarantinedRaceCountBefore: loaded.replay.quarantinedRaceCount,
        remainingUnscannedQuarantineCount,
        capacityObservedAt: capacity.observedAt,
        aggregateRequestsPerMinute:
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
        providerRequestPerformed: false as const,
        persistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        publicationActivated: false as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        lastGoodBasePreserved: true as const,
      });
    },
  });
}

export function createDnaPopulationEntrantAuthorityRemediationReplacementSource(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  remediation: Pick<
    ReturnType<typeof createDnaPopulationEntrantAuthorityRemediation>,
    "verify"
  >;
  manifestStore: ReturnType<
    typeof createDnaPopulationEntrantAuthorityRemediationManifestStore
  >;
}): Readonly<{
  inspect: (request: {
    ownerId: string;
    exactCodeHeadSha: string;
    baseGenerationId: string;
    baseRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    quarantinedRaceIds: readonly string[];
  }) => Promise<
    Readonly<{
      version: 1;
      status: "ready";
      observedAt: string;
      baseGenerationId: string;
      baseRecordSetSha256: string;
      unresolvedRaceCount: number;
      unresolvedRaceSetSha256: string;
      replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
      providerRequestPerformed: false;
      persistentWritePerformed: false;
      providerWritePerformed: false;
      paidUsageAllowed: false;
    }>
  >;
}> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const exactCodeHeadSha = exactHead(input.exactCodeHeadSha);
  return Object.freeze({
    async inspect(request) {
      if (
        request.ownerId !== ownerId ||
        request.exactCodeHeadSha !== exactCodeHeadSha
      ) {
        remediationError("verification_failed");
      }
      const verification = await input.remediation.verify();
      if (verification.status !== "verified_replacements") {
        remediationError("verification_failed");
      }
      const manifest = await input.manifestStore.read({
        baseGenerationId: request.baseGenerationId,
      });
      if (
        manifest === null ||
        manifest.baseRecordSetSha256 !== request.baseRecordSetSha256 ||
        manifest.unresolvedRaceCount !== request.unresolvedRaceCount ||
        manifest.unresolvedRaceSetSha256 !== request.unresolvedRaceSetSha256 ||
        manifest.replacements.length !== verification.replacementRaceCount ||
        manifest.replacements.some(
          (replacement) =>
            !request.quarantinedRaceIds.includes(replacement.sourceRaceId),
        )
      ) {
        remediationError("verification_failed");
      }
      return Object.freeze({
        version: 1 as const,
        status: "ready" as const,
        observedAt: manifest.observedAt,
        baseGenerationId: manifest.baseGenerationId,
        baseRecordSetSha256: manifest.baseRecordSetSha256,
        unresolvedRaceCount: manifest.unresolvedRaceCount,
        unresolvedRaceSetSha256: manifest.unresolvedRaceSetSha256,
        replacements: manifest.replacements,
        providerRequestPerformed: false as const,
        persistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
      });
    },
  });
}
