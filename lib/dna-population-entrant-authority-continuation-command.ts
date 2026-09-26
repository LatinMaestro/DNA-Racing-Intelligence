import type { DnaPopulationEntrantAuthorityCheckpointRepository } from "./dna-population-entrant-authority-checkpoint";
import {
  prepareDnaPopulationEntrantAuthorityCohort,
  type DnaPopulationEntrantAuthorityCohortR2Port,
  type DnaPopulationEntrantAuthorityCommittedCohortSummary,
  type DnaPopulationEntrantAuthorityPreparedCohort,
} from "./dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
import type {
  DnaPopulationEntrantAuthorityLiveAudit,
  DnaPopulationEntrantAuthorityLiveAuditSource,
} from "./dna-population-entrant-authority-cohort-command";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
  type DnaPopulationEntrantAuthorityContinuationReadinessReceipt,
} from "./dna-population-entrant-authority-continuation-readiness";
import { DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS } from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";

export const DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION =
  "dna-population-entrant-authority-continuation-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT =
  "continue_one_private_preview_unresolved_race_cohort" as const;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthorityContinuationCommandInvocation =
  Readonly<{
    commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION;
    intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT;
    allowPersistentWrite: true;
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    expectedUnresolvedRaceCount: number;
    expectedUnresolvedRaceSetSha256: string;
    expectedRecoveredChunkCount: number;
    expectedRecoveredRaceCount: number;
    expectedNextChunkOrdinal: number;
    expectedCheckpointUpdatedAt: string;
    expectedDurableBoundarySha256: string;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt =
  Readonly<{
    status: "prepared_uncommitted";
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    recoveredChunkCountBeforePreparation: number;
    recoveredRaceCount: number;
    chunkOrdinal: number;
    selectedRaceCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    providerRequestCount: number;
    preparationSource: "provider_hydration" | "pending_r2_recovery";
    checkpointUpdatedAt: string;
    continuationCapacityObservedAt: string;
    durableBoundarySha256: string;
    cohortSha256: string;
    selectedRaceSetSha256: string;
    preparedBodySha256: string;
    preparedRecordSetSha256: string;
    aggregateRequestsPerMinute: 30;
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: boolean;
    entrantChunkPersistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
    preserveLastGood: true;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandReceipt =
  Readonly<{
    status: "committed";
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    chunkOrdinal: number;
    rowCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    bodySha256: string;
    raceSetSha256: string;
    recordSetSha256: string;
    checkpointRaceCountBefore: number;
    checkpointRaceCountAfter: number;
    authorityComplete: boolean;
    storageStatus: "created" | "existing";
    continuationCapacityObservedAt: string;
    durableBoundarySha256: string;
    capacityObservedAt: string;
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: true;
    providerWritePerformed: false;
    paidUsageAllowed: false;
    preserveLastGood: true;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandSession =
  Readonly<{
    prepared: DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt;
    commit: () => Promise<DnaPopulationEntrantAuthorityContinuationCommandReceipt>;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "invalid_observation_time"
  | "invalid_boundary"
  | "continuation_readiness_unavailable"
  | "continuation_boundary_mismatch"
  | "authority_unavailable"
  | "authority_head_mismatch"
  | "authority_binding_mismatch"
  | "cohort_unavailable";

export class DnaPopulationEntrantAuthorityContinuationCommandError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityContinuationCommandDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthorityContinuationCommandDiagnostic,
  ) {
    super("Population entrant continuation command is unavailable");
    this.name = "DnaPopulationEntrantAuthorityContinuationCommandError";
    this.diagnostic = diagnostic;
  }
}

export type DnaPopulationEntrantAuthorityContinuationCommandRuntime =
  Readonly<{
    client: Pick<DnaOpenLabClient, "raceDocs">;
    requestBudget: DnaOpenLabRequestBudget;
    capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
    checkpointRepository: Pick<
      DnaPopulationEntrantAuthorityCheckpointRepository,
      "read" | "listChunkManifests" | "registerChunk"
    >;
    r2Store: DnaPopulationEntrantAuthorityCohortR2Port;
  }>;

type ContinuationReadinessPort = Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityContinuationReadinessReceipt>;
}>;

type CohortPreparer = (
  input: Parameters<typeof prepareDnaPopulationEntrantAuthorityCohort>[0],
) => Promise<DnaPopulationEntrantAuthorityPreparedCohort>;

type ExpectedBoundary = Readonly<{
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  checkpointUpdatedAt: string;
  durableBoundarySha256: string;
}>;

function commandError(
  diagnostic: DnaPopulationEntrantAuthorityContinuationCommandDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityContinuationCommandError(diagnostic);
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    commandError("invalid_configuration");
  }
  return value;
}

