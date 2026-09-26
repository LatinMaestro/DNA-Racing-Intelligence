import { createHash } from "node:crypto";

import {
  buildDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunkReceipt,
} from "./dna-population-entrant-authority-archive";
import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "./dna-population-entrant-authority-checkpoint";
import {
  commitDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityCapacityGate,
  type DnaPopulationEntrantAuthorityR2CommitPort,
} from "./dna-population-entrant-authority-commit-protocol";
import {
  dnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityRecord,
} from "./dna-population-entrant-authority-record";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityRecovery,
} from "./dna-population-entrant-authority-recovery";
import {
  DNA_POPULATION_UNRESOLVED_RACE_MEASUREMENT_SAMPLE_LIMIT,
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "./dna-population-history-acquisition-plan";
import { DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS } from "./dna-population-race-index-r2-chunk";
import {
  DNA_RACE_DOCUMENT_BATCH_LIMIT,
  hydrateDnaRaceDocuments,
} from "./dna-open-lab-race-document-hydrator";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";
import type { DnaPopulationEntrantAuthorityR2PendingChunk } from "./dna-population-entrant-authority-r2-store";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES =
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS;

export type DnaPopulationEntrantAuthorityCohortDiagnostic =
  | "invalid_audited_authority"
  | "audited_authority_mismatch"
  | "recovery_unavailable"
  | "pending_recovery_unavailable"
  | "pending_recovery_mismatch"
  | "authority_already_complete"
  | "recovered_boundary_mismatch"
  | "request_budget_invalid"
  | "hydration_unavailable"
  | "hydration_coverage_mismatch"
  | "compact_record_unavailable"
  | "prepared_chunk_invalid"
  | "commit_unavailable"
  | "commit_receipt_mismatch";

export class DnaPopulationEntrantAuthorityCohortError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityCohortDiagnostic;

  constructor(diagnostic: DnaPopulationEntrantAuthorityCohortDiagnostic) {
    super("Population entrant cohort processing is unavailable");
    this.name = "DnaPopulationEntrantAuthorityCohortError";
    this.diagnostic = diagnostic;
  }
}

export type DnaPopulationEntrantAuthorityPreparedCohortSummary = Readonly<{
  version: 1;
  status: "prepared_uncommitted";
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  recoveredRaceCount: number;
  chunkOrdinal: number;
  selectedRaceCount: number;
  providerRequestCount: number;
  preparationSource: "provider_hydration" | "pending_r2_recovery";
  cohortSha256: string;
  selectedRaceSetSha256: string;
  preparedBodySha256: string;
  preparedRecordSetSha256: string;
  cohortObservedAt: string;
  aggregateRequestsPerMinute: typeof DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  providerRequestPerformed: boolean;
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthorityCommittedCohortSummary = Readonly<{
  version: 1;
  status: "committed";
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  chunkOrdinal: number;
  rowCount: number;
  bodySha256: string;
  raceSetSha256: string;
  recordSetSha256: string;
  storageStatus: "created" | "existing";
  capacityObservedAt: string;
  checkpointRaceCountBefore: number;
  checkpointRaceCountAfter: number;
  authorityComplete: boolean;
  providerRequestPerformed: false;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthorityPreparedCohort = Readonly<{
  summary: DnaPopulationEntrantAuthorityPreparedCohortSummary;
  commit: (input: {
    registeredAt: string;
  }) => Promise<DnaPopulationEntrantAuthorityCommittedCohortSummary>;
}>;

type CohortCheckpointRepository = Pick<
  DnaPopulationEntrantAuthorityCheckpointRepository,
  "read" | "listChunkManifests" | "registerChunk"
>;

export type DnaPopulationEntrantAuthorityCohortR2Port =
  DnaPopulationEntrantAuthorityR2CommitPort &
    Readonly<{
      findPending: (request: {
        generationId: string;
        chunkOrdinal: number;
      }) => Promise<DnaPopulationEntrantAuthorityR2PendingChunk | null>;
    }>;

function cohortError(
  diagnostic: DnaPopulationEntrantAuthorityCohortDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityCohortError(diagnostic);
}

function hash(parts: readonly (string | number)[]): string {
  return createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest("hex");
}

function raceSetSha256(raceIds: readonly string[]): string {
  return hash([
    "dna_open_lab",
    "population_history",
    "unresolved_races",
    ...raceIds,
  ]);
}

function cohortSha256(input: {
  generationId: string;
  chunkOrdinal: number;
  raceIds: readonly string[];
}): string {
  return hash([
    "dna_open_lab",
    "population_history",
    "unresolved_race_cohort",
    input.generationId,
    input.chunkOrdinal,
    ...input.raceIds,
  ]);
}

function safeRaceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    cohortError("invalid_audited_authority");
  }
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string") {
    cohortError("invalid_audited_authority");
  }
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    cohortError("invalid_audited_authority");
  }
  return normalized;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    cohortError("invalid_audited_authority");
  }
  return value;
}

