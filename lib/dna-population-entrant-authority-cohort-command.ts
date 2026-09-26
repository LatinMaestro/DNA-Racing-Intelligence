import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import {
  prepareDnaPopulationEntrantAuthorityCohort,
  type DnaPopulationEntrantAuthorityCohortR2Port,
  type DnaPopulationEntrantAuthorityCommittedCohortSummary,
  type DnaPopulationEntrantAuthorityPreparedCohort,
} from "./dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";

export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION =
  "dna-population-entrant-authority-cohort-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT =
  "prepare_single_private_preview_unresolved_race_cohort" as const;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthorityLiveAudit = Readonly<{
  exactCodeHeadSha: string;
  plan: DnaPopulationHistoryAcquisitionPlan;
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
}>;

export type DnaPopulationEntrantAuthorityLiveAuditSource = Readonly<{
  load: (request: {
    ownerId: string;
    exactCodeHeadSha: string;
  }) => Promise<DnaPopulationEntrantAuthorityLiveAudit>;
}>;

export type DnaPopulationEntrantAuthorityCohortCommandInvocation = Readonly<{
  commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION;
  intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  cohortObservedAt: string;
}>;

export type DnaPopulationEntrantAuthorityCohortCommandPreparedReceipt =
  Readonly<{
    status: "prepared_uncommitted";
    exactCodeHeadSha: string;
    cohortObservedAt: string;
    recoveredRaceCount: number;
    chunkOrdinal: number;
    selectedRaceCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    providerRequestCount: number;
    preparationSource: "provider_hydration" | "pending_r2_recovery";
    preflightCapacityObservedAt: string;
    checkpointInitializationCompleted: true;
    checkpointChunkCountBeforePreparation: number;
    checkpointRaceCountBeforePreparation: number;
    cohortSha256: string;
    selectedRaceSetSha256: string;
    preparedBodySha256: string;
    preparedRecordSetSha256: string;
    aggregateRequestsPerMinute: 30;
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: boolean;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
    preserveLastGood: true;
  }>;

export type DnaPopulationEntrantAuthorityCohortCommandReceipt = Readonly<{
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
  capacityObservedAt: string;
  persistentWriteArmed: true;
  previewOnly: true;
  providerRequestPerformed: false;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaPopulationEntrantAuthorityCohortCommandSession = Readonly<{
  prepared: DnaPopulationEntrantAuthorityCohortCommandPreparedReceipt;
  commit: () => Promise<DnaPopulationEntrantAuthorityCohortCommandReceipt>;
}>;

export type DnaPopulationEntrantAuthorityCohortCommandDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "invalid_observation_time"
  | "authority_unavailable"
  | "authority_head_mismatch"
  | "preflight_unavailable"
  | "cohort_unavailable";

export class DnaPopulationEntrantAuthorityCohortCommandError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic,
  ) {
    super("Population entrant commissioning command is unavailable");
    this.name = "DnaPopulationEntrantAuthorityCohortCommandError";
    this.diagnostic = diagnostic;
  }
}

export type DnaPopulationEntrantAuthorityCohortCommandRuntime = Readonly<{
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "begin" | "read" | "listChunkManifests" | "registerChunk"
  >;
  r2Store: DnaPopulationEntrantAuthorityCohortR2Port;
}>;

type CohortPreparer = (
  input: Parameters<typeof prepareDnaPopulationEntrantAuthorityCohort>[0],
) => Promise<DnaPopulationEntrantAuthorityPreparedCohort>;

function commandError(
  diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityCohortCommandError(diagnostic);
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
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) commandError(diagnostic);
  return normalized;
}

function exactTimestamp(value: string): string {
  if (typeof value !== "string") commandError("invalid_observation_time");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    commandError("invalid_observation_time");
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

function preflightCapacityObservedAt(input: {
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
    approval.unresolvedRaceSetSha256 !==
      input.authority.unresolvedRaceSetSha256
  ) {
    commandError("preflight_unavailable");
  }
  const parsed = new Date(approval.observedAt);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== approval.observedAt
  ) {
    commandError("preflight_unavailable");
  }
  return parsed.toISOString();
}

function validateInitializedCheckpoint(input: {
  checkpoint: DnaPopulationEntrantAuthorityCheckpoint;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
}): DnaPopulationEntrantAuthorityCheckpoint {
  const checkpoint = input.checkpoint;
  const empty =
    checkpoint.chunkCount === 0 &&
    checkpoint.persistedRaceCount === 0 &&
    checkpoint.lastSourceRaceId === null;
  const populated =
    checkpoint.chunkCount > 0 &&
    checkpoint.persistedRaceCount > 0 &&
    checkpoint.lastSourceRaceId !== null;
  const startedAt = Date.parse(checkpoint.startedAt);
  const updatedAt = Date.parse(checkpoint.updatedAt);
  if (
    !sameAuthority(checkpoint, input.authority) ||
    !Number.isSafeInteger(checkpoint.chunkCount) ||
    checkpoint.chunkCount < 0 ||
    !Number.isSafeInteger(checkpoint.persistedRaceCount) ||
    checkpoint.persistedRaceCount < 0 ||
    checkpoint.persistedRaceCount > input.authority.unresolvedRaceCount ||
    (!empty && !populated) ||
    Number.isNaN(startedAt) ||
    Number.isNaN(updatedAt) ||
    updatedAt < startedAt
  ) {
    commandError("preflight_unavailable");
  }
  return checkpoint;
}

