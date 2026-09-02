import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import {
  type DnaOpenLabP5FirstBackfillFamilyObservation,
  type DnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "./dna-open-lab-p5-first-backfill-family-adapter";
import { projectDnaOpenLabP5FirstBackfillFamilyUpperBounds } from "./dna-open-lab-p5-first-backfill-projection-policy";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
  type DnaSpliceArenaResult,
} from "./dna-open-lab-v1-client";

const RACE_MODES = Object.freeze(["bike", "car", "horse"] as const);
const MAXIMUM_ARENA_PAGES_PER_MODE = 512;
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MALFORMED_RESPONSE_MAX_ATTEMPTS = 3;

export type DnaOpenLabP5SpliceContinuationMeasurement = Readonly<{
  schemaVersion: 1;
  evidenceKind: "dna_open_lab_p5_splice_continuation_measurement";
  providerScope: "private_preview";
  authorityCutoffAt: string;
  measuredAt: string;
  terminalInventoryObserved: true;
  modeCount: 3;
  sourceRecordCount: number;
  logicalRequestCount: number;
  apiRequestAttemptCount: number;
  responseBytes: number;
  maximumResponseBytes: number;
  projectedUpperBounds: DnaOpenLabP5FirstBackfillFamilyUpperBounds;
  effectiveAggregateRequestsPerMinute: number;
  rateLimitedResponseCount: number;
  independentRateBucketsEnabled: false;
  persistentOwnerDataWriteCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  productionChangesAllowed: false;
  evidenceSha256: string;
}>;

