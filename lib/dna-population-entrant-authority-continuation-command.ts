import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
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
import type { DnaPopulationEntrantAuthorityContinuationReadinessReceipt } from "./dna-population-entrant-authority-continuation-readiness";
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
    readinessCapacityObservedAt: string;
    durableBoundarySha256: string;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt =
  Readonly<{
    status: "prepared_uncommitted";
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    recoveredChunkCount: number;
    recoveredRaceCount: number;
    chunkOrdinal: number;
    selectedRaceCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    providerRequestCount: number;
    preparationSource: "provider_hydration" | "pending_r2_recovery";
    checkpointUpdatedAt: string;
    durableBoundarySha256: string;
    readinessCapacityObservedAt: string;
    revalidatedCapacityObservedAt: string;
    cohortSha256: string;
    selectedRaceSetSha256: string;
    preparedBodySha256: string;
    preparedRecordSetSha256: string;
    aggregateRequestsPerMinute: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: boolean;
    entrantChunkPersistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
    preserveLastGood: true;
  }>;

export type DnaPopulationEntrantAuthorityContinuationCommandReceipt = Readonly<{
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
  checkpointUpdatedAt: string;
  durableBoundarySha256: string;
  readinessCapacityObservedAt: string;
  revalidatedCapacityObservedAt: string;
  commitCapacityObservedAt: string;
  persistentWriteArmed: true;
  previewOnly: true;
  providerRequestPerformed: false;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaPopulationEntrantAuthorityContinuationCommandSession = Readonly<{
  prepared: DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt;
  commit: () => Promise<DnaPopulationEntrantAuthorityContinuationCommandReceipt>;
}>;

export type DnaPopulationEntrantAuthorityContinuationCommandDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "invalid_observation_time"
  | "invalid_boundary_binding"
  | "stale_boundary_binding"
  | "continuation_readiness_unavailable"
  | "durable_boundary_mismatch"
  | "authority_unavailable"
  | "authority_head_mismatch"
  | "authority_binding_mismatch"
  | "preflight_unavailable"
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

export type DnaPopulationEntrantAuthorityContinuationCommandRuntime = Readonly<{
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests" | "registerChunk"
  >;
  r2Store: DnaPopulationEntrantAuthorityCohortR2Port;
}>;

type ContinuationReadinessInspector = Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityContinuationReadinessReceipt>;
}>;

type CohortPreparer = (
  input: Parameters<typeof prepareDnaPopulationEntrantAuthorityCohort>[0],
) => Promise<DnaPopulationEntrantAuthorityPreparedCohort>;

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
    "invalid_configuration" | "exact_head_mismatch" | "authority_head_mismatch",
): string {
  if (typeof value !== "string") commandError(diagnostic);
  const normalized = value.trim().toLowerCase();
  if (normalized !== value || !GIT_OBJECT_ID_PATTERN.test(normalized)) {
    commandError(diagnostic);
  }
  return normalized;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    commandError("invalid_boundary_binding");
  }
  return value;
}

function exactTimestamp(
  value: string,
  diagnostic:
    | "invalid_observation_time"
    | "invalid_boundary_binding"
    | "preflight_unavailable",
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
    commandError("invalid_boundary_binding");
  }
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

function boundaryBinding(input: {
  invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation;
  checkedAt: string;
}) {
  const invocation = input.invocation;
  const unresolvedRaceCount = positiveInteger(
    invocation.expectedUnresolvedRaceCount,
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
    "invalid_boundary_binding",
  );
  const readinessCapacityObservedAt = exactTimestamp(
    invocation.readinessCapacityObservedAt,
    "invalid_boundary_binding",
  );
  const checkedAt = Date.parse(input.checkedAt);
  const capacityObservedAt = Date.parse(readinessCapacityObservedAt);
  if (
    recoveredRaceCount >= unresolvedRaceCount ||
    nextChunkOrdinal !== recoveredChunkCount + 1 ||
    Date.parse(checkpointUpdatedAt) > checkedAt
  ) {
    commandError("invalid_boundary_binding");
  }
  if (
    capacityObservedAt > checkedAt ||
    checkedAt - capacityObservedAt >
      DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
  ) {
    commandError("stale_boundary_binding");
  }
  return Object.freeze({
    exactCodeHeadSha: exactHead(
      invocation.exactCodeHeadSha,
      "exact_head_mismatch",
    ),
    unresolvedRaceCount,
    unresolvedRaceSetSha256: sha256(invocation.expectedUnresolvedRaceSetSha256),
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal,
    checkpointUpdatedAt,
    readinessCapacityObservedAt,
    durableBoundarySha256: sha256(invocation.durableBoundarySha256),
  });
}