function committedReceipt(input: {
  exactCodeHeadSha: string;
  cohortObservedAt: string;
  result: DnaPopulationEntrantAuthorityCommittedCohortSummary;
}): DnaPopulationEntrantAuthorityCohortCommandReceipt {
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

export function createDnaPopulationEntrantAuthorityCohortCommand(input: {
  configuredOwnerId: string;
  runtimeCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  runtime: DnaPopulationEntrantAuthorityCohortCommandRuntime;
  now?: () => Date;
  cohortPreparer?: CohortPreparer;
}): Readonly<{
  execute: (
    invocation: DnaPopulationEntrantAuthorityCohortCommandInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityCohortCommandSession>;
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
          DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT ||
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

      const cohortObservedAt = exactTimestamp(invocation.cohortObservedAt);
      const preflightStartedAt = executionTimestamp(now, cohortObservedAt);

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

      let approval: Awaited<
        ReturnType<
          DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
        >
      >;
      try {
        approval =
          await input.runtime.capacityGate.assertFreshCurrentCapacity(
            audit.authority,
          );
      } catch {
        commandError("preflight_unavailable");
      }
      const capacityObservedAt = preflightCapacityObservedAt({
        authority: audit.authority,
        approval,
      });

      let initializedCheckpoint: DnaPopulationEntrantAuthorityCheckpoint;
      try {
        initializedCheckpoint = validateInitializedCheckpoint({
          checkpoint: await input.runtime.checkpointRepository.begin(ownerId, {
            authority: audit.authority,
            startedAt: preflightStartedAt,
          }),
          authority: audit.authority,
        });
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityCohortCommandError) {
          throw error;
        }
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
        prepared.summary.resolvedRaceCount +
          prepared.summary.quarantinedRaceCount !==
          prepared.summary.selectedRaceCount ||
        prepared.summary.aggregateRequestsPerMinute !== 30 ||
        prepared.summary.persistentWritePerformed !== false ||
        prepared.summary.providerWritePerformed !== false ||
        prepared.summary.paidUsageAllowed !== false ||
        !sameAuthority(prepared.summary.authority, audit.authority) ||
        prepared.summary.recoveredRaceCount !==
          initializedCheckpoint.persistedRaceCount ||
        prepared.summary.chunkOrdinal !== initializedCheckpoint.chunkCount + 1 ||
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
        exactCodeHeadSha: requestedHead,
        cohortObservedAt: prepared.summary.cohortObservedAt,
        recoveredRaceCount: prepared.summary.recoveredRaceCount,
        chunkOrdinal: prepared.summary.chunkOrdinal,
        selectedRaceCount: prepared.summary.selectedRaceCount,
        resolvedRaceCount: prepared.summary.resolvedRaceCount,
        quarantinedRaceCount: prepared.summary.quarantinedRaceCount,
        providerRequestCount: prepared.summary.providerRequestCount,
        preparationSource: prepared.summary.preparationSource,
        preflightCapacityObservedAt: capacityObservedAt,
        checkpointInitializationCompleted: true as const,
        checkpointChunkCountBeforePreparation: initializedCheckpoint.chunkCount,
        checkpointRaceCountBeforePreparation:
          initializedCheckpoint.persistedRaceCount,
        cohortSha256: prepared.summary.cohortSha256,
        selectedRaceSetSha256: prepared.summary.selectedRaceSetSha256,
        preparedBodySha256: prepared.summary.preparedBodySha256,
        preparedRecordSetSha256: prepared.summary.preparedRecordSetSha256,
        aggregateRequestsPerMinute: 30 as const,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: prepared.summary.providerRequestPerformed,
        persistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      }) satisfies DnaPopulationEntrantAuthorityCohortCommandPreparedReceipt;

      let accepted: DnaPopulationEntrantAuthorityCohortCommandReceipt | null =
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
            result.resolvedRaceCount + result.quarantinedRaceCount !==
              result.rowCount
          ) {
            commandError("cohort_unavailable");
          }
          accepted = committedReceipt({
            exactCodeHeadSha: requestedHead,
            cohortObservedAt: prepared.summary.cohortObservedAt,
            result,
          });
          return accepted;
        },
      });
    },
  });
}