function exactHead(
  value: string,
  diagnostic: "invalid_configuration" | "exact_head_mismatch" | "authority_head_mismatch",
): string {
  if (typeof value !== "string") commandError(diagnostic);
  const normalized = value.trim().toLowerCase();
  if (normalized !== value || !GIT_OBJECT_ID_PATTERN.test(normalized)) {
    commandError(diagnostic);
  }
  return normalized;
}

function exactTimestamp(
  value: string,
  diagnostic:
    | "invalid_observation_time"
    | "invalid_boundary"
    | "continuation_readiness_unavailable",
): string {
  if (typeof value !== "string") commandError(diagnostic);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    commandError(diagnostic);
  }
  return parsed.toISOString();
}

function executionTimestamp(now: () => Date, observedAt: string): string {
  let value: Date;
  try {
    value = now();
  } catch {
    commandError("invalid_observation_time");
  }
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime()) ||
    value.getTime() < Date.parse(observedAt)
  ) {
    commandError("invalid_observation_time");
  }
  return value.toISOString();
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    commandError("invalid_boundary");
  }
  return value;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    commandError("invalid_boundary");
  }
  return value;
}

function expectedBoundary(
  invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation,
): ExpectedBoundary {
  const unresolvedRaceCount = positiveInteger(
    invocation.expectedUnresolvedRaceCount,
  );
  const unresolvedRaceSetSha256 = sha256(
    invocation.expectedUnresolvedRaceSetSha256,
  );
  const recoveredChunkCount = positiveInteger(
    invocation.expectedRecoveredChunkCount,
  );
  const recoveredRaceCount = positiveInteger(
    invocation.expectedRecoveredRaceCount,
  );
  const nextChunkOrdinal = positiveInteger(invocation.expectedNextChunkOrdinal);
  const checkpointUpdatedAt = exactTimestamp(
    invocation.expectedCheckpointUpdatedAt,
    "invalid_boundary",
  );
  const durableBoundarySha256 = sha256(
    invocation.expectedDurableBoundarySha256,
  );
  if (
    recoveredRaceCount >= unresolvedRaceCount ||
    nextChunkOrdinal !== recoveredChunkCount + 1
  ) {
    commandError("invalid_boundary");
  }
  return Object.freeze({
    unresolvedRaceCount,
    unresolvedRaceSetSha256,
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal,
    checkpointUpdatedAt,
    durableBoundarySha256,
  });
}

function sameAuthority(
  audit: DnaPopulationEntrantAuthorityLiveAudit,
  boundary: ExpectedBoundary,
): boolean {
  return (
    audit.authority.version === 1 &&
    audit.authority.generationId === boundary.unresolvedRaceSetSha256 &&
    audit.authority.unresolvedRaceCount === boundary.unresolvedRaceCount &&
    audit.authority.unresolvedRaceSetSha256 ===
      boundary.unresolvedRaceSetSha256
  );
}

function validateReadiness(input: {
  receipt: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
  exactCodeHeadSha: string;
  boundary: ExpectedBoundary;
  checkedAt: string;
}): string {
  const receipt = input.receipt;
  if (
    receipt.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION ||
    receipt.status !== "ready_for_continuation" ||
    receipt.exactCodeHeadSha !== input.exactCodeHeadSha ||
    receipt.unresolvedRaceCount !== input.boundary.unresolvedRaceCount ||
    receipt.unresolvedRaceSetSha256 !==
      input.boundary.unresolvedRaceSetSha256 ||
    receipt.recoveredChunkCount !== input.boundary.recoveredChunkCount ||
    receipt.recoveredRaceCount !== input.boundary.recoveredRaceCount ||
    receipt.nextChunkOrdinal !== input.boundary.nextChunkOrdinal ||
    receipt.checkpointUpdatedAt !== input.boundary.checkpointUpdatedAt ||
    receipt.durableBoundarySha256 !== input.boundary.durableBoundarySha256 ||
    receipt.previewOnly !== true ||
    receipt.providerRequestPerformed !== false ||
    receipt.persistentWritePerformed !== false ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false
  ) {
    commandError("continuation_boundary_mismatch");
  }
  const capacityObservedAt = exactTimestamp(
    receipt.capacityObservedAt,
    "continuation_readiness_unavailable",
  );
  const checkedAt = Date.parse(input.checkedAt);
  const capacityAt = Date.parse(capacityObservedAt);
  if (
    capacityAt > checkedAt ||
    checkedAt - capacityAt >
      DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
  ) {
    commandError("continuation_readiness_unavailable");
  }
  return capacityObservedAt;
}

