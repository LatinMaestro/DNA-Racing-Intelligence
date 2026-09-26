import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import {
  hydrateAndCommitDnaPopulationEntrantAuthorityCohort,
  type DnaPopulationEntrantAuthorityCohortResult,
} from "./dna-population-entrant-authority-cohort";
import type {
  DnaPopulationEntrantAuthorityCapacityGate,
  DnaPopulationEntrantAuthorityR2CommitPort,
} from "./dna-population-entrant-authority-commit-protocol";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";

export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION =
  "dna-population-entrant-authority-cohort-command/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT =
  "execute_single_private_preview_unresolved_race_cohort" as const;

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

export type DnaPopulationEntrantAuthorityCohortCommandReceipt = Readonly<{
  status: "committed";
  exactCodeHeadSha: string;
  cohortObservedAt: string;
  chunkOrdinal: number;
  selectedRaceCount: number;
  providerRequestCount: number;
  cohortSha256: string;
  preparedBodySha256: string;
  preparedRecordSetSha256: string;
  checkpointRaceCountBefore: number;
  checkpointRaceCountAfter: number;
  authorityComplete: boolean;
  storageStatus: "created" | "existing";
  capacityObservedAt: string;
  persistentWriteArmed: true;
  previewOnly: true;
  providerRequestPerformed: true;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaPopulationEntrantAuthorityCohortCommandDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "invalid_observation_time"
  | "authority_unavailable"
  | "authority_head_mismatch"
  | "cohort_unavailable";

export class DnaPopulationEntrantAuthorityCohortCommandError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic;

  constructor(diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic) {
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
    "read" | "listChunkManifests" | "registerChunk"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2CommitPort;
}>;

type CohortRunner = (
  input: Parameters<typeof hydrateAndCommitDnaPopulationEntrantAuthorityCohort>[0],
) => Promise<DnaPopulationEntrantAuthorityCohortResult>;

function commandError(
  diagnostic: DnaPopulationEntrantAuthorityCohortCommandDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityCohortCommandError(diagnostic);
}

function identity(value: string, field: "ownerId"): string {
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

/**
 * Creates the explicit write-armed command boundary for one unresolved-Race
 * entrant-authority cohort.
 *
 * The command never accepts Race IDs or an authority snapshot in its
 * invocation. It reloads the live audited authority after the exact runtime
 * head and write intent are validated, then invokes the proven cohort bridge
 * exactly once. The returned receipt contains only counts, hashes and bounded
 * status fields.
 *
 * This factory is code-only. Environment/credential construction and any
 * connected invocation remain separate commissioning steps.
 */
export function createDnaPopulationEntrantAuthorityCohortCommand(input: {
  configuredOwnerId: string;
  runtimeCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  runtime: DnaPopulationEntrantAuthorityCohortCommandRuntime;
  now?: () => Date;
  cohortRunner?: CohortRunner;
}): Readonly<{
  execute: (
    invocation: DnaPopulationEntrantAuthorityCohortCommandInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityCohortCommandReceipt>;
}> {
  const ownerId = identity(input.configuredOwnerId, "ownerId");
  const runtimeCodeHeadSha = exactHead(
    input.runtimeCodeHeadSha,
    "invalid_configuration",
  );
  const now = input.now ?? (() => new Date());
  const cohortRunner =
    input.cohortRunner ?? hydrateAndCommitDnaPopulationEntrantAuthorityCohort;

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
      const executionAt = now();
      if (
        Number.isNaN(executionAt.getTime()) ||
        Date.parse(cohortObservedAt) > executionAt.getTime()
      ) {
        commandError("invalid_observation_time");
      }
      const registeredAt = executionAt.toISOString();

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
        exactHead(audit.exactCodeHeadSha, "authority_head_mismatch") !==
        requestedHead
      ) {
        commandError("authority_head_mismatch");
      }

      let result: DnaPopulationEntrantAuthorityCohortResult;
      try {
        result = await cohortRunner({
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
          registeredAt,
        });
      } catch {
        commandError("cohort_unavailable");
      }

      return Object.freeze({
        status: "committed" as const,
        exactCodeHeadSha: requestedHead,
        cohortObservedAt,
        chunkOrdinal: result.chunkOrdinal,
        selectedRaceCount: result.selectedRaceCount,
        providerRequestCount: result.providerRequestCount,
        cohortSha256: result.cohortSha256,
        preparedBodySha256: result.preparedBodySha256,
        preparedRecordSetSha256: result.preparedRecordSetSha256,
        checkpointRaceCountBefore: result.checkpointRaceCountBefore,
        checkpointRaceCountAfter: result.checkpointRaceCountAfter,
        authorityComplete: result.authorityComplete,
        storageStatus: result.storageStatus,
        capacityObservedAt: result.capacityObservedAt,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: true as const,
        persistentWritePerformed: true as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      });
    },
  });
}
