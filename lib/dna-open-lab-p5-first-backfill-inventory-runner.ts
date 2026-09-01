import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
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
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaOpenLabScope,
} from "./dna-open-lab-v1-client";

const MAXIMUM_OBSERVED_RESPONSE_BYTES = 8 * 1024 * 1024 * 1024;

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

function verifyPool(pool: DnaOpenLabClientPool): void {
  const snapshot = pool.snapshot();
  if (
    snapshot.independentRateBucketsEnabled ||
    snapshot.aggregateBudget === null ||
    snapshot.aggregateBudget.effectiveRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
    snapshot.lanes.length < 1 ||
    snapshot.lanes.length > 3 ||
    snapshot.lanes.some(
      (lane) =>
        lane.budget.effectiveRequestsPerMinute >
        DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
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
}): Promise<DnaOpenLabP5SanitizedFirstBackfillMeasurementEvidence> {
  verifyPool(input.clientPool);
  const initialPoolRequestCount = totalPoolRequestCount(input.clientPool);
  const families: DnaOpenLabP5FirstBackfillFamilyMeasurement[] = [];
  let acquisitionFailure = false;

  try {
    for (const family of DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES) {
      const authority = FAMILY_AUTHORITY[family];
      let observedApiRequestCount = 0;
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
        const response = await input.clientPool.execute({
          scope,
          request: execute,
        });
        observedApiRequestCount = add(observedApiRequestCount, 1);
        observedResponseBytes = add(
          observedResponseBytes,
          responseBytes(response.result),
        );
        return response.result;
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
      const sourceRecordUpperBound = count(result.sourceRecordUpperBound);
      const apiRequestUpperBound = positiveCount(result.apiRequestUpperBound);
      const retainedR2BytesUpperBound = count(result.retainedR2BytesUpperBound);
      const classAOperationsUpperBound = count(
        result.classAOperationsUpperBound,
      );
      const classBOperationsUpperBound = count(
        result.classBOperationsUpperBound,
      );
      if (
        observedApiRequestCount < 1 ||
        sourceRecordUpperBound < observedSourceRecordCount ||
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
    verifyPool(input.clientPool);
    if (
      totalPoolRequestCount(input.clientPool) - initialPoolRequestCount !==
      families.reduce(
        (total, family) => add(total, family.observedApiRequestCount),
        0,
      )
    ) {
      runnerError();
    }
  } catch {
    acquisitionFailure = true;
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