function sameBoundary(
  expected: ReturnType<typeof boundaryBinding>,
  actual: DnaPopulationEntrantAuthorityContinuationReadinessReceipt,
): boolean {
  return (
    actual.version ===
      "dna-population-entrant-authority-continuation-readiness/v1" &&
    actual.status === "ready_for_continuation" &&
    actual.exactCodeHeadSha === expected.exactCodeHeadSha &&
    actual.unresolvedRaceCount === expected.unresolvedRaceCount &&
    actual.unresolvedRaceSetSha256 === expected.unresolvedRaceSetSha256 &&
    actual.recoveredChunkCount === expected.recoveredChunkCount &&
    actual.recoveredRaceCount === expected.recoveredRaceCount &&
    actual.nextChunkOrdinal === expected.nextChunkOrdinal &&
    actual.checkpointUpdatedAt === expected.checkpointUpdatedAt &&
    actual.durableBoundarySha256 === expected.durableBoundarySha256 &&
    Date.parse(actual.capacityObservedAt) >=
      Date.parse(expected.readinessCapacityObservedAt) &&
    actual.previewOnly === true &&
    actual.providerRequestPerformed === false &&
    actual.persistentWritePerformed === false &&
    actual.providerWritePerformed === false &&
    actual.paidUsageAllowed === false
  );
}

function capacityObservedAt(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  approval: Awaited<
    ReturnType<
      DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
    >
  >;
}): string {
  const approval = input.approval;
  if (
    approval.version !== 1 ||
    approval.capacityAllowed !== true ||
    approval.paidUsageAllowed !== false ||
    approval.generationId !== input.authority.generationId ||
    approval.unresolvedRaceCount !== input.authority.unresolvedRaceCount ||
    approval.unresolvedRaceSetSha256 !== input.authority.unresolvedRaceSetSha256
  ) {
    commandError("preflight_unavailable");
  }
  return exactTimestamp(approval.observedAt, "preflight_unavailable");
}

