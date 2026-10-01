import { createHash } from "node:crypto";

import { DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE } from "./dna-core-race-history-acquisition-cycle";
import { adaptDnaCoreRaceHistoryPage } from "./dna-core-race-history-adapter";
import type { DnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "./dna-core-race-history-acquisition-runner";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import { DnaOpenLabApiError } from "./dna-open-lab-v1-client";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_CORES = 8 as const;
export const DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE =
  100 as const;

type ReadinessHeldReason =
  | "acquisition_plan_not_ready"
  | "api_unavailable"
  | "rate_limited"
  | "invalid_response"
  | "evidence_conflict"
  | "page_bound_reached";

type ReadinessSafety = Readonly<{
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaPopulationCoreHistoryReadOnlyMeasurement = ReadinessSafety &
  Readonly<{
    status: "complete" | "held";
    reason: ReadinessHeldReason | null;
    acquisitionCoreSetSha256: string | null;
    selectedCoreSetSha256: string | null;
    measurementSliceSha256: string | null;
    cohortOrdinal: number;
    cohortOffset: number;
    selectedCoreCount: number;
    completeCoreCount: number;
    providerRequestCount: number;
    sourceRowCount: number;
    acceptedResultCount: number;
    quarantineCount: number;
    replayDuplicateCount: number;
    canonicalResultBytes: number;
    projectedPersistentR2Usage: DnaOpenLabR2Usage;
    selectedCohortFullyMeasured: boolean;
    providerReadPerformed: boolean;
    aggregateRequestsPerMinute: number;
  }>;

const SAFE = Object.freeze({
  persistentWritePerformed: false as const,
  providerWritePerformed: false as const,
  paidUsageAllowed: false as const,
});

function readinessError(message: string): never {
  throw new Error(`Population Core history readiness: ${message}`);
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    readinessError(`${field} is invalid`);
  }
  return value;
}

function add(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    readinessError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function multiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    readinessError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function rowBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function hash(parts: readonly (string | number)[]): string {
  return createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest("hex");
}

function selectedCoreSetSha256(coreIds: readonly number[]): string {
  return hash(["dna_open_lab", "population_core_history", "readiness_core_set", ...coreIds]);
}

function measurementSliceSha256(input: {
  acquisitionCoreSetSha256: string;
  cohortOrdinal: number;
  cohortOffset: number;
  maximumPagesPerCore: number;
  selectedCoreSetSha256: string;
}): string {
  return hash([
    "dna_open_lab",
    "population_core_history_readiness",
    input.acquisitionCoreSetSha256,
    input.cohortOrdinal,
    input.cohortOffset,
    input.maximumPagesPerCore,
    input.selectedCoreSetSha256,
  ]);
}

function projectedUsage(requestCount: number): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.storageBytes,
      "projected R2 storage",
    ),
    classAOperations: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classAOperations,
      "projected R2 Class A",
    ),
    classBOperations: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classBOperations,
      "projected R2 Class B",
    ),
  });
}

function held(input: {
  reason: ReadinessHeldReason;
  plan: DnaPopulationHistoryAcquisitionPlan;
  cohortOrdinal: number;
  cohortOffset: number;
  selectedCoreCount?: number;
  completeCoreCount?: number;
  providerRequestCount?: number;
  sourceRowCount?: number;
  acceptedResultCount?: number;
  quarantineCount?: number;
  replayDuplicateCount?: number;
  canonicalResultBytes?: number;
  selectedCoreSetSha256?: string | null;
  measurementSliceSha256?: string | null;
  aggregateRequestsPerMinute: number;
}): DnaPopulationCoreHistoryReadOnlyMeasurement {
  const providerRequestCount = input.providerRequestCount ?? 0;
  return Object.freeze({
    ...SAFE,
    status: "held" as const,
    reason: input.reason,
    acquisitionCoreSetSha256: input.plan.missingPerformanceCoreSetSha256,
    selectedCoreSetSha256: input.selectedCoreSetSha256 ?? null,
    measurementSliceSha256: input.measurementSliceSha256 ?? null,
    cohortOrdinal: input.cohortOrdinal,
    cohortOffset: input.cohortOffset,
    selectedCoreCount: input.selectedCoreCount ?? 0,
    completeCoreCount: input.completeCoreCount ?? 0,
    providerRequestCount,
    sourceRowCount: input.sourceRowCount ?? 0,
    acceptedResultCount: input.acceptedResultCount ?? 0,
    quarantineCount: input.quarantineCount ?? 0,
    replayDuplicateCount: input.replayDuplicateCount ?? 0,
    canonicalResultBytes: input.canonicalResultBytes ?? 0,
    projectedPersistentR2Usage: projectedUsage(providerRequestCount),
    selectedCohortFullyMeasured: false,
    providerReadPerformed: providerRequestCount > 0,
    aggregateRequestsPerMinute: input.aggregateRequestsPerMinute,
  });
}

