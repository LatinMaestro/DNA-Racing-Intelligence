import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import { DnaFinishedRaceWindowCrawlerError } from "./dna-open-lab-finished-race-window-crawler";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5FirstBackfillMeasurement,
  type DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence,
} from "./dna-open-lab-p5-first-backfill-measurement-invocation";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
  type DnaOpenLabP5FirstBackfillAuthorityClass,
  type DnaOpenLabP5FirstBackfillFamilyMeasurement,
  type DnaOpenLabP5FirstBackfillMeasurementInput,
  type DnaOpenLabP5FirstBackfillSourceFamily,
} from "./dna-open-lab-p5-first-backfill-measurement";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
  type DnaOpenLabScope,
} from "./dna-open-lab-v1-client";
/*
 * A malformed envelope is not evidence of a malformed race row. It can be a
 * transient provider/transport response, so the read-only commissioning
 * inventory retries the exact request through the same aggregate budget. A
 * persistent malformed envelope still fails closed and cannot be counted as
 * an owner-approved omitted race observation.
 */
export const DNA_OPEN_LAB_P5_MALFORMED_RESPONSE_MAX_ATTEMPTS = 3 as const;

const MAXIMUM_OBSERVED_RESPONSE_BYTES = 8 * 1024 * 1024 * 1024;

export const DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE =
  150 as const;

export type DnaOpenLabP5TemporaryCommissioningRateAuthorization = Readonly<{
  kind: "owner_approved_one_run_non_persistent_measurement";
  maximumAggregateRequestsPerMinute: typeof DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE;
}>;

const FAMILY_AUTHORITY: Readonly<
  Record<
    DnaOpenLabP5FirstBackfillSourceFamily,
    Readonly<{
      authorityClass: DnaOpenLabP5FirstBackfillAuthorityClass;
      scopes: readonly DnaOpenLabScope[];
    }>
  >
> = Object.freeze({
  finished_races: Object.freeze({
    authorityClass: "available_paginated_history_at_cutoff",
    scopes: Object.freeze(["races"] as const),
  }),
  race_activity: Object.freeze({
    authorityClass: "current_state_only",
    scopes: Object.freeze(["races"] as const),
  }),
  token_prices: Object.freeze({
    authorityClass: "current_state_only",
    scopes: Object.freeze(["tokens"] as const),
  }),
  vault_identity: Object.freeze({
    authorityClass: "bounded_recent_state_only",
    scopes: Object.freeze(["vault"] as const),
  }),
  core_current_state: Object.freeze({
    authorityClass: "current_state_only",
    scopes: Object.freeze(["cores"] as const),
  }),
  splice_arena: Object.freeze({
    authorityClass: "current_state_only",
    scopes: Object.freeze(["splice"] as const),
  }),
});

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_INVENTORY_PROGRESS_STAGES =
  Object.freeze([
    "finished_races_complete",
    "race_activity_complete",
    "token_prices_complete",
    "vault_identity_complete",
    "core_current_state_complete",
    "splice_arena_complete",
    "cleanup_verified",
    "aggregate_evidence_emitted",
  ] as const);

export type DnaOpenLabP5FirstBackfillInventoryProgressStage =
  (typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_INVENTORY_PROGRESS_STAGES)[number];

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_FAILURE_CODES = Object.freeze([
  "api_invalid_configuration",
  "api_invalid_request",
  "api_malformed_response",
  "api_error",
  "api_rate_limited",
  "finished_race_invalid_window",
  "finished_race_invalid_record",
  "finished_race_source_limit_breach",
  "finished_race_unprovable_saturation",
  "finished_race_unprovable_fetch_failure",
  "finished_race_conflicting_duplicate",
  "inventory_validation",
  "family_adapter_validation",
  "unexpected_error",
] as const);

export type DnaOpenLabP5FirstBackfillFailureCode =
  (typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_FAILURE_CODES)[number];

export type DnaOpenLabP5FirstBackfillInventoryDiagnostic =
  | Readonly<{
      kind: "request_milestone";
      family: DnaOpenLabP5FirstBackfillSourceFamily;
      completedFamilyCount: number;
      familyApiRequestCount: number;
      totalApiRequestCount: number;
    }>
  | Readonly<{
      kind: "acquisition_failed";
      family: DnaOpenLabP5FirstBackfillSourceFamily;
      failureCode: DnaOpenLabP5FirstBackfillFailureCode;
      completedFamilyCount: number;
      familyApiRequestCount: number;
      totalApiRequestCount: number;
      rateLimitedRequestCount: number;
    }>;

