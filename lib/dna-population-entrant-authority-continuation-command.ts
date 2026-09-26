import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import {
  prepareDnaPopulationEntrantAuthorityCohort,
  type DnaPopulationEntrantAuthorityCohortR2Port,
  type DnaPopulationEntrantAuthorityCommittedCohortSummary,
  type DnaPopulationEntrantAuthorityPreparedCohort,
} from "./dna-population-entrant-authority-cohort";
import type {
  DnaPopulationEntrantAuthorityLiveAudit,
  DnaPopulationEntrantAuthorityLiveAuditSource,
} from "./dna-population-entrant-authority-cohort-command";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
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
    continuationCapacityObservedAt: string;
    durableBoundarySha256: string;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt =
  Readonly<{
    status: "prepared_uncommitted";
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    recoveredChunkCount: number;
    recoveredRaceCount: number;
    chunkOrdinal: number;
    selectedRaceCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    providerRequestCount: number;
    preparationSource: "provider_hydration" | "pending_r2_recovery";
    continuationCapacityObservedAt: string;
    currentCapacityObservedAt: string;
    checkpointUpdatedAt: string;
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
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    recoveredChunkCountBefore: number;
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
    boundaryCapacityObservedAt: string;
    commitCapacityObservedAt: string;
    checkpointUpdatedAtBefore: string;
    durableBoundarySha256: string;
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
  | "invalid_continuation_binding"
  | "stale_continuation_readiness"
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

type ContinuationReadinessSource = Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityContinuationReadinessReceipt>;
}>;

type CohortPreparer = (
  input: Parameters<typeof prepareDnaPopulationEntrantAuthorityCohort>[0],
) => Promise<DnaPopulationEntrantAuthorityPreparedCohort>;

type BoundaryBinding = Readonly<{
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  checkpointUpdatedAt: string;
  capacityObservedAt: string;
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
  diagnostic:
    | "invalid_configuration"
    | "exact_head_mismatch"
    | "authority_head_mismatch",
): string {
  if (typeof value !== "string") commandError(diagnostic);
  const normalized = value.trim().toLowerCase();
  if (normalized !== value || !GIT_OBJECT_ID_PATTERN.test(normalized)) {
    commandError(diagnostic);
  }
  return normalized;
}

function sha256(
  value: string,
  diagnostic: "invalid_continuation_binding" | "authority_binding_mismatch",
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    commandError(diagnostic);
  }
  return value;
}

function exactTimestamp(
  value: string,
  diagnostic: "invalid_observation_time" | "invalid_continuation_binding",
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

function positiveInteger(
  value: number,
  diagnostic: "invalid_continuation_binding",
): number {
  if (!Number.isSafeInteger(value) || value < 1) commandError(diagnostic);
  return value;
}

function sameAuthority(
  left: DnaPopulationEntrantAuthorityCheckpointAuthority,
  right: DnaPopulationEntrantAuthorityCheckpointAuthority,
): boolean {
  return (
    left.version === right.version &&
    left.generationId === right.generationId &&
    left.unresolvedRaceCount === right.unresolvedRaceCount &&
    left.unresolvedRaceSetSha256 === right.unresolvedRaceSetSha256
  );
}

function invocationBoundary(
  invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation,
  requestedHead: string,
  checkedAt: string,
): BoundaryBinding {
  const unresolvedRaceCount = positiveInteger(
    invocation.expectedUnresolvedRaceCount,
    "invalid_continuation_binding",
  );
  const recoveredChunkCount = positiveInteger(
    invocation.expectedRecoveredChunkCount,
    "invalid_continuation_binding",
  );
  const recoveredRaceCount = positiveInteger(
    invocation.expectedRecoveredRaceCount,
    "invalid_continuation_binding",
  );
  const nextChunkOrdinal = positiveInteger(
    invocation.expectedNextChunkOrdinal,
    "invalid_continuation_binding",
  );
  if (
    nextChunkOrdinal !== recoveredChunkCount + 1 ||
    recoveredRaceCount >= unresolvedRaceCount
  ) {
    commandError("invalid_continuation_binding");
  }
  const unresolvedRaceSetSha256 = sha256(
    invocation.expectedUnresolvedRaceSetSha256,
    "invalid_continuation_binding",
  );
  const durableBoundarySha256 = sha256(
    invocation.durableBoundarySha256,
    "invalid_continuation_binding",
  );
  const checkpointUpdatedAt = exactTimestamp(
    invocation.expectedCheckpointUpdatedAt,
    "invalid_continuation_binding",
  );
  const capacityObservedAt = exactTimestamp(
    invocation.continuationCapacityObservedAt,
    "invalid_continuation_binding",
  );
  const checked = Date.parse(checkedAt);
  const observed = Date.parse(capacityObservedAt);
  if (
    observed > checked ||
    checked - observed > DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
  ) {
    commandError("stale_continuation_readiness");
  }
  return Object.freeze({
    exactCodeHeadSha: requestedHead,
    unresolvedRaceCount,
    unresolvedRaceSetSha256,
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal,
    checkpointUpdatedAt,
    capacityObservedAt,
    durableBoundarySha256,
  });
}

function currentBoundary(
  receipt: DnaPopulationEntrantAuthorityContinuationReadinessReceipt,
): BoundaryBinding {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION ||
    receipt.status !== "ready_for_continuation" ||
    receipt.previewOnly !== true ||
    receipt.providerRequestPerformed !== false ||
    receipt.persistentWritePerformed !== false ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false
  ) {
    commandError("continuation_readiness_unavailable");
  }
  const head = exactHead(receipt.exactCodeHeadSha, "exact_head_mismatch");
  const unresolvedRaceCount = positiveInteger(
    receipt.unresolvedRaceCount,
    "invalid_continuation_binding",
  );
  const recoveredChunkCount = positiveInteger(
    receipt.recoveredChunkCount,
    "invalid_continuation_binding",
  );
  const recoveredRaceCount = positiveInteger(
    receipt.recoveredRaceCount,
    "invalid_continuation_binding",
  );
  const nextChunkOrdinal = positiveInteger(
    receipt.nextChunkOrdinal,
    "invalid_continuation_binding",
  );
  if (
    nextChunkOrdinal !== recoveredChunkCount + 1 ||
    recoveredRaceCount >= unresolvedRaceCount
  ) {
    commandError("continuation_readiness_unavailable");
  }
  return Object.freeze({
    exactCodeHeadSha: head,
    unresolvedRaceCount,
    unresolvedRaceSetSha256: sha256(
      receipt.unresolvedRaceSetSha256,
      "invalid_continuation_binding",
    ),
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal,
    checkpointUpdatedAt: exactTimestamp(
      receipt.checkpointUpdatedAt,
      "invalid_continuation_binding",
    ),
    capacityObservedAt: exactTimestamp(
      receipt.capacityObservedAt,
      "invalid_continuation_binding",
    ),
    durableBoundarySha256: sha256(
      receipt.durableBoundarySha256,
      "invalid_continuation_binding",
    ),
  });
}