function measurementError(message: string): never {
  throw new Error(
    `DNA Open Lab P5 splice continuation measurement: ${message}`,
  );
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    measurementError(`${field} is invalid`);
  }
  return new Date(normalized).toISOString();
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} is invalid`);
  }
  return value;
}

function add(left: number, right: number, field: string): number {
  return count(left + right, field);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    measurementError("response record is invalid");
  }
  return value as Record<string, unknown>;
}

function records(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) measurementError("response rows are invalid");
  return value;
}

function responseBytes(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    measurementError("response is not serializable");
  }
  if (serialized === undefined)
    measurementError("response is not serializable");
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes < 1 || bytes > MAXIMUM_RESPONSE_BYTES) {
    measurementError("response size is outside the bounded measurement");
  }
  return bytes;
}

function verifyPool(pool: DnaOpenLabClientPool): number {
  const snapshot = pool.snapshot();
  const effective = snapshot.aggregateBudget?.effectiveRequestsPerMinute;
  if (
    snapshot.independentRateBucketsEnabled ||
    effective === undefined ||
    effective > DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
    snapshot.lanes.length < 1 ||
    snapshot.lanes.length > 3 ||
    snapshot.lanes.some(
      (lane) =>
        lane.budget.effectiveRequestsPerMinute >
        DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    )
  ) {
    measurementError("client pool exceeds standing aggregate authority");
  }
  return effective;
}

/**
 * Re-measures only the missing current-state splice family after an approved
 * P5 checkpoint stopped on plan drift. It is read-only, uses the standing
 * 30 aggregate-rpm ceiling and emits aggregate evidence only.
 */
export async function measureDnaOpenLabP5SpliceContinuation(input: {
  clientPool: DnaOpenLabClientPool;
  authorityCutoffAt: string;
  now?: () => string;
}): Promise<DnaOpenLabP5SpliceContinuationMeasurement> {
  const authorityCutoffAt = timestamp(
    input.authorityCutoffAt,
    "authorityCutoffAt",
  );
  const effectiveAggregateRequestsPerMinute = verifyPool(input.clientPool);
  let sourceRecordCount = 0;
  let logicalRequestCount = 0;
  let apiRequestAttemptCount = 0;
  let totalResponseBytes = 0;
  let maximumResponseBytes = 0;
  const endpointObservations: Array<{
    endpoint: string;
    requestCount: number;
    responseBytes: number;
    responseRecordCount: number;
  }> = [];

  for (const mode of RACE_MODES) {
    const seenCoreIds = new Set<number>();
    let expectedLimit: number | null = null;
    let page = 1;
    let modeRequests = 0;
    let modeBytes = 0;
    let modeRecords = 0;

    while (true) {
      let response: DnaOpenLabResponse<DnaSpliceArenaResult> | null = null;
      for (
        let attempt = 1;
        attempt <= MALFORMED_RESPONSE_MAX_ATTEMPTS;
        attempt += 1
      ) {
        try {
          response = await input.clientPool.execute({
            scope: "splice",
            request: (client) =>
              client.spliceArena({ filter: { rvmode: mode }, page }),
          });
          apiRequestAttemptCount = add(
            apiRequestAttemptCount,
            1,
            "apiRequestAttemptCount",
          );
          break;
        } catch (error) {
          apiRequestAttemptCount = add(
            apiRequestAttemptCount,
            1,
            "apiRequestAttemptCount",
          );
          if (!(
            error instanceof DnaOpenLabApiError &&
            error.kind === "malformed_response" &&
            attempt < MALFORMED_RESPONSE_MAX_ATTEMPTS
          )) {
            throw error;
          }
        }
      }
      if (response === null) measurementError("response remained malformed");

      const pageRecord = record(response.result);
      const returnedPage = pageRecord.page;
      const limit = pageRecord.limit;
      const hasMore = pageRecord.has_more;
      const cores = records(pageRecord.cores);
      if (
        !Number.isSafeInteger(returnedPage) ||
        returnedPage !== page ||
        !Number.isSafeInteger(limit) ||
        Number(limit) < 1 ||
        typeof hasMore !== "boolean" ||
        (expectedLimit !== null && expectedLimit !== limit)
      ) {
        measurementError("splice pagination is invalid");
      }
      expectedLimit = Number(limit);
      for (const entry of cores) {
        const hid = record(entry).hid;
        if (!Number.isSafeInteger(hid) || Number(hid) < 1) {
          measurementError("splice core identity is invalid");
        }
        const coreId = Number(hid);
        if (seenCoreIds.has(coreId)) {
          measurementError("splice pagination contains a duplicate core");
        }
        seenCoreIds.add(coreId);
      }

      const bytes = responseBytes(response.result);
      logicalRequestCount = add(logicalRequestCount, 1, "logicalRequestCount");
      sourceRecordCount = add(
        sourceRecordCount,
        cores.length,
        "sourceRecordCount",
      );
      totalResponseBytes = add(totalResponseBytes, bytes, "totalResponseBytes");
      maximumResponseBytes = Math.max(maximumResponseBytes, bytes);
      modeRequests = add(modeRequests, 1, "modeRequests");
      modeBytes = add(modeBytes, bytes, "modeBytes");
      modeRecords = add(modeRecords, cores.length, "modeRecords");

      if (!hasMore) break;
      if (page >= MAXIMUM_ARENA_PAGES_PER_MODE) {
        measurementError("splice pagination exceeds its bounded limit");
      }
      page += 1;
    }

    endpointObservations.push({
      endpoint: `splice.arena.${mode}`,
      requestCount: modeRequests,
      responseBytes: modeBytes,
      responseRecordCount: modeRecords,
    });
  }

  const measuredAt = timestamp(
    (input.now ?? (() => new Date().toISOString()))(),
    "measuredAt",
  );
  if (Date.parse(measuredAt) < Date.parse(authorityCutoffAt)) {
    measurementError("measurement predates its authority cutoff");
  }
  const observationBase = Object.freeze({
    family: "splice_arena" as const,
    authorityClass: "current_state_only" as const,
    authorityCutoffAt,
    observedAt: measuredAt,
    observedSourceRecordCount: sourceRecordCount,
    observedApiRequestCount: logicalRequestCount,
    observedResponseBytes: totalResponseBytes,
    maximumObservedResponseBytes: maximumResponseBytes,
    unresolvedIdentityObservationUpperBound: 0,
    terminalUnitCount: logicalRequestCount,
    splitCount: 0,
    endpointObservations: Object.freeze(endpointObservations),
  });
  const observation: DnaOpenLabP5FirstBackfillFamilyObservation = Object.freeze(
    {
      ...observationBase,
      aggregateEvidenceSha256: dnaOpenLabRawEvidenceSha256(observationBase),
    },
  );
  const projectedUpperBounds =
    projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(observation);
  const snapshot = input.clientPool.snapshot();
  const reportBase = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "dna_open_lab_p5_splice_continuation_measurement" as const,
    providerScope: "private_preview" as const,
    authorityCutoffAt,
    measuredAt,
    terminalInventoryObserved: true as const,
    modeCount: 3 as const,
    sourceRecordCount,
    logicalRequestCount,
    apiRequestAttemptCount,
    responseBytes: totalResponseBytes,
    maximumResponseBytes,
    projectedUpperBounds,
    effectiveAggregateRequestsPerMinute,
    rateLimitedResponseCount: snapshot.lanes.reduce(
      (total, lane) => add(total, lane.rateLimitedCount, "rateLimitedCount"),
      0,
    ),
    independentRateBucketsEnabled: false as const,
    persistentOwnerDataWriteCount: 0 as const,
    rawPayloadIncluded: false as const,
    secretMaterialIncluded: false as const,
    productionChangesAllowed: false as const,
  });
  return Object.freeze({
    ...reportBase,
    evidenceSha256: dnaOpenLabRawEvidenceSha256(reportBase),
  });
}