function committedReceipt(input: {
  exactCodeHeadSha: string;
  cohortObservedAt: string;
  continuationCapacityObservedAt: string;
  durableBoundarySha256: string;
  result: DnaPopulationEntrantAuthorityCommittedCohortSummary;
}): DnaPopulationEntrantAuthorityContinuationCommandReceipt {
  return Object.freeze({
    status: "committed" as const,
    exactCodeHeadSha: input.exactCodeHeadSha,
    cohortObservedAt: input.cohortObservedAt,
    chunkOrdinal: input.result.chunkOrdinal,
    rowCount: input.result.rowCount,
    resolvedRaceCount: input.result.resolvedRaceCount,
    quarantinedRaceCount: input.result.quarantinedRaceCount,
    bodySha256: input.result.bodySha256,
    raceSetSha256: input.result.raceSetSha256,
    recordSetSha256: input.result.recordSetSha256,
    checkpointRaceCountBefore: input.result.checkpointRaceCountBefore,
    checkpointRaceCountAfter: input.result.checkpointRaceCountAfter,
    authorityComplete: input.result.authorityComplete,
    storageStatus: input.result.storageStatus,
    continuationCapacityObservedAt: input.continuationCapacityObservedAt,
    durableBoundarySha256: input.durableBoundarySha256,
    capacityObservedAt: input.result.capacityObservedAt,
    persistentWriteArmed: true as const,
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}

export function createDnaPopulationEntrantAuthorityContinuationCommand(input: {
  configuredOwnerId: string;
  runtimeCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  continuationReadiness: ContinuationReadinessPort;
  runtime: DnaPopulationEntrantAuthorityContinuationCommandRuntime;
  now?: () => Date;
  cohortPreparer?: CohortPreparer;
}): Readonly<{
  execute: (
    invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityContinuationCommandSession>;
}> {
  const ownerId = identity(input.configuredOwnerId);
  const runtimeCodeHeadSha = exactHead(
    input.runtimeCodeHeadSha,
    "invalid_configuration",
  );
  const now = input.now ?? (() => new Date());
  const cohortPreparer =
    input.cohortPreparer ?? prepareDnaPopulationEntrantAuthorityCohort;

  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        commandError("not_explicitly_armed");
      }

      const requestedHead = exactHead(
        invocation.exactCodeHeadSha,
        "exact_head_mismatch",
      );
      if (requestedHead !== runtimeCodeHeadSha) {
        commandError("exact_head_mismatch");
      }

      const cohortObservedAt = exactTimestamp(
        invocation.cohortObservedAt,
        "invalid_observation_time",
      );
      const checkedAt = executionTimestamp(now, cohortObservedAt);
      const boundary = expectedBoundary(invocation);

      let readiness: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
      try {
        readiness = await input.continuationReadiness.inspect();
      } catch {
        commandError("continuation_readiness_unavailable");
      }
      const continuationCapacityObservedAt = validateReadiness({
        receipt: readiness,
        exactCodeHeadSha: requestedHead,
        boundary,
        checkedAt,
      });

      let audit: DnaPopulationEntrantAuthorityLiveAudit;
      try {
        audit = await input.authoritySource.load({
          ownerId,
          exactCodeHeadSha: requestedHead,
        });
      } catch {
        commandError("authority_unavailable");
      }
      if (
        audit === null ||
        typeof audit !== "object" ||
        exactHead(audit.exactCodeHeadSha, "authority_head_mismatch") !==
          requestedHead
      ) {
        commandError("authority_head_mismatch");
      }
      if (!sameAuthority(audit, boundary)) {
        commandError("authority_binding_mismatch");
      }

      let prepared: DnaPopulationEntrantAuthorityPreparedCohort;
      try {
        prepared = await cohortPreparer({
          ownerId,
          plan: audit.plan,
          raceDocuments: audit.raceDocuments,
          authority: audit.authority,
          client: input.runtime.client,
          requestBudget: input.runtime.requestBudget,
          capacityGate: input.runtime.capacityGate,
          checkpointRepository: input.runtime.checkpointRepository,
          r2Store: input.runtime.r2Store,
          cohortObservedAt,
          expectedRecoveryBoundary: Object.freeze({
            recoveredRaceCount: boundary.recoveredRaceCount,
            nextChunkOrdinal: boundary.nextChunkOrdinal,
            checkpointUpdatedAt: boundary.checkpointUpdatedAt,
          }),
        });
      } catch {
        commandError("cohort_unavailable");
      }

      const providerHydration =
        prepared.summary.preparationSource === "provider_hydration";
      const pendingRecovery =
        prepared.summary.preparationSource === "pending_r2_recovery";
      if (
        prepared.summary.status !== "prepared_uncommitted" ||
        !sameAuthority(
          Object.freeze({
            exactCodeHeadSha: requestedHead,
            plan: audit.plan,
            raceDocuments: audit.raceDocuments,
            authority: prepared.summary.authority,
          }),
          boundary,
        ) ||
        prepared.summary.recoveredRaceCount !== boundary.recoveredRaceCount ||
        prepared.summary.chunkOrdinal !== boundary.nextChunkOrdinal ||
        prepared.summary.selectedRaceCount < 1 ||
        prepared.summary.resolvedRaceCount +
          prepared.summary.quarantinedRaceCount !==
          prepared.summary.selectedRaceCount ||
        prepared.summary.aggregateRequestsPerMinute !== 30 ||
        prepared.summary.persistentWritePerformed !== false ||
        prepared.summary.providerWritePerformed !== false ||
        prepared.summary.paidUsageAllowed !== false ||
        (!providerHydration && !pendingRecovery) ||
        (providerHydration &&
          (prepared.summary.providerRequestPerformed !== true ||
            prepared.summary.providerRequestCount < 1)) ||
        (pendingRecovery &&
          (prepared.summary.providerRequestPerformed !== false ||
            prepared.summary.providerRequestCount !== 0))
      ) {
        commandError("cohort_unavailable");
      }

      const preparedReceipt = Object.freeze({
        status: "prepared_uncommitted" as const,
        exactCodeHeadSha: requestedHead,
        cohortObservedAt: prepared.summary.cohortObservedAt,
        recoveredChunkCountBeforePreparation: boundary.recoveredChunkCount,
        recoveredRaceCount: prepared.summary.recoveredRaceCount,
        chunkOrdinal: prepared.summary.chunkOrdinal,
        selectedRaceCount: prepared.summary.selectedRaceCount,
        resolvedRaceCount: prepared.summary.resolvedRaceCount,
        quarantinedRaceCount: prepared.summary.quarantinedRaceCount,
        providerRequestCount: prepared.summary.providerRequestCount,
        preparationSource: prepared.summary.preparationSource,
        checkpointUpdatedAt: boundary.checkpointUpdatedAt,
        continuationCapacityObservedAt,
        durableBoundarySha256: boundary.durableBoundarySha256,
        cohortSha256: prepared.summary.cohortSha256,
        selectedRaceSetSha256: prepared.summary.selectedRaceSetSha256,
        preparedBodySha256: prepared.summary.preparedBodySha256,
        preparedRecordSetSha256: prepared.summary.preparedRecordSetSha256,
        aggregateRequestsPerMinute: 30 as const,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: prepared.summary.providerRequestPerformed,
        entrantChunkPersistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      }) satisfies DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt;

      let accepted:
        | DnaPopulationEntrantAuthorityContinuationCommandReceipt
        | null = null;
      return Object.freeze({
        prepared: preparedReceipt,
        async commit() {
          if (accepted !== null) return accepted;
          const registeredAt = executionTimestamp(
            now,
            prepared.summary.cohortObservedAt,
          );
          let result: DnaPopulationEntrantAuthorityCommittedCohortSummary;
          try {
            result = await prepared.commit({ registeredAt });
          } catch {
            commandError("cohort_unavailable");
          }
          if (
            result.authority.version !== 1 ||
            result.authority.generationId !==
              boundary.unresolvedRaceSetSha256 ||
            result.authority.unresolvedRaceCount !==
              boundary.unresolvedRaceCount ||
            result.authority.unresolvedRaceSetSha256 !==
              boundary.unresolvedRaceSetSha256 ||
            result.chunkOrdinal !== boundary.nextChunkOrdinal ||
            result.checkpointRaceCountBefore !== boundary.recoveredRaceCount ||
            result.checkpointRaceCountAfter !==
              boundary.recoveredRaceCount + result.rowCount ||
            result.resolvedRaceCount + result.quarantinedRaceCount !==
              result.rowCount
          ) {
            commandError("cohort_unavailable");
          }
          accepted = committedReceipt({
            exactCodeHeadSha: requestedHead,
            cohortObservedAt: prepared.summary.cohortObservedAt,
            continuationCapacityObservedAt,
            durableBoundarySha256: boundary.durableBoundarySha256,
            result,
          });
          return accepted;
        },
      });
    },
  });
}