function sameDurableBoundary(
  expected: BoundaryBinding,
  current: BoundaryBinding,
): boolean {
  return (
    expected.exactCodeHeadSha === current.exactCodeHeadSha &&
    expected.unresolvedRaceCount === current.unresolvedRaceCount &&
    expected.unresolvedRaceSetSha256 === current.unresolvedRaceSetSha256 &&
    expected.recoveredChunkCount === current.recoveredChunkCount &&
    expected.recoveredRaceCount === current.recoveredRaceCount &&
    expected.nextChunkOrdinal === current.nextChunkOrdinal &&
    expected.checkpointUpdatedAt === current.checkpointUpdatedAt &&
    expected.durableBoundarySha256 === current.durableBoundarySha256
  );
}

function preparedReceipt(input: {
  exactCodeHeadSha: string;
  requestedBoundary: BoundaryBinding;
  currentBoundary: BoundaryBinding;
  prepared: DnaPopulationEntrantAuthorityPreparedCohort;
}): DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt {
  const summary = input.prepared.summary;
  return Object.freeze({
    status: "prepared_uncommitted" as const,
    exactCodeHeadSha: input.exactCodeHeadSha,
    cohortObservedAt: summary.cohortObservedAt,
    unresolvedRaceCount: input.currentBoundary.unresolvedRaceCount,
    unresolvedRaceSetSha256: input.currentBoundary.unresolvedRaceSetSha256,
    recoveredChunkCount: input.currentBoundary.recoveredChunkCount,
    recoveredRaceCount: summary.recoveredRaceCount,
    chunkOrdinal: summary.chunkOrdinal,
    selectedRaceCount: summary.selectedRaceCount,
    resolvedRaceCount: summary.resolvedRaceCount,
    quarantinedRaceCount: summary.quarantinedRaceCount,
    providerRequestCount: summary.providerRequestCount,
    preparationSource: summary.preparationSource,
    continuationCapacityObservedAt: input.requestedBoundary.capacityObservedAt,
    currentCapacityObservedAt: input.currentBoundary.capacityObservedAt,
    checkpointUpdatedAt: input.currentBoundary.checkpointUpdatedAt,
    durableBoundarySha256: input.currentBoundary.durableBoundarySha256,
    cohortSha256: summary.cohortSha256,
    selectedRaceSetSha256: summary.selectedRaceSetSha256,
    preparedBodySha256: summary.preparedBodySha256,
    preparedRecordSetSha256: summary.preparedRecordSetSha256,
    aggregateRequestsPerMinute: 30 as const,
    persistentWriteArmed: true as const,
    previewOnly: true as const,
    providerRequestPerformed: summary.providerRequestPerformed,
    entrantChunkPersistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}

function committedReceipt(input: {
  exactCodeHeadSha: string;
  requestedBoundary: BoundaryBinding;
  currentBoundary: BoundaryBinding;
  preparedObservedAt: string;
  result: DnaPopulationEntrantAuthorityCommittedCohortSummary;
}): DnaPopulationEntrantAuthorityContinuationCommandReceipt {
  return Object.freeze({
    status: "committed" as const,
    exactCodeHeadSha: input.exactCodeHeadSha,
    cohortObservedAt: input.preparedObservedAt,
    unresolvedRaceCount: input.currentBoundary.unresolvedRaceCount,
    unresolvedRaceSetSha256: input.currentBoundary.unresolvedRaceSetSha256,
    recoveredChunkCountBefore: input.currentBoundary.recoveredChunkCount,
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
    continuationCapacityObservedAt: input.requestedBoundary.capacityObservedAt,
    boundaryCapacityObservedAt: input.currentBoundary.capacityObservedAt,
    commitCapacityObservedAt: input.result.capacityObservedAt,
    checkpointUpdatedAtBefore: input.currentBoundary.checkpointUpdatedAt,
    durableBoundarySha256: input.currentBoundary.durableBoundarySha256,
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
  continuationReadinessSource: ContinuationReadinessSource;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
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
      const expectedBoundary = invocationBoundary(
        invocation,
        requestedHead,
        checkedAt,
      );

      let readiness: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
      try {
        readiness = await input.continuationReadinessSource.inspect();
      } catch {
        commandError("continuation_readiness_unavailable");
      }
      const current = currentBoundary(readiness);
      const currentCapacityObservedAt = Date.parse(current.capacityObservedAt);
      const checkedAtMilliseconds = Date.parse(checkedAt);
      if (
        currentCapacityObservedAt > checkedAtMilliseconds ||
        checkedAtMilliseconds - currentCapacityObservedAt >
          DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
      ) {
        commandError("continuation_readiness_unavailable");
      }
      if (
        !sameDurableBoundary(expectedBoundary, current) ||
        currentCapacityObservedAt <
          Date.parse(expectedBoundary.capacityObservedAt)
      ) {
        commandError("continuation_boundary_mismatch");
      }

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
      if (
        audit.authority.version !== 1 ||
        audit.authority.generationId !== current.unresolvedRaceSetSha256 ||
        audit.authority.unresolvedRaceCount !== current.unresolvedRaceCount ||
        audit.authority.unresolvedRaceSetSha256 !==
          current.unresolvedRaceSetSha256
      ) {
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
            recoveredChunkCount: current.recoveredChunkCount,
            recoveredRaceCount: current.recoveredRaceCount,
            nextChunkOrdinal: current.nextChunkOrdinal,
            checkpointUpdatedAt: current.checkpointUpdatedAt,
          }),
        });
      } catch {
        commandError("cohort_unavailable");
      }

      const summary = prepared.summary;
      const providerHydration =
        summary.preparationSource === "provider_hydration";
      const pendingRecovery =
        summary.preparationSource === "pending_r2_recovery";
      if (
        summary.status !== "prepared_uncommitted" ||
        !sameAuthority(summary.authority, audit.authority) ||
        summary.recoveredRaceCount !== current.recoveredRaceCount ||
        summary.chunkOrdinal !== current.nextChunkOrdinal ||
        summary.resolvedRaceCount + summary.quarantinedRaceCount !==
          summary.selectedRaceCount ||
        summary.aggregateRequestsPerMinute !== 30 ||
        summary.persistentWritePerformed !== false ||
        summary.providerWritePerformed !== false ||
        summary.paidUsageAllowed !== false ||
        (!providerHydration && !pendingRecovery) ||
        (providerHydration &&
          (summary.cohortObservedAt !== cohortObservedAt ||
            summary.providerRequestPerformed !== true ||
            summary.providerRequestCount < 1)) ||
        (pendingRecovery &&
          (summary.providerRequestPerformed !== false ||
            summary.providerRequestCount !== 0))
      ) {
        commandError("cohort_unavailable");
      }

      const receipt = preparedReceipt({
        exactCodeHeadSha: requestedHead,
        requestedBoundary: expectedBoundary,
        currentBoundary: current,
        prepared,
      });

      let accepted: DnaPopulationEntrantAuthorityContinuationCommandReceipt | null =
        null;
      return Object.freeze({
        prepared: receipt,
        async commit() {
          if (accepted !== null) return accepted;
          const registeredAt = executionTimestamp(now, summary.cohortObservedAt);
          let result: DnaPopulationEntrantAuthorityCommittedCohortSummary;
          try {
            result = await prepared.commit({ registeredAt });
          } catch {
            commandError("cohort_unavailable");
          }
          if (
            !sameAuthority(result.authority, audit.authority) ||
            result.chunkOrdinal !== current.nextChunkOrdinal ||
            result.checkpointRaceCountBefore !== current.recoveredRaceCount ||
            result.checkpointRaceCountAfter !==
              current.recoveredRaceCount + result.rowCount ||
            result.checkpointRaceCountAfter > current.unresolvedRaceCount ||
            result.resolvedRaceCount + result.quarantinedRaceCount !==
              result.rowCount ||
            Date.parse(result.capacityObservedAt) <
              Date.parse(current.capacityObservedAt)
          ) {
            commandError("cohort_unavailable");
          }
          accepted = committedReceipt({
            exactCodeHeadSha: requestedHead,
            requestedBoundary: expectedBoundary,
            currentBoundary: current,
            preparedObservedAt: summary.cohortObservedAt,
            result,
          });
          return accepted;
        },
      });
    },
  });
}
