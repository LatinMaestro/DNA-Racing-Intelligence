import type {
  DnaCoreRaceHistoryAcquisitionRepository,
  StoredDnaCoreRaceHistoryAcquisitionCycle,
} from "./dna-core-race-history-acquisition-cycle";
import type { DnaCoreRaceHistoryPrivateCollectorResult } from "./dna-core-race-history-private-collector";
import { DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES } from "./dna-core-race-history-r2-evidence";
import { loadCompleteDnaCoreRaceHistoryLineage } from "./dna-core-race-history-generation-materializer";
import {
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
  type DnaPopulationCoreHistoryFirstCohortAuthority,
} from "./dna-population-core-history-first-cohort-authority";
import { DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE } from "./dna-open-lab-private-daily-refresh-command";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import { dnaPopulationPersistedCoreSetSha256 } from "./dna-population-history-acquisition-plan";

export const DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION =
  "dna-population-core-history-first-cohort-command/v1" as const;
export const DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT =
  "collect_one_private_preview_population_core_history_cohort" as const;

const MAXIMUM_STEPS = 101;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

export type DnaPopulationCoreHistoryFirstCohortCommandInvocation = Readonly<{
  commandVersion: typeof DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION;
  intent: typeof DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  evaluatedAt: string;
  maximumSteps: number;
  populationCoreSetSha256: string;
  persistedPerformanceCoreSetSha256: string;
  acquisitionCoreSetSha256: string;
  selectedCoreSetSha256: string;
  measurementSliceSha256: string;
}>;

export type DnaPopulationCoreHistoryFirstCohortCollectionStep = (input: {
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  evaluatedAt: string;
  attemptedAt: string;
  budgetWindowId: string;
  maximumAggregateRequestsPerMinute: typeof DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  allowPersistentWrite: true;
  allowPublication: false;
}) => Promise<DnaCoreRaceHistoryPrivateCollectorResult>;

export type DnaPopulationCoreHistoryFirstCohortCommandReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  terminalKind: string;
  stepCount: number;
  exactCodeHeadSha: string;
  evaluatedAt: string;
  refreshCycleId: string;
  budgetWindowId: string;
  preflightSha256: string | null;
  populationCoreSetSha256: string;
  persistedPerformanceCoreSetSha256: string;
  acquisitionCoreSetSha256: string;
  selectedCoreSetSha256: string;
  measurementSliceSha256: string;
  persistentWriteArmed: true;
  collectionOnly: true;
  publicationPerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
  previewOnly: true;
}>;

export type DnaPopulationCoreHistoryFirstCohortVerificationReceipt = Readonly<{
  status: "pass";
  exactCodeHeadSha: string;
  lineageCycleCount: number;
  persistedCoreCountBefore: number;
  persistedCoreCountAfter: number;
  persistedCoreSetSha256Before: string;
  persistedCoreSetSha256After: string;
  selectedCoreSetSha256: string;
  measurementSliceSha256: string;
  collectionComplete: true;
  publicationPerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
  previewOnly: true;
}>;

function commandError(message: string): never {
  throw new Error(`Population Core history first cohort command: ${message}`);
}