function apiHeldReason(error: unknown): ReadinessHeldReason | null {
  if (!(error instanceof DnaOpenLabApiError)) return null;
  switch (error.kind) {
    case "rate_limited":
      return "rate_limited";
    case "api_error":
    case "transport_error":
      return "api_unavailable";
    case "malformed_response":
      return "invalid_response";
    case "invalid_configuration":
    case "invalid_request":
      return null;
  }
}

/**
 * Measures a deterministic slice of the complete all-mode population Core set.
 * A Core is complete only after the provider returns the explicit empty page;
 * short non-empty pages are not treated as terminal. The operation is memory
 * only and projects the conservative R2 reservation that the later persistent
 * cohort would need without writing R2, Neon, or provider state.
 */
export async function measureDnaPopulationCoreHistoryReadOnly(input: {
  plan: DnaPopulationHistoryAcquisitionPlan;
  cohortOrdinal: number;
  cohortOffset?: number;
  maximumCoreCount: number;
  maximumPagesPerCore: number;
  client: DnaCoreRaceHistoryClient;
  requestBudget: DnaOpenLabRequestBudget;
}): Promise<DnaPopulationCoreHistoryReadOnlyMeasurement> {
  const cohortOrdinal = boundedInteger(
    input.cohortOrdinal,
    "cohortOrdinal",
    0,
    Math.max(0, input.plan.cohorts.length - 1),
  );
  const cohortOffset = boundedInteger(
    input.cohortOffset ?? 0,
    "cohortOffset",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const maximumCoreCount = boundedInteger(
    input.maximumCoreCount,
    "maximumCoreCount",
    1,
    DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_CORES,
  );
  const maximumPagesPerCore = boundedInteger(
    input.maximumPagesPerCore,
    "maximumPagesPerCore",
    1,
    Math.min(
      DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE,
      DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
    ),
  );
  const requestSnapshot = input.requestBudget.snapshot();
  if (
    requestSnapshot.effectiveRequestsPerMinute < 1 ||
    requestSnapshot.effectiveRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    readinessError("request budget exceeds the conservative aggregate rate");
  }
  const aggregateRequestsPerMinute = requestSnapshot.effectiveRequestsPerMinute;

  if (
    input.plan.status !== "ready_for_budget_measurement" ||
    input.plan.missingPerformanceCoreSetSha256 === null ||
    input.plan.missingPerformanceCoreCount < 1
  ) {
    return held({
      reason: "acquisition_plan_not_ready",
      plan: input.plan,
      cohortOrdinal,
      cohortOffset,
      aggregateRequestsPerMinute,
    });
  }

  const cohort = input.plan.cohorts[cohortOrdinal];
  if (cohort === undefined || cohortOffset >= cohort.coreIds.length) {
    readinessError("measurement slice is outside its cohort");
  }
  const coreIds = Object.freeze(
    cohort.coreIds.slice(cohortOffset, cohortOffset + maximumCoreCount),
  );
  const selectedHash = selectedCoreSetSha256(coreIds);
  const sliceHash = measurementSliceSha256({
    acquisitionCoreSetSha256: input.plan.missingPerformanceCoreSetSha256,
    cohortOrdinal,
    cohortOffset,
    maximumPagesPerCore,
    selectedCoreSetSha256: selectedHash,
  });

  let completeCoreCount = 0;
  let providerRequestCount = 0;
  let sourceRowCount = 0;
  let acceptedResultCount = 0;
  let quarantineCount = 0;
  let replayDuplicateCount = 0;
  let canonicalResultBytes = 0;

  for (const coreId of coreIds) {
    let terminal = false;
    for (let page = 1; page <= maximumPagesPerCore; page += 1) {
      let response;
      try {
        providerRequestCount = add(
          providerRequestCount,
          1,
          "provider request count",
        );
        response = await input.requestBudget.execute(() =>
          input.client.page({ coreId, page }),
        );
      } catch (error) {
        const reason = apiHeldReason(error);
        if (reason === null) throw error;
        return held({
          reason,
          plan: input.plan,
          cohortOrdinal,
          cohortOffset,
          selectedCoreCount: coreIds.length,
          completeCoreCount,
          providerRequestCount,
          sourceRowCount,
          acceptedResultCount,
          quarantineCount,
          replayDuplicateCount,
          canonicalResultBytes,
          selectedCoreSetSha256: selectedHash,
          measurementSliceSha256: sliceHash,
          aggregateRequestsPerMinute,
        });
      }

      sourceRowCount = add(
        sourceRowCount,
        response.result.length,
        "source row count",
      );
      canonicalResultBytes = add(
        canonicalResultBytes,
        rowBytes(response.result),
        "canonical result bytes",
      );

      const adapted = adaptDnaCoreRaceHistoryPage({
        requestedCoreId: coreId,
        rows: response.result,
        observedAt: new Date().toISOString(),
      });
      if (adapted.status === "held_conflict") {
        return held({
          reason: "evidence_conflict",
          plan: input.plan,
          cohortOrdinal,
          cohortOffset,
          selectedCoreCount: coreIds.length,
          completeCoreCount,
          providerRequestCount,
          sourceRowCount,
          acceptedResultCount,
          quarantineCount,
          replayDuplicateCount,
          canonicalResultBytes,
          selectedCoreSetSha256: selectedHash,
          measurementSliceSha256: sliceHash,
          aggregateRequestsPerMinute,
        });
      }
      acceptedResultCount = add(
        acceptedResultCount,
        adapted.accepted.length,
        "accepted result count",
      );
      quarantineCount = add(
        quarantineCount,
        adapted.quarantined.length,
        "quarantine count",
      );
      replayDuplicateCount = add(
        replayDuplicateCount,
        adapted.replayDuplicateCount,
        "replay duplicate count",
      );

      if (response.result.length === 0) {
        terminal = true;
        completeCoreCount += 1;
        break;
      }
    }
    if (!terminal) {
      return held({
        reason: "page_bound_reached",
        plan: input.plan,
        cohortOrdinal,
        cohortOffset,
        selectedCoreCount: coreIds.length,
        completeCoreCount,
        providerRequestCount,
        sourceRowCount,
        acceptedResultCount,
        quarantineCount,
        replayDuplicateCount,
        canonicalResultBytes,
        selectedCoreSetSha256: selectedHash,
        measurementSliceSha256: sliceHash,
        aggregateRequestsPerMinute,
      });
    }
  }

  return Object.freeze({
    ...SAFE,
    status: "complete" as const,
    reason: null,
    acquisitionCoreSetSha256: input.plan.missingPerformanceCoreSetSha256,
    selectedCoreSetSha256: selectedHash,
    measurementSliceSha256: sliceHash,
    cohortOrdinal,
    cohortOffset,
    selectedCoreCount: coreIds.length,
    completeCoreCount,
    providerRequestCount,
    sourceRowCount,
    acceptedResultCount,
    quarantineCount,
    replayDuplicateCount,
    canonicalResultBytes,
    projectedPersistentR2Usage: projectedUsage(providerRequestCount),
    selectedCohortFullyMeasured: completeCoreCount === coreIds.length,
    providerReadPerformed: providerRequestCount > 0,
    aggregateRequestsPerMinute,
  });
}