function canonicalTimestamp(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    Number.isNaN(Date.parse(value))
  ) {
    cohortError("invalid_audited_authority");
  }
  return new Date(value).toISOString();
}

function validateAuthority(
  value: DnaPopulationEntrantAuthorityCheckpointAuthority,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  const generationId = sha256(value.generationId);
  const unresolvedRaceSetSha256 = sha256(value.unresolvedRaceSetSha256);
  if (
    value.version !== 1 ||
    generationId !== unresolvedRaceSetSha256 ||
    positive(value.unresolvedRaceCount) !== value.unresolvedRaceCount
  ) {
    cohortError("invalid_audited_authority");
  }
  return Object.freeze({
    version: 1 as const,
    generationId,
    unresolvedRaceCount: value.unresolvedRaceCount,
    unresolvedRaceSetSha256,
  });
}

function validEntrantAuthority(values: readonly string[] | undefined): boolean {
  if (values === undefined || values.length < 1) return false;
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      !POSITIVE_INTEGER_PATTERN.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      seen.has(value)
    ) {
      return false;
    }
    seen.add(value);
  }
  return true;
}

function deriveUnresolvedRaceIds(
  raceDocuments: readonly CanonicalRaceDocumentMetadata[],
): readonly string[] {
  const seen = new Set<string>();
  const unresolved: string[] = [];

  for (const document of raceDocuments) {
    if (document.sourceType !== "race_document") {
      cohortError("invalid_audited_authority");
    }
    const sourceRaceId = safeRaceId(document.sourceRaceId);
    if (seen.has(sourceRaceId)) {
      cohortError("invalid_audited_authority");
    }
    seen.add(sourceRaceId);

    const mode = document.mode;
    if (
      (mode !== "bike" && mode !== "car" && mode !== "horse") ||
      !validEntrantAuthority(document.entrantCoreIds)
    ) {
      unresolved.push(sourceRaceId);
    }
  }

  return Object.freeze(
    unresolved.sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function bindAuditedAuthority(input: {
  plan: DnaPopulationHistoryAcquisitionPlan;
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
}): Readonly<{
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  unresolvedRaceIds: readonly string[];
}> {
  const authority = validateAuthority(input.authority);
  let rederivedPlan: DnaPopulationHistoryAcquisitionPlan;
  try {
    rederivedPlan = planDnaPopulationHistoryAcquisition({
      raceDocuments: input.raceDocuments,
    });
  } catch {
    cohortError("invalid_audited_authority");
  }

  const unresolvedRaceIds = deriveUnresolvedRaceIds(input.raceDocuments);
  if (unresolvedRaceIds.length < 1) {
    cohortError("audited_authority_mismatch");
  }
  const unresolvedRaceSetSha256 = raceSetSha256(unresolvedRaceIds);
  const expectedSample = unresolvedRaceIds.slice(
    0,
    DNA_POPULATION_UNRESOLVED_RACE_MEASUREMENT_SAMPLE_LIMIT,
  );

  if (
    input.plan.status !== "held_incomplete_race_authority" ||
    rederivedPlan.status !== "held_incomplete_race_authority" ||
    input.plan.raceDocumentCount !== input.raceDocuments.length ||
    rederivedPlan.raceDocumentCount !== input.raceDocuments.length ||
    input.plan.unresolvedRaceCount !== unresolvedRaceIds.length ||
    rederivedPlan.unresolvedRaceCount !== unresolvedRaceIds.length ||
    input.plan.unresolvedRaceSetSha256 !== unresolvedRaceSetSha256 ||
    rederivedPlan.unresolvedRaceSetSha256 !== unresolvedRaceSetSha256 ||
    !sameValues(
      input.plan.unresolvedRaceMeasurementSampleIds,
      expectedSample,
    ) ||
    !sameValues(
      rederivedPlan.unresolvedRaceMeasurementSampleIds,
      expectedSample,
    ) ||
    authority.unresolvedRaceCount !== unresolvedRaceIds.length ||
    authority.unresolvedRaceSetSha256 !== unresolvedRaceSetSha256 ||
    authority.generationId !== unresolvedRaceSetSha256
  ) {
    cohortError("audited_authority_mismatch");
  }

  return Object.freeze({ authority, unresolvedRaceIds });
}

function validateRequestBudget(requestBudget: DnaOpenLabRequestBudget): void {
  let snapshot: ReturnType<DnaOpenLabRequestBudget["snapshot"]>;
  try {
    snapshot = requestBudget.snapshot();
  } catch {
    cohortError("request_budget_invalid");
  }
  if (
    !Number.isSafeInteger(snapshot.effectiveRequestsPerMinute) ||
    snapshot.effectiveRequestsPerMinute < 1 ||
    snapshot.effectiveRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
    !Number.isSafeInteger(snapshot.requestsInCurrentWindow) ||
    snapshot.requestsInCurrentWindow < 0
  ) {
    cohortError("request_budget_invalid");
  }
}

function validateRecoveredManifest(input: {
  manifest: DnaPopulationEntrantAuthorityChunkManifest;
  unresolvedRaceIds: readonly string[];
  recoveredOffset: number;
}): void {
  if (
    !Number.isSafeInteger(input.manifest.rowCount) ||
    input.manifest.rowCount < 1
  ) {
    cohortError("recovered_boundary_mismatch");
  }
  const expectedRaceIds = input.unresolvedRaceIds.slice(
    input.recoveredOffset,
    input.recoveredOffset + input.manifest.rowCount,
  );
  if (
    expectedRaceIds.length !== input.manifest.rowCount ||
    input.manifest.firstSourceRaceId !== expectedRaceIds[0] ||
    input.manifest.lastSourceRaceId !== expectedRaceIds.at(-1) ||
    input.manifest.raceSetSha256 !== raceSetSha256(expectedRaceIds)
  ) {
    cohortError("recovered_boundary_mismatch");
  }
}

function validateRecoveredBoundary(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  recovery: DnaPopulationEntrantAuthorityRecovery;
  unresolvedRaceIds: readonly string[];
}): number {
  if (
    input.recovery.authority.generationId !== input.authority.generationId ||
    input.recovery.authority.unresolvedRaceCount !==
      input.authority.unresolvedRaceCount ||
    input.recovery.authority.unresolvedRaceSetSha256 !==
      input.authority.unresolvedRaceSetSha256 ||
    input.recovery.recoveredChunkCount !== input.recovery.manifests.length ||
    input.recovery.nextChunkOrdinal !== input.recovery.manifests.length + 1
  ) {
    cohortError("recovered_boundary_mismatch");
  }

  let recoveredOffset = 0;
  for (const manifest of input.recovery.manifests) {
    validateRecoveredManifest({
      manifest,
      unresolvedRaceIds: input.unresolvedRaceIds,
      recoveredOffset,
    });
    recoveredOffset += manifest.rowCount;
  }

  const expectedBoundary =
    recoveredOffset === 0
      ? null
      : (input.unresolvedRaceIds[recoveredOffset - 1] ?? null);
  if (
    recoveredOffset !== input.recovery.recoveredRaceCount ||
    input.recovery.resumeAfterSourceRaceId !== expectedBoundary ||
    input.recovery.complete !==
      (recoveredOffset === input.authority.unresolvedRaceCount)
  ) {
    cohortError("recovered_boundary_mismatch");
  }
  if (input.recovery.complete) {
    cohortError("authority_already_complete");
  }
  return recoveredOffset;
}

function sameCheckpoint(
  left: DnaPopulationEntrantAuthorityCheckpoint,
  right: DnaPopulationEntrantAuthorityCheckpoint,
): boolean {
  return (
    left.version === right.version &&
    left.generationId === right.generationId &&
    left.unresolvedRaceCount === right.unresolvedRaceCount &&
    left.unresolvedRaceSetSha256 === right.unresolvedRaceSetSha256 &&
    left.chunkCount === right.chunkCount &&
    left.persistedRaceCount === right.persistedRaceCount &&
    left.lastSourceRaceId === right.lastSourceRaceId &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt
  );
}

function sameReceipt(
  left: DnaPopulationEntrantAuthorityChunkReceipt,
  right: DnaPopulationEntrantAuthorityChunkReceipt,
): boolean {
  return (
    left.version === right.version &&
    left.generationId === right.generationId &&
    left.chunkOrdinal === right.chunkOrdinal &&
    left.bodySha256 === right.bodySha256 &&
    left.byteLength === right.byteLength &&
    left.rowCount === right.rowCount &&
    left.firstSourceRaceId === right.firstSourceRaceId &&
    left.lastSourceRaceId === right.lastSourceRaceId &&
    left.raceSetSha256 === right.raceSetSha256 &&
    left.recordSetSha256 === right.recordSetSha256
  );
}

function validatePreparedChunk(input: {
  receipt: DnaPopulationEntrantAuthorityChunkReceipt;
  generationId: string;
  chunkOrdinal: number;
  raceIds: readonly string[];
}): void {
  if (
    input.receipt.generationId !== input.generationId ||
    input.receipt.chunkOrdinal !== input.chunkOrdinal ||
    input.receipt.rowCount !== input.raceIds.length ||
    input.receipt.firstSourceRaceId !== input.raceIds[0] ||
    input.receipt.lastSourceRaceId !== input.raceIds.at(-1) ||
    input.receipt.raceSetSha256 !== raceSetSha256(input.raceIds)
  ) {
    cohortError("prepared_chunk_invalid");
  }
}

function pendingObservedAt(
  pending: DnaPopulationEntrantAuthorityR2PendingChunk,
): string {
  const observed = new Set(
    pending.chunk.records.map((record) => canonicalTimestamp(record.observedAt)),
  );
  if (observed.size !== 1) {
    cohortError("pending_recovery_mismatch");
  }
  return [...observed][0]!;
}

function preparedCohort(input: {
  ownerId: string;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  recovery: DnaPopulationEntrantAuthorityRecovery;
  raceIds: readonly string[];
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  cohortObservedAt: string;
  providerRequestCount: number;
  preparationSource: "provider_hydration" | "pending_r2_recovery";
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: CohortCheckpointRepository;
  r2Store: DnaPopulationEntrantAuthorityCohortR2Port;
}): DnaPopulationEntrantAuthorityPreparedCohort {
  let prepared: ReturnType<typeof buildDnaPopulationEntrantAuthorityChunk>;
  try {
    prepared = buildDnaPopulationEntrantAuthorityChunk({
      generationId: input.authority.generationId,
      chunkOrdinal: input.recovery.nextChunkOrdinal,
      records: input.records,
    });
  } catch {
    cohortError("prepared_chunk_invalid");
  }
  validatePreparedChunk({
    receipt: prepared.receipt,
    generationId: input.authority.generationId,
    chunkOrdinal: input.recovery.nextChunkOrdinal,
    raceIds: input.raceIds,
  });
  if (
    prepared.records.length !== input.raceIds.length ||
    prepared.records.some(
      (record, index) => record.sourceRaceId !== input.raceIds[index],
    )
  ) {
    cohortError("prepared_chunk_invalid");
  }

  const exactRecords = Object.freeze([...prepared.records]);
  const expectedReceipt = Object.freeze({ ...prepared.receipt });
  const checkpointUpdatedAt = canonicalTimestamp(
    input.recovery.checkpoint.updatedAt,
  );
  const summary: DnaPopulationEntrantAuthorityPreparedCohortSummary =
    Object.freeze({
      version: 1 as const,
      status: "prepared_uncommitted" as const,
      authority: input.authority,
      recoveredRaceCount: input.recovery.recoveredRaceCount,
      chunkOrdinal: input.recovery.nextChunkOrdinal,
      selectedRaceCount: input.raceIds.length,
      providerRequestCount: input.providerRequestCount,
      preparationSource: input.preparationSource,
      cohortSha256: cohortSha256({
        generationId: input.authority.generationId,
        chunkOrdinal: input.recovery.nextChunkOrdinal,
        raceIds: input.raceIds,
      }),
      selectedRaceSetSha256: raceSetSha256(input.raceIds),
      preparedBodySha256: expectedReceipt.bodySha256,
      preparedRecordSetSha256: expectedReceipt.recordSetSha256,
      cohortObservedAt: input.cohortObservedAt,
      aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      providerRequestPerformed:
        input.preparationSource === "provider_hydration",
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
    });

  return Object.freeze({
    summary,
    async commit(commitInput) {
      const registeredAt = canonicalTimestamp(commitInput.registeredAt);
      if (
        Date.parse(registeredAt) < Date.parse(input.cohortObservedAt) ||
        Date.parse(registeredAt) < Date.parse(checkpointUpdatedAt)
      ) {
        cohortError("invalid_audited_authority");
      }

      let replayedPrepared: ReturnType<
        typeof buildDnaPopulationEntrantAuthorityChunk
      >;
      try {
        replayedPrepared = buildDnaPopulationEntrantAuthorityChunk({
          generationId: input.authority.generationId,
          chunkOrdinal: input.recovery.nextChunkOrdinal,
          records: exactRecords,
        });
      } catch {
        cohortError("prepared_chunk_invalid");
      }
      if (!sameReceipt(replayedPrepared.receipt, expectedReceipt)) {
        cohortError("prepared_chunk_invalid");
      }

      let committed: Awaited<
        ReturnType<typeof commitDnaPopulationEntrantAuthorityChunk>
      >;
      try {
        committed = await commitDnaPopulationEntrantAuthorityChunk({
          ownerId: input.ownerId,
          authority: input.authority,
          records: exactRecords,
          capacityGate: input.capacityGate,
          checkpointRepository: input.checkpointRepository,
          r2Store: input.r2Store,
          registeredAt,
        });
      } catch {
        cohortError("commit_unavailable");
      }

      if (
        !sameCheckpoint(
          committed.checkpointBefore,
          input.recovery.checkpoint,
        )
      ) {
        cohortError("commit_unavailable");
      }
      if (!sameReceipt(committed.receipt, expectedReceipt)) {
        cohortError("commit_receipt_mismatch");
      }

      return Object.freeze({
        version: 1 as const,
        status: "committed" as const,
        authority: input.authority,
        chunkOrdinal: expectedReceipt.chunkOrdinal,
        rowCount: expectedReceipt.rowCount,
        bodySha256: expectedReceipt.bodySha256,
        raceSetSha256: expectedReceipt.raceSetSha256,
        recordSetSha256: expectedReceipt.recordSetSha256,
        storageStatus: committed.storageStatus,
        capacityObservedAt: committed.capacityObservedAt,
        checkpointRaceCountBefore:
          committed.checkpointBefore.persistedRaceCount,
        checkpointRaceCountAfter: committed.checkpointAfter.persistedRaceCount,
        authorityComplete:
          committed.checkpointAfter.persistedRaceCount ===
          input.authority.unresolvedRaceCount,
        providerRequestPerformed: false as const,
        persistentWritePerformed: true as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
      });
    },
  });
}

export async function prepareDnaPopulationEntrantAuthorityCohort(input: {
  ownerId: string;
  plan: DnaPopulationHistoryAcquisitionPlan;
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: CohortCheckpointRepository;
  r2Store: DnaPopulationEntrantAuthorityCohortR2Port;
  cohortObservedAt: string;
}): Promise<DnaPopulationEntrantAuthorityPreparedCohort> {
  const bound = bindAuditedAuthority({
    plan: input.plan,
    raceDocuments: input.raceDocuments,
    authority: input.authority,
  });

  let recovery: DnaPopulationEntrantAuthorityRecovery;
  try {
    recovery = await recoverDnaPopulationEntrantAuthority({
      ownerId: input.ownerId,
      authority: bound.authority,
      checkpointRepository: input.checkpointRepository,
      r2Store: input.r2Store,
    });
  } catch {
    cohortError("recovery_unavailable");
  }
  const recoveredRaceCount = validateRecoveredBoundary({
    authority: bound.authority,
    recovery,
    unresolvedRaceIds: bound.unresolvedRaceIds,
  });
  const checkpointUpdatedAt = canonicalTimestamp(recovery.checkpoint.updatedAt);

  let pending: DnaPopulationEntrantAuthorityR2PendingChunk | null;
  try {
    pending = await input.r2Store.findPending({
      generationId: bound.authority.generationId,
      chunkOrdinal: recovery.nextChunkOrdinal,
    });
  } catch {
    cohortError("pending_recovery_unavailable");
  }

  if (pending !== null) {
    if (
      !sameReceipt(pending.receipt, pending.chunk.receipt) ||
      pending.receipt.generationId !== bound.authority.generationId ||
      pending.receipt.chunkOrdinal !== recovery.nextChunkOrdinal ||
      pending.receipt.rowCount < 1 ||
      pending.receipt.rowCount >
        DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES
    ) {
      cohortError("pending_recovery_mismatch");
    }
    const raceIds = Object.freeze(
      bound.unresolvedRaceIds.slice(
        recoveredRaceCount,
        recoveredRaceCount + pending.receipt.rowCount,
      ),
    );
    if (
      raceIds.length !== pending.receipt.rowCount ||
      pending.chunk.records.length !== raceIds.length ||
      pending.chunk.records.some(
        (record, index) => record.sourceRaceId !== raceIds[index],
      )
    ) {
      cohortError("pending_recovery_mismatch");
    }
    try {
      validatePreparedChunk({
        receipt: pending.receipt,
        generationId: bound.authority.generationId,
        chunkOrdinal: recovery.nextChunkOrdinal,
        raceIds,
      });
    } catch {
      cohortError("pending_recovery_mismatch");
    }
    const recoveredObservedAt = pendingObservedAt(pending);
    if (Date.parse(recoveredObservedAt) < Date.parse(checkpointUpdatedAt)) {
      cohortError("pending_recovery_mismatch");
    }
    return preparedCohort({
      ownerId: input.ownerId,
      authority: bound.authority,
      recovery,
      raceIds,
      records: pending.chunk.records,
      cohortObservedAt: recoveredObservedAt,
      providerRequestCount: 0,
      preparationSource: "pending_r2_recovery",
      capacityGate: input.capacityGate,
      checkpointRepository: input.checkpointRepository,
      r2Store: input.r2Store,
    });
  }

  const cohortObservedAt = canonicalTimestamp(input.cohortObservedAt);
  if (Date.parse(cohortObservedAt) < Date.parse(checkpointUpdatedAt)) {
    cohortError("invalid_audited_authority");
  }

  const raceIds = Object.freeze(
    bound.unresolvedRaceIds.slice(
      recoveredRaceCount,
      recoveredRaceCount +
        DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES,
    ),
  );
  const expectedBatchCount = Math.ceil(
    raceIds.length / DNA_RACE_DOCUMENT_BATCH_LIMIT,
  );
  if (
    raceIds.length < 1 ||
    raceIds.length > DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES ||
    expectedBatchCount < 1
  ) {
    cohortError("recovered_boundary_mismatch");
  }

  validateRequestBudget(input.requestBudget);

  let hydration: Awaited<ReturnType<typeof hydrateDnaRaceDocuments>>;
  try {
    hydration = await hydrateDnaRaceDocuments({
      raceIds,
      client: input.client,
      requestBudget: input.requestBudget,
      observedAt: cohortObservedAt,
    });
  } catch {
    cohortError("hydration_unavailable");
  }

  validateRequestBudget(input.requestBudget);
  if (
    hydration.requestedRaceCount !== raceIds.length ||
    hydration.documents.length !== raceIds.length ||
    hydration.batchCount !== expectedBatchCount ||
    hydration.documents.some(
      (evidence, index) =>
        evidence.source !== "dna_open_lab" ||
        evidence.sourceVersion !== "v1" ||
        evidence.scope !== "races" ||
        evidence.endpoint !== "races.docs" ||
        evidence.canonical.sourceType !== "race_document" ||
        evidence.canonical.sourceRaceId !== raceIds[index] ||
        evidence.entityKey !== "race:" + raceIds[index],
    )
  ) {
    cohortError("hydration_coverage_mismatch");
  }

  let records: readonly DnaPopulationEntrantAuthorityRecord[];
  try {
    records = Object.freeze(
      hydration.documents.map((evidence) =>
        dnaPopulationEntrantAuthorityRecord(evidence),
      ),
    );
  } catch {
    cohortError("compact_record_unavailable");
  }
  if (
    records.length !== raceIds.length ||
    records.some((record, index) => record.sourceRaceId !== raceIds[index])
  ) {
    cohortError("compact_record_unavailable");
  }

  return preparedCohort({
    ownerId: input.ownerId,
    authority: bound.authority,
    recovery,
    raceIds,
    records,
    cohortObservedAt,
    providerRequestCount: hydration.batchCount,
    preparationSource: "provider_hydration",
    capacityGate: input.capacityGate,
    checkpointRepository: input.checkpointRepository,
    r2Store: input.r2Store,
  });
}