function sha256(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    commandError(`${field} is invalid`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  if (typeof value !== "string") commandError(`${field} is invalid`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    commandError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function durableBudgetWindowId(input: {
  ownerId: string;
  startAt: string;
  endAt: string;
}): string {
  const startAt = timestamp(input.startAt, "R2 billing window start");
  const endAt = timestamp(input.endAt, "R2 billing window end");
  if (Date.parse(startAt) >= Date.parse(endAt)) {
    commandError("R2 billing window is invalid");
  }
  return dnaOpenLabRawEvidenceSha256({
    domain: "dna-open-lab-r2-budget-window/v1",
    value: Object.freeze({ ownerId: input.ownerId, startAt, endAt }),
  });
}

function addUsage(
  left: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>,
  right: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>,
) {
  const value = Object.freeze({
    storageBytes: left.storageBytes + right.storageBytes,
    classAOperations: left.classAOperations + right.classAOperations,
    classBOperations: left.classBOperations + right.classBOperations,
  });
  if (
    Object.values(value).some(
      (entry) => !Number.isSafeInteger(entry) || entry < 0,
    )
  ) {
    commandError("capacity projection exceeds safe integer bounds");
  }
  return value;
}

function assertInvocationBinding(input: {
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  invocation: DnaPopulationCoreHistoryFirstCohortCommandInvocation;
}): void {
  const { authority, invocation } = input;
  if (
    authority.authorityVersion !==
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION ||
    invocation.commandVersion !==
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION ||
    invocation.intent !==
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT ||
    invocation.allowPersistentWrite !== true
  ) {
    commandError("is not explicitly armed");
  }
  if (
    invocation.exactCodeHeadSha !== authority.exactCodeHeadSha ||
    !COMMIT_PATTERN.test(invocation.exactCodeHeadSha)
  ) {
    commandError("exact main authority drifted");
  }
  for (const [field, actual, expected] of [
    [
      "population Core set",
      invocation.populationCoreSetSha256,
      authority.populationCoreSetSha256,
    ],
    [
      "persisted Core set",
      invocation.persistedPerformanceCoreSetSha256,
      authority.persistedPerformanceCoreSetSha256,
    ],
    [
      "acquisition Core set",
      invocation.acquisitionCoreSetSha256,
      authority.acquisitionCoreSetSha256,
    ],
    [
      "selected Core set",
      invocation.selectedCoreSetSha256,
      authority.selectedCoreSetSha256,
    ],
    [
      "measurement slice",
      invocation.measurementSliceSha256,
      authority.measurementSliceSha256,
    ],
  ] as const) {
    if (sha256(actual, field) !== expected) {
      commandError(`${field} authority drifted`);
    }
  }
  if (
    authority.coreIds.length !== 1 ||
    authority.capacityPreflightRequired !== true ||
    authority.providerReadAllowed !== false ||
    authority.persistentWriteAllowed !== false ||
    authority.paidUsageAllowed !== false ||
    authority.previewOnly !== true
  ) {
    commandError("selection authority safety drifted");
  }
}

function heldReceipt(input: {
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  evaluatedAt: string;
  refreshCycleId: string;
  budgetWindowId: string;
  terminalKind: string;
  stepCount: number;
  preflightSha256?: string | null;
}): DnaPopulationCoreHistoryFirstCohortCommandReceipt {
  return receipt({ ...input, status: "held" });
}

function receipt(input: {
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  evaluatedAt: string;
  refreshCycleId: string;
  budgetWindowId: string;
  status: "advanced" | "complete" | "held";
  terminalKind: string;
  stepCount: number;
  preflightSha256?: string | null;
}): DnaPopulationCoreHistoryFirstCohortCommandReceipt {
  const { authority } = input;
  return Object.freeze({
    status: input.status,
    terminalKind: input.terminalKind,
    stepCount: input.stepCount,
    exactCodeHeadSha: authority.exactCodeHeadSha,
    evaluatedAt: input.evaluatedAt,
    refreshCycleId: input.refreshCycleId,
    budgetWindowId: input.budgetWindowId,
    preflightSha256: input.preflightSha256 ?? null,
    populationCoreSetSha256: authority.populationCoreSetSha256,
    persistedPerformanceCoreSetSha256:
      authority.persistedPerformanceCoreSetSha256,
    acquisitionCoreSetSha256: authority.acquisitionCoreSetSha256,
    selectedCoreSetSha256: authority.selectedCoreSetSha256,
    measurementSliceSha256: authority.measurementSliceSha256,
    persistentWriteArmed: true as const,
    collectionOnly: true as const,
    publicationPerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
    previewOnly: true as const,
  });
}

export function createDnaPopulationCoreHistoryFirstCohortCommand(input: {
  configuredOwnerId: string;
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  capacityPreflight: DnaOpenLabProviderCapacityPreflight;
  runCollectionStep: DnaPopulationCoreHistoryFirstCohortCollectionStep;
  now?: () => Date;
}) {
  const ownerId = input.configuredOwnerId.trim();
  if (ownerId === "" || ownerId.length > 512) {
    commandError("configured owner is invalid");
  }
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async execute(
      invocation: DnaPopulationCoreHistoryFirstCohortCommandInvocation,
    ): Promise<DnaPopulationCoreHistoryFirstCohortCommandReceipt> {
      assertInvocationBinding({ authority: input.authority, invocation });
      if (
        !Number.isSafeInteger(invocation.maximumSteps) ||
        invocation.maximumSteps < 1 ||
        invocation.maximumSteps > MAXIMUM_STEPS
      ) {
        commandError("step bound is invalid");
      }
      const evaluatedAt = timestamp(invocation.evaluatedAt, "evaluatedAt");
      const startedAt = now();
      if (
        !(startedAt instanceof Date) ||
        Number.isNaN(startedAt.getTime()) ||
        startedAt.getTime() < Date.parse(evaluatedAt)
      ) {
        commandError("execution clock is invalid");
      }
      const refreshCycleId = dnaOpenLabRawEvidenceSha256({
        domain: "population-core-history-first-cohort-command/v1",
        exactCodeHeadSha: input.authority.exactCodeHeadSha,
        populationCoreSetSha256: input.authority.populationCoreSetSha256,
        persistedPerformanceCoreSetSha256:
          input.authority.persistedPerformanceCoreSetSha256,
        acquisitionCoreSetSha256: input.authority.acquisitionCoreSetSha256,
        selectedCoreSetSha256: input.authority.selectedCoreSetSha256,
        measurementSliceSha256: input.authority.measurementSliceSha256,
        evaluatedAt,
      });
      const capacityProbeBudgetWindowId = dnaOpenLabRawEvidenceSha256({
        domain: "population-core-history-first-cohort-command-budget-probe/v1",
        refreshCycleId,
      });
      const plannedR2Usage = addUsage(
        input.authority.projectedPersistentR2Usage,
        Object.freeze({
          storageBytes: DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES,
          classAOperations: 2,
          classBOperations: 7,
        }),
      );
      const inspectCapacity = (budgetWindowId: string) =>
        input.capacityPreflight.inspect({
          preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
          intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
          authenticatedOwnerId: ownerId,
          exactCodeHeadSha: input.authority.exactCodeHeadSha,
          refreshCycleId,
          budgetWindowId,
          projectionHorizon: "single_refresh",
          plannedR2UsagePerRefresh: plannedR2Usage,
          plannedNeonUsagePerRefresh:
            DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
        });
      const capacityProbe = await inspectCapacity(capacityProbeBudgetWindowId);
      if (capacityProbe.status !== "ready") {
        return heldReceipt({
          authority: input.authority,
          evaluatedAt,
          refreshCycleId,
          budgetWindowId: capacityProbeBudgetWindowId,
          terminalKind: `provider_capacity_held:${capacityProbe.reason}`,
          stepCount: 0,
        });
      }
      const budgetWindowId = durableBudgetWindowId({
        ownerId,
        startAt: capacityProbe.projection.billingWindowStartAt,
        endAt: capacityProbe.projection.billingWindowEndAt,
      });
      const capacity =
        budgetWindowId === capacityProbeBudgetWindowId
          ? capacityProbe
          : await inspectCapacity(budgetWindowId);
      if (capacity.status !== "ready") {
        return heldReceipt({
          authority: input.authority,
          evaluatedAt,
          refreshCycleId,
          budgetWindowId,
          terminalKind: `provider_capacity_held:${capacity.reason}`,
          stepCount: 0,
        });
      }
      if (
        capacity.exactCodeHeadSha !== input.authority.exactCodeHeadSha ||
        capacity.refreshCycleId !== refreshCycleId ||
        capacity.budgetWindowId !== budgetWindowId ||
        durableBudgetWindowId({
          ownerId,
          startAt: capacity.projection.billingWindowStartAt,
          endAt: capacity.projection.billingWindowEndAt,
        }) !== budgetWindowId ||
        capacity.readyForRefresh !== true ||
        capacity.persistentWritePerformed !== false ||
        capacity.providerWritePerformed !== false ||
        capacity.paidUsageAllowed !== false ||
        capacity.preserveLastGood !== true
      ) {
        commandError("capacity authority drifted");
      }
      const validUntil = Date.parse(
        timestamp(capacity.validUntil, "validUntil"),
      );
      let stepCount = 0;
      let terminalKind = "step_bound_reached";
      for (let index = 0; index < invocation.maximumSteps; index += 1) {
        const attempted = now();
        if (
          !(attempted instanceof Date) ||
          Number.isNaN(attempted.getTime()) ||
          attempted.getTime() < startedAt.getTime() ||
          attempted.getTime() >= validUntil
        ) {
          return heldReceipt({
            authority: input.authority,
            evaluatedAt,
            refreshCycleId,
            budgetWindowId,
            terminalKind: "provider_capacity_expired",
            stepCount,
            preflightSha256: capacity.preflightSha256,
          });
        }
        const result = await input.runCollectionStep({
          authority: input.authority,
          evaluatedAt,
          attemptedAt: attempted.toISOString(),
          budgetWindowId,
          maximumAggregateRequestsPerMinute:
            DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
          allowPersistentWrite: true,
          allowPublication: false,
        });
        stepCount += 1;
        if (result.kind === "collection_complete") {
          return receipt({
            authority: input.authority,
            evaluatedAt,
            refreshCycleId,
            budgetWindowId,
            status: "complete",
            terminalKind: "collection:collection_complete",
            stepCount,
            preflightSha256: capacity.preflightSha256,
          });
        }
        if (result.kind === "page_advanced") {
          terminalKind = `collection:${result.kind}:${result.source}`;
          continue;
        }
        terminalKind =
          result.kind === "paused"
            ? `collection:paused:${result.reason}`
            : result.kind === "authority_unavailable"
              ? `collection:authority_unavailable:${result.reason}`
              : "collection:attempt_unavailable";
        return heldReceipt({
          authority: input.authority,
          evaluatedAt,
          refreshCycleId,
          budgetWindowId,
          terminalKind,
          stepCount,
          preflightSha256: capacity.preflightSha256,
        });
      }
      return receipt({
        authority: input.authority,
        evaluatedAt,
        refreshCycleId,
        budgetWindowId,
        status: "advanced",
        terminalKind,
        stepCount,
        preflightSha256: capacity.preflightSha256,
      });
    },
  });
}

function latestCycle(
  lineage: readonly StoredDnaCoreRaceHistoryAcquisitionCycle[],
): StoredDnaCoreRaceHistoryAcquisitionCycle {
  const value = lineage.at(-1);
  if (value === undefined) commandError("completed lineage is empty");
  return value;
}

export async function verifyDnaPopulationCoreHistoryFirstCohort(input: {
  authority: DnaPopulationCoreHistoryFirstCohortAuthority;
  commandReceipt: DnaPopulationCoreHistoryFirstCohortCommandReceipt;
  repository: DnaCoreRaceHistoryAcquisitionRepository;
}): Promise<DnaPopulationCoreHistoryFirstCohortVerificationReceipt> {
  const { authority, commandReceipt } = input;
  if (
    commandReceipt.status !== "complete" ||
    commandReceipt.terminalKind !== "collection:collection_complete" ||
    commandReceipt.exactCodeHeadSha !== authority.exactCodeHeadSha ||
    commandReceipt.populationCoreSetSha256 !==
      authority.populationCoreSetSha256 ||
    commandReceipt.persistedPerformanceCoreSetSha256 !==
      authority.persistedPerformanceCoreSetSha256 ||
    commandReceipt.acquisitionCoreSetSha256 !==
      authority.acquisitionCoreSetSha256 ||
    commandReceipt.selectedCoreSetSha256 !== authority.selectedCoreSetSha256 ||
    commandReceipt.measurementSliceSha256 !==
      authority.measurementSliceSha256 ||
    commandReceipt.collectionOnly !== true ||
    commandReceipt.publicationPerformed !== false ||
    commandReceipt.providerWritePerformed !== false ||
    commandReceipt.paidUsageAllowed !== false ||
    commandReceipt.preserveLastGood !== true ||
    commandReceipt.previewOnly !== true
  ) {
    commandError("completed command receipt is invalid");
  }
  const latest = await input.repository.loadLatestComplete();
  if (latest === null)
    commandError("latest complete acquisition is unavailable");
  const lineage = await loadCompleteDnaCoreRaceHistoryLineage({
    repository: input.repository,
    latest,
  });
  if (lineage === null || lineage.length < 2) {
    commandError("complete predecessor lineage is unavailable");
  }
  const stored = latestCycle(lineage);
  const cycle = stored.cycle;
  const [selectedCoreId] = authority.coreIds;
  if (
    selectedCoreId === undefined ||
    cycle.status !== "complete" ||
    cycle.completion === null ||
    cycle.evaluatedAt !== commandReceipt.evaluatedAt ||
    cycle.coreIds.length !== 1 ||
    cycle.coreIds[0] !== selectedCoreId ||
    cycle.completion.completedCoreCount !== 1 ||
    cycle.previousCompletedCycleId === null ||
    lineage.at(-2)?.cycle.cycleId !== cycle.previousCompletedCycleId
  ) {
    commandError("completed first-cohort cycle authority drifted");
  }
  const predecessorCoreIds = [
    ...new Set(lineage.slice(0, -1).flatMap((entry) => entry.cycle.coreIds)),
  ].sort((left, right) => left - right);
  if (
    predecessorCoreIds.length !== authority.persistedPerformanceCoreCount ||
    predecessorCoreIds.includes(selectedCoreId) ||
    dnaPopulationPersistedCoreSetSha256(predecessorCoreIds) !==
      authority.persistedPerformanceCoreSetSha256
  ) {
    commandError("predecessor persisted Core authority drifted");
  }
  const persistedCoreCountAfter = predecessorCoreIds.length + 1;
  if (persistedCoreCountAfter > authority.populationCoreCount) {
    commandError("persisted population coverage exceeds its authority");
  }
  const persistedCoreSetSha256After = dnaPopulationPersistedCoreSetSha256([
    ...predecessorCoreIds,
    selectedCoreId,
  ]);
  if (persistedCoreSetSha256After === null) {
    commandError("completed persisted Core authority is unavailable");
  }
  return Object.freeze({
    status: "pass" as const,
    exactCodeHeadSha: authority.exactCodeHeadSha,
    lineageCycleCount: lineage.length,
    persistedCoreCountBefore: predecessorCoreIds.length,
    persistedCoreCountAfter,
    persistedCoreSetSha256Before: authority.persistedPerformanceCoreSetSha256,
    persistedCoreSetSha256After,
    selectedCoreSetSha256: authority.selectedCoreSetSha256,
    measurementSliceSha256: authority.measurementSliceSha256,
    collectionComplete: true as const,
    publicationPerformed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
    previewOnly: true as const,
  });
}