export type DnaOpenLabP5FirstBackfillInventoryRequest = <T>(input: {
  scope: DnaOpenLabScope;
  request: (
    client: DnaOpenLabClient,
    laneId: string,
  ) => Promise<DnaOpenLabResponse<T>>;
}) => Promise<T>;

export type DnaOpenLabP5FirstBackfillFamilyInventoryResult = Readonly<{
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  authorityClass: DnaOpenLabP5FirstBackfillAuthorityClass;
  observedAt: string;
  terminalInventoryObserved: boolean;
  observedSourceRecordCount: number;
  unresolvedIdentityObservationUpperBound: number;
  sourceRecordUpperBound: number;
  apiRequestUpperBound: number;
  retainedR2BytesUpperBound: number;
  classAOperationsUpperBound: number;
  classBOperationsUpperBound: number;
  neonIncrementalBytesUpperBound: number;
  evidenceRef: string;
}>;

export type DnaOpenLabP5FirstBackfillInventoryCleanup = Readonly<{
  persistentOwnerDataWriteCount: number;
  temporaryProviderResidueCount: number;
  rawPayloadIncludedInEvidence: boolean;
  secretMaterialIncludedInEvidence: boolean;
}>;

type MeasurementMetadata = Omit<
  DnaOpenLabP5FirstBackfillMeasurementInput,
  | "families"
  | "persistentOwnerDataWriteCount"
  | "temporaryProviderResidueCount"
  | "rawPayloadIncludedInEvidence"
  | "secretMaterialIncludedInEvidence"
>;

function runnerError(): never {
  throw new Error("DNA Open Lab P5 first backfill inventory runner failed.");
}

function failureCode(error: unknown): DnaOpenLabP5FirstBackfillFailureCode {
  if (error instanceof DnaOpenLabApiError) {
    return error.kind === "api_error" ? "api_error" : `api_${error.kind}`;
  }
  if (error instanceof DnaFinishedRaceWindowCrawlerError) {
    return `finished_race_${error.kind}`;
  }
  if (
    error instanceof Error &&
    error.message === "DNA Open Lab P5 first backfill inventory runner failed."
  ) {
    return "inventory_validation";
  }
  if (
    error instanceof Error &&
    error.message === "DNA Open Lab P5 first backfill family adapter failed."
  ) {
    return "family_adapter_validation";
  }
  return "unexpected_error";
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) runnerError();
  return value;
}

function positiveCount(value: number): number {
  const result = count(value);
  if (result < 1) runnerError();
  return result;
}

function add(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) runnerError();
  return result;
}

function responseBytes(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return runnerError();
  }
  if (serialized === undefined) runnerError();
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAXIMUM_OBSERVED_RESPONSE_BYTES) runnerError();
  return bytes;
}

function verifyPool(
  pool: DnaOpenLabClientPool,
  authorization?: DnaOpenLabP5TemporaryCommissioningRateAuthorization,
): void {
  const maximumRequestsPerMinute =
    authorization === undefined
      ? DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
      : authorization.kind ===
            "owner_approved_one_run_non_persistent_measurement" &&
          authorization.maximumAggregateRequestsPerMinute ===
            DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE
        ? DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE
        : runnerError();
  const snapshot = pool.snapshot();
  if (
    snapshot.independentRateBucketsEnabled ||
    snapshot.aggregateBudget === null ||
    snapshot.aggregateBudget.effectiveRequestsPerMinute >
      maximumRequestsPerMinute ||
    snapshot.lanes.length < 1 ||
    snapshot.lanes.length > 3 ||
    snapshot.lanes.some(
      (lane) =>
        lane.budget.effectiveRequestsPerMinute > maximumRequestsPerMinute,
    )
  ) {
    runnerError();
  }
}

function totalPoolRequestCount(pool: DnaOpenLabClientPool): number {
  return pool
    .snapshot()
    .lanes.reduce((total, lane) => add(total, count(lane.requestCount)), 0);
}