function committedReceipt(input: {
  exactCodeHeadSha: string;
  cohortObservedAt: string;
  boundary: ReturnType<typeof boundaryBinding>;
  revalidatedCapacityObservedAt: string;
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
    checkpointUpdatedAt: input.boundary.checkpointUpdatedAt,
    durableBoundarySha256: input.boundary.durableBoundarySha256,
    readinessCapacityObservedAt: input.boundary.readinessCapacityObservedAt,
    revalidatedCapacityObservedAt: input.revalidatedCapacityObservedAt,
    commitCapacityObservedAt: input.result.capacityObservedAt,
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
  continuationReadiness: ContinuationReadinessInspector;
  runtime: DnaPopulationEntrantAuthorityContinuationCommandRuntime;
  now?: () => Date;
  cohortPreparer?: CohortPreparer;
}): Readonly<{
  executeContinuation: (
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
    async executeContinuation(invocation) {
      if (
        invocation.commandVersion !==
          DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        commandError("not_explicitly_armed");
      }

      const cohortObservedAt = exactTimestamp(
        invocation.cohortObservedAt,
        "invalid_observation_time",
      );
      const checkedAt = executionTimestamp(now, cohortObservedAt);
      const boundary = boundaryBinding({ invocation, checkedAt });
      if (boundary.exactCodeHeadSha !== runtimeCodeHeadSha) {
        commandError("exact_head_mismatch");
      }
      if (
        Date.parse(cohortObservedAt) < Date.parse(boundary.checkpointUpdatedAt)
      ) {
        commandError("invalid_observation_time");
      }

      let readiness: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
      try {
        readiness = await input.continuationReadiness.inspect();
      } catch {
        commandError("continuation_readiness_unavailable");
      }
      if (!sameBoundary(boundary, readiness)) {
        commandError("durable_boundary_mismatch");
      }

      let audit: DnaPopulationEntrantAuthorityLiveAudit;
      try {
        audit = await input.authoritySource.load({
          ownerId,
          exactCodeHeadSha: boundary.exactCodeHeadSha,
        });
      } catch {
        commandError("authority_unavailable");
      }
      if (
        audit === null ||
        typeof audit !== "object" ||
        exactHead(audit.exactCodeHeadSha, "authority_head_mismatch") !==
          boundary.exactCodeHeadSha
      ) {
        commandError("authority_head_mismatch");
      }
      if (
        audit.authority.version !== 1 ||
        audit.authority.generationId !== boundary.unresolvedRaceSetSha256 ||
        audit.authority.unresolvedRaceCount !== boundary.unresolvedRaceCount ||
        audit.authority.unresolvedRaceSetSha256 !==
          boundary.unresolvedRaceSetSha256
      ) {
        commandError("authority_binding_mismatch");
      }

      let approval: Awaited<
        ReturnType<
          DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
        >
      >;
      try {
        approval = await input.runtime.capacityGate.assertFreshCurrentCapacity(
          audit.authority,
        );
      } catch {
        commandError("preflight_unavailable");
      }
      const revalidatedCapacityObservedAt = capacityObservedAt({
        authority: audit.authority,
        approval,
      });
      if (
        Date.parse(revalidatedCapacityObservedAt) <
        Date.parse(readiness.capacityObservedAt)
      ) {
        commandError("preflight_unavailable");
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
            recoveredChunkCount: boundary.recoveredChunkCount,
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
        !sameAuthority(prepared.summary.authority, audit.authority) ||
        prepared.summary.recoveredRaceCount !== boundary.recoveredRaceCount ||
        prepared.summary.chunkOrdinal !== boundary.nextChunkOrdinal ||
        prepared.summary.resolvedRaceCount +
          prepared.summary.quarantinedRaceCount !==
          prepared.summary.selectedRaceCount ||
        prepared.summary.aggregateRequestsPerMinute !==
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE ||
        prepared.summary.persistentWritePerformed !== false ||
        prepared.summary.providerWritePerformed !== false ||
        prepared.summary.paidUsageAllowed !== false ||
        (!providerHydration && !pendingRecovery) ||
        (providerHydration &&
          (prepared.summary.cohortObservedAt !== cohortObservedAt ||
            prepared.summary.providerRequestPerformed !== true ||
            prepared.summary.providerRequestCount < 1)) ||
        (pendingRecovery &&
          (prepared.summary.providerRequestPerformed !== false ||
            prepared.summary.providerRequestCount !== 0))
      ) {
        commandError("cohort_unavailable");
      }

      const preparedReceipt = Object.freeze({
        status: "prepared_uncommitted" as const,
        exactCodeHeadSha: boundary.exactCodeHeadSha,
        cohortObservedAt: prepared.summary.cohortObservedAt,
        recoveredChunkCount: boundary.recoveredChunkCount,
        recoveredRaceCount: prepared.summary.recoveredRaceCount,
        chunkOrdinal: prepared.summary.chunkOrdinal,
        selectedRaceCount: prepared.summary.selectedRaceCount,
        resolvedRaceCount: prepared.summary.resolvedRaceCount,
        quarantinedRaceCount: prepared.summary.quarantinedRaceCount,
        providerRequestCount: prepared.summary.providerRequestCount,
        preparationSource: prepared.summary.preparationSource,
        checkpointUpdatedAt: boundary.checkpointUpdatedAt,
        durableBoundarySha256: boundary.durableBoundarySha256,
        readinessCapacityObservedAt: boundary.readinessCapacityObservedAt,
        revalidatedCapacityObservedAt,
        cohortSha256: prepared.summary.cohortSha256,
        selectedRaceSetSha256: prepared.summary.selectedRaceSetSha256,
        preparedBodySha256: prepared.summary.preparedBodySha256,
        preparedRecordSetSha256: prepared.summary.preparedRecordSetSha256,
        aggregateRequestsPerMinute:
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: prepared.summary.providerRequestPerformed,
        entrantChunkPersistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      }) satisfies DnaPopulationEntrantAuthorityContinuationCommandPreparedReceipt;

      let accepted: DnaPopulationEntrantAuthorityContinuationCommandReceipt | null =
        null;
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
            !sameAuthority(result.authority, audit.authority) ||
            result.chunkOrdinal !== boundary.nextChunkOrdinal ||
            result.checkpointRaceCountBefore !== boundary.recoveredRaceCount ||
            result.rowCount !== prepared.summary.selectedRaceCount ||
            result.checkpointRaceCountAfter !==
              boundary.recoveredRaceCount + result.rowCount ||
            result.resolvedRaceCount + result.quarantinedRaceCount !==
              result.rowCount ||
            result.authorityComplete !==
              (result.checkpointRaceCountAfter === boundary.unresolvedRaceCount)
          ) {
            commandError("cohort_unavailable");
          }
          accepted = committedReceipt({
            exactCodeHeadSha: boundary.exactCodeHeadSha,
            cohortObservedAt: prepared.summary.cohortObservedAt,
            boundary,
            revalidatedCapacityObservedAt,
            result,
          });
          return accepted;
        },
      });
    },
  });
}