function totalPoolRateLimitedCount(pool: DnaOpenLabClientPool): number {
  return pool
    .snapshot()
    .lanes.reduce((total, lane) => add(total, count(lane.rateLimitedCount)), 0);
}

function cleanup(value: DnaOpenLabP5FirstBackfillInventoryCleanup): void {
  if (
    count(value.persistentOwnerDataWriteCount) !== 0 ||
    count(value.temporaryProviderResidueCount) !== 0 ||
    value.rawPayloadIncludedInEvidence ||
    value.secretMaterialIncludedInEvidence
  ) {
    runnerError();
  }
}

/**
 * Runs the six-family non-persistent inventory in one fixed sequence. Every API
 * request must pass through the conservative aggregate client pool. Raw
 * responses are visible only to the in-memory family measurer; the runner
 * retains counts and byte totals and emits only the sanitized aggregate record.
 */
export async function runDnaOpenLabP5FirstBackfillInventory(input: {
  clientPool: DnaOpenLabClientPool;
  measurement: MeasurementMetadata;
  temporaryCommissioningRateAuthorization?: DnaOpenLabP5TemporaryCommissioningRateAuthorization;
  measurementCompletedAt?: () => string;
  measureFamily: (input: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    request: DnaOpenLabP5FirstBackfillInventoryRequest;
  }) => Promise<DnaOpenLabP5FirstBackfillFamilyInventoryResult>;
  cleanupMeasurement: () => Promise<DnaOpenLabP5FirstBackfillInventoryCleanup>;
  emitEvidence: (canonicalJson: string) => Promise<void>;
  recordProgress?: (
    stage: DnaOpenLabP5FirstBackfillInventoryProgressStage,
  ) => void;
  recordDiagnostic?: (
    diagnostic: DnaOpenLabP5FirstBackfillInventoryDiagnostic,
  ) => void;
  requestDiagnosticInterval?: number;
}): Promise<DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence> {
  verifyPool(input.clientPool, input.temporaryCommissioningRateAuthorization);
  const requestDiagnosticInterval = positiveCount(
    input.requestDiagnosticInterval ?? 500,
  );
  const initialPoolRequestCount = totalPoolRequestCount(input.clientPool);
  const families: DnaOpenLabP5FirstBackfillFamilyMeasurement[] = [];
  let acquisitionFailure = false;
  let activeFamily: DnaOpenLabP5FirstBackfillSourceFamily = "finished_races";
  let activeFamilyRequestCount = 0;

  try {
    for (const family of DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES) {
      activeFamily = family;
      activeFamilyRequestCount = 0;
      const authority = FAMILY_AUTHORITY[family];
      let observedApiRequestCount = 0;
      let successfulLogicalRequestCount = 0;
      let observedResponseBytes = 0;
      const request: DnaOpenLabP5FirstBackfillInventoryRequest = async <T>({
        scope,
        request: execute,
      }: {
        scope: DnaOpenLabScope;
        request: (
          client: DnaOpenLabClient,
          laneId: string,
        ) => Promise<DnaOpenLabResponse<T>>;
      }): Promise<T> => {
        if (!authority.scopes.includes(scope)) runnerError();
        const recordRequestAttempt = (): void => {
          observedApiRequestCount = add(observedApiRequestCount, 1);
          activeFamilyRequestCount = observedApiRequestCount;
          if (observedApiRequestCount % requestDiagnosticInterval === 0) {
            input.recordDiagnostic?.(
              Object.freeze({
                kind: "request_milestone",
                family,
                completedFamilyCount: families.length,
                familyApiRequestCount: observedApiRequestCount,
                totalApiRequestCount:
                  totalPoolRequestCount(input.clientPool) -
                  initialPoolRequestCount,
              }),
            );
          }
        };
        for (
          let attempt = 1;
          attempt <= DNA_OPEN_LAB_P5_MALFORMED_RESPONSE_MAX_ATTEMPTS;
          attempt += 1
        ) {
          let response: DnaOpenLabResponse<T>;
          try {
            response = await input.clientPool.execute({
              scope,
              request: execute,
            });
          } catch (error) {
            recordRequestAttempt();
            if (!(
              error instanceof DnaOpenLabApiError &&
              error.kind === "malformed_response" &&
              attempt < DNA_OPEN_LAB_P5_MALFORMED_RESPONSE_MAX_ATTEMPTS
            )) {
              throw error;
            }
            continue;
          }
          recordRequestAttempt();
          successfulLogicalRequestCount = add(successfulLogicalRequestCount, 1);
          observedResponseBytes = add(
            observedResponseBytes,
            responseBytes(response.result),
          );
          return response.result;
        }
        return runnerError();
      };

      const result = await input.measureFamily({ family, request });
      if (
        result.family !== family ||
        result.authorityClass !== authority.authorityClass ||
        !result.terminalInventoryObserved
      ) {
        runnerError();
      }
      const observedSourceRecordCount = count(result.observedSourceRecordCount);
      const unresolvedIdentityObservationUpperBound = count(
        result.unresolvedIdentityObservationUpperBound,
      );
      const sourceRecordUpperBound = count(result.sourceRecordUpperBound);
      const malformedResponseRetryCount =
        observedApiRequestCount - successfulLogicalRequestCount;
      if (malformedResponseRetryCount < 0) runnerError();
      const apiRequestUpperBound = add(
        positiveCount(result.apiRequestUpperBound),
        malformedResponseRetryCount,
      );
      const retainedR2BytesUpperBound = count(result.retainedR2BytesUpperBound);
      const classAOperationsUpperBound = add(
        count(result.classAOperationsUpperBound),
        malformedResponseRetryCount,
      );
      const classBOperationsUpperBound = add(
        count(result.classBOperationsUpperBound),
        malformedResponseRetryCount,
      );
      if (
        observedApiRequestCount < 1 ||
        sourceRecordUpperBound <
          add(
            observedSourceRecordCount,
            unresolvedIdentityObservationUpperBound,
          ) ||
        (family !== "finished_races" &&
          unresolvedIdentityObservationUpperBound !== 0) ||
        apiRequestUpperBound < observedApiRequestCount ||
        retainedR2BytesUpperBound < observedResponseBytes ||
        classAOperationsUpperBound < observedApiRequestCount ||
        classBOperationsUpperBound < observedApiRequestCount
      ) {
        runnerError();
      }
      families.push(
        Object.freeze({
          ...result,
          observedSourceRecordCount,
          unresolvedIdentityObservationUpperBound,
          sourceRecordUpperBound,
          observedApiRequestCount,
          apiRequestUpperBound,
          retainedR2BytesUpperBound,
          classAOperationsUpperBound,
          classBOperationsUpperBound,
          neonIncrementalBytesUpperBound: count(
            result.neonIncrementalBytesUpperBound,
          ),
        }),
      );
      input.recordProgress?.(`${family}_complete`);
    }
    verifyPool(input.clientPool, input.temporaryCommissioningRateAuthorization);
    if (
      totalPoolRequestCount(input.clientPool) - initialPoolRequestCount !==
      families.reduce(
        (total, family) => add(total, family.observedApiRequestCount),
        0,
      )
    ) {
      runnerError();
    }
  } catch (error) {
    acquisitionFailure = true;
    input.recordDiagnostic?.(
      Object.freeze({
        kind: "acquisition_failed",
        family: activeFamily,
        failureCode: failureCode(error),
        completedFamilyCount: families.length,
        familyApiRequestCount: activeFamilyRequestCount,
        totalApiRequestCount:
          totalPoolRequestCount(input.clientPool) - initialPoolRequestCount,
        rateLimitedRequestCount: totalPoolRateLimitedCount(input.clientPool),
      }),
    );
  }

  let cleanupFailure = false;
  try {
    cleanup(await input.cleanupMeasurement());
    input.recordProgress?.("cleanup_verified");
  } catch {
    cleanupFailure = true;
  }
  if (acquisitionFailure || cleanupFailure) runnerError();

  const evidence = await invokeDnaOpenLabP5FirstBackfillMeasurement({
    authority: DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
    expectedCodeHeadSha: input.measurement.exactMainCommit,
    measurement: {
      ...input.measurement,
      measuredAt:
        input.measurementCompletedAt?.() ?? input.measurement.measuredAt,
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
      families: Object.freeze(families),
    },
    emitEvidence: input.emitEvidence,
  });
  input.recordProgress?.("aggregate_evidence_emitted");
  return evidence;
}
