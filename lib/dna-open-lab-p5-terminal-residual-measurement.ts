import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import {
  DNA_OPEN_LAB_P5_CORE_BULK_LIMIT,
  DNA_OPEN_LAB_P5_CORE_ENDPOINTS,
  type DnaOpenLabP5CoreEndpoint,
  type DnaOpenLabP5FirstBackfillFamilyObservation,
  type DnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "./dna-open-lab-p5-first-backfill-family-adapter";
import { DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY } from "./dna-open-lab-p5-first-backfill-projection-policy";
import { projectDnaOpenLabP5FirstBackfillFamilyUpperBounds } from "./dna-open-lab-p5-first-backfill-projection-policy";
import { measureDnaOpenLabP5SpliceContinuation } from "./dna-open-lab-p5-splice-continuation-measurement";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_RESIDUAL_LOGICAL_REQUESTS = 32;

export type DnaOpenLabP5CoreRequestPlanItem = Readonly<{
  familyRequestIndex: number;
  endpoint: DnaOpenLabP5CoreEndpoint;
  hids: readonly number[];
}>;

export type DnaOpenLabP5TerminalResidualMeasurement = Readonly<{
  schemaVersion: 1;
  evidenceKind: "dna_open_lab_p5_terminal_residual_measurement";
  providerScope: "private_preview";
  authorityCutoffAt: string;
  measuredAt: string;
  terminalInventoryObserved: true;
  ownedCoreCount: number;
  completedCoreRequestCount: number;
  expectedCoreRequestCount: number;
  residualCoreRequestCount: number;
  spliceRequestCount: number;
  logicalRequestCount: number;
  apiRequestAttemptCount: number;
  responseBytes: number;
  maximumResponseBytes: number;
  sourceRecordCount: number;
  projectedUpperBounds: DnaOpenLabP5FirstBackfillFamilyUpperBounds;
  coreProjectedUpperBounds: DnaOpenLabP5FirstBackfillFamilyUpperBounds;
  spliceProjectedUpperBounds: DnaOpenLabP5FirstBackfillFamilyUpperBounds;
  effectiveAggregateRequestsPerMinute: number;
  rateLimitedResponseCount: number;
  independentRateBucketsEnabled: false;
  persistentOwnerDataWriteCount: 0;
  r2WriteCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  productionChangesAllowed: false;
  evidenceSha256: string;
}>;

function measurementError(message: string): never {
  throw new Error(`DNA Open Lab P5 terminal residual measurement: ${message}`);
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} is invalid`);
  }
  return value;
}

function add(values: readonly number[], field: string): number {
  return count(
    values.reduce((total, value) => total + value, 0),
    field,
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

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    measurementError("response record is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
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

function positiveCoreIds(value: unknown): readonly number[] {
  const seen = new Set<number>();
  return Object.freeze(
    records(value)
      .map((entry) => {
        const hid = record(entry).hid;
        if (!Number.isSafeInteger(hid) || Number(hid) < 1) {
          measurementError("vault Core identity is invalid");
        }
        const id = Number(hid);
        if (seen.has(id)) measurementError("vault Core identity is duplicated");
        seen.add(id);
        return id;
      })
      .sort((left, right) => left - right),
  );
}

export function buildDnaOpenLabP5CoreRequestPlan(
  vaultCores: unknown,
): readonly DnaOpenLabP5CoreRequestPlanItem[] {
  const ids = positiveCoreIds(vaultCores);
  if (ids.length < 1) measurementError("vault Core inventory is empty");
  const plan: DnaOpenLabP5CoreRequestPlanItem[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += DNA_OPEN_LAB_P5_CORE_BULK_LIMIT
  ) {
    const hids = Object.freeze(
      ids.slice(offset, offset + DNA_OPEN_LAB_P5_CORE_BULK_LIMIT),
    );
    for (const endpoint of DNA_OPEN_LAB_P5_CORE_ENDPOINTS) {
      plan.push(
        Object.freeze({
          familyRequestIndex: plan.length + 1,
          endpoint,
          hids,
        }),
      );
    }
  }
  return Object.freeze(plan);
}

function invokeCoreEndpoint(input: {
  client: DnaOpenLabClient;
  endpoint: DnaOpenLabP5CoreEndpoint;
  hids: readonly number[];
}): Promise<DnaOpenLabResponse<readonly unknown[]>> {
  switch (input.endpoint) {
    case "cores.info_bulk":
      return input.client.coreInfoBulk(input.hids);
    case "cores.racing_stats_bulk":
      return input.client.coreRacingStatsBulk(input.hids);
    case "cores.power_bulk":
      return input.client.corePowerBulk(input.hids);
    case "cores.listing_price_bulk":
      return input.client.coreListingPriceBulk(input.hids);
    case "cores.attached_assets_bulk":
      return input.client.coreAttachedAssetsBulk(input.hids);
    case "cores.owner_bulk":
      return input.client.coreOwnerBulk(input.hids);
    case "cores.stamina_bulk":
      return input.client.coreStaminaBulk(input.hids);
    case "cores.splicing_info_bulk":
      return input.client.coreSplicingInfoBulk(input.hids);
  }
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

function combineBounds(
  left: DnaOpenLabP5FirstBackfillFamilyUpperBounds,
  right: DnaOpenLabP5FirstBackfillFamilyUpperBounds,
): DnaOpenLabP5FirstBackfillFamilyUpperBounds {
  return Object.freeze({
    sourceRecordUpperBound: add(
      [left.sourceRecordUpperBound, right.sourceRecordUpperBound],
      "sourceRecordUpperBound",
    ),
    apiRequestUpperBound: add(
      [left.apiRequestUpperBound, right.apiRequestUpperBound],
      "apiRequestUpperBound",
    ),
    retainedR2BytesUpperBound: add(
      [left.retainedR2BytesUpperBound, right.retainedR2BytesUpperBound],
      "retainedR2BytesUpperBound",
    ),
    classAOperationsUpperBound: add(
      [left.classAOperationsUpperBound, right.classAOperationsUpperBound],
      "classAOperationsUpperBound",
    ),
    classBOperationsUpperBound: add(
      [left.classBOperationsUpperBound, right.classBOperationsUpperBound],
      "classBOperationsUpperBound",
    ),
    neonIncrementalBytesUpperBound: add(
      [
        left.neonIncrementalBytesUpperBound,
        right.neonIncrementalBytesUpperBound,
      ],
      "neonIncrementalBytesUpperBound",
    ),
    unresolvedIdentityObservationUpperBound: add(
      [
        left.unresolvedIdentityObservationUpperBound,
        right.unresolvedIdentityObservationUpperBound,
      ],
      "unresolvedIdentityObservationUpperBound",
    ),
  });
}

export async function measureDnaOpenLabP5TerminalResidual(input: {
  clientPool: DnaOpenLabClientPool;
  vaultCores: unknown;
  completedCoreRequestCount: number;
  authorityCutoffAt: string;
  now?: () => string;
}): Promise<DnaOpenLabP5TerminalResidualMeasurement> {
  const authorityCutoffAt = timestamp(
    input.authorityCutoffAt,
    "authorityCutoffAt",
  );
  const effectiveAggregateRequestsPerMinute = verifyPool(input.clientPool);
  const plan = buildDnaOpenLabP5CoreRequestPlan(input.vaultCores);
  const completedCoreRequestCount = count(
    input.completedCoreRequestCount,
    "completedCoreRequestCount",
  );
  if (completedCoreRequestCount >= plan.length) {
    measurementError("Core request prefix is not incomplete");
  }
  const residual = plan.slice(completedCoreRequestCount);
  if (residual.length + 3 > MAXIMUM_RESIDUAL_LOGICAL_REQUESTS) {
    measurementError("residual request count exceeds its read-only bound");
  }

  let apiRequestAttemptCount = 0;
  let totalResponseBytes = 0;
  let maximumResponseBytes = 0;
  let sourceRecordCount = 0;
  const endpointCounters = new Map<
    DnaOpenLabP5CoreEndpoint,
    { requestCount: number; responseBytes: number; responseRecordCount: number }
  >();

  for (const request of residual) {
    let response: DnaOpenLabResponse<readonly unknown[]> | null = null;
    for (
      let attempt = 1;
      attempt <=
      DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.apiRequestAttemptsPerLogicalRequest;
      attempt += 1
    ) {
      try {
        response = await input.clientPool.execute({
          scope: "cores",
          request: (client) => invokeCoreEndpoint({ ...request, client }),
        });
        apiRequestAttemptCount = add(
          [apiRequestAttemptCount, 1],
          "apiRequestAttemptCount",
        );
        break;
      } catch (error) {
        apiRequestAttemptCount = add(
          [apiRequestAttemptCount, 1],
          "apiRequestAttemptCount",
        );
        if (!(
          error instanceof DnaOpenLabApiError &&
          error.kind === "malformed_response" &&
          attempt <
            DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.apiRequestAttemptsPerLogicalRequest
        )) {
          throw error;
        }
      }
    }
    if (response === null) measurementError("Core response remained malformed");
    const rows = records(response.result);
    const returned = rows
      .map((entry) => {
        const hid = record(entry).hid;
        if (!Number.isSafeInteger(hid) || Number(hid) < 1) {
          measurementError("Core response identity is invalid");
        }
        return Number(hid);
      })
      .sort((left, right) => left - right);
    if (
      returned.length !== request.hids.length ||
      JSON.stringify(returned) !==
        JSON.stringify([...request.hids].sort((a, b) => a - b))
    ) {
      measurementError("Core response coverage is incomplete");
    }
    const bytes = responseBytes(response.result);
    totalResponseBytes = add([totalResponseBytes, bytes], "responseBytes");
    maximumResponseBytes = Math.max(maximumResponseBytes, bytes);
    sourceRecordCount = add(
      [sourceRecordCount, rows.length],
      "sourceRecordCount",
    );
    const prior = endpointCounters.get(request.endpoint) ?? {
      requestCount: 0,
      responseBytes: 0,
      responseRecordCount: 0,
    };
    endpointCounters.set(request.endpoint, {
      requestCount: prior.requestCount + 1,
      responseBytes: prior.responseBytes + bytes,
      responseRecordCount: prior.responseRecordCount + rows.length,
    });
  }

  const measuredAt = timestamp(
    (input.now ?? (() => new Date().toISOString()))(),
    "measuredAt",
  );
  if (Date.parse(measuredAt) < Date.parse(authorityCutoffAt)) {
    measurementError("measurement predates its authority cutoff");
  }
  const coreObservationBase = Object.freeze({
    family: "core_current_state" as const,
    authorityClass: "current_state_only" as const,
    authorityCutoffAt,
    observedAt: measuredAt,
    observedSourceRecordCount: sourceRecordCount,
    observedApiRequestCount: residual.length,
    observedResponseBytes: totalResponseBytes,
    maximumObservedResponseBytes: maximumResponseBytes,
    unresolvedIdentityObservationUpperBound: 0,
    terminalUnitCount: residual.length,
    splitCount: 0,
    endpointObservations: Object.freeze(
      [...endpointCounters.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([endpoint, counters]) => ({ endpoint, ...counters })),
    ),
  });
  const coreObservation: DnaOpenLabP5FirstBackfillFamilyObservation =
    Object.freeze({
      ...coreObservationBase,
      aggregateEvidenceSha256: dnaOpenLabRawEvidenceSha256(coreObservationBase),
    });
  const coreProjectedUpperBounds =
    projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(coreObservation);
  const splice = await measureDnaOpenLabP5SpliceContinuation({
    clientPool: input.clientPool,
    authorityCutoffAt,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const projectedUpperBounds = combineBounds(
    coreProjectedUpperBounds,
    splice.projectedUpperBounds,
  );
  const snapshot = input.clientPool.snapshot();
  const reportBase = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "dna_open_lab_p5_terminal_residual_measurement" as const,
    providerScope: "private_preview" as const,
    authorityCutoffAt,
    measuredAt: splice.measuredAt,
    terminalInventoryObserved: true as const,
    ownedCoreCount: positiveCoreIds(input.vaultCores).length,
    completedCoreRequestCount,
    expectedCoreRequestCount: plan.length,
    residualCoreRequestCount: residual.length,
    spliceRequestCount: splice.logicalRequestCount,
    logicalRequestCount: add(
      [residual.length, splice.logicalRequestCount],
      "logicalRequestCount",
    ),
    apiRequestAttemptCount: add(
      [apiRequestAttemptCount, splice.apiRequestAttemptCount],
      "apiRequestAttemptCount",
    ),
    responseBytes: add(
      [totalResponseBytes, splice.responseBytes],
      "responseBytes",
    ),
    maximumResponseBytes: Math.max(
      maximumResponseBytes,
      splice.maximumResponseBytes,
    ),
    sourceRecordCount: add(
      [sourceRecordCount, splice.sourceRecordCount],
      "sourceRecordCount",
    ),
    projectedUpperBounds,
    coreProjectedUpperBounds,
    spliceProjectedUpperBounds: splice.projectedUpperBounds,
    effectiveAggregateRequestsPerMinute,
    rateLimitedResponseCount: snapshot.lanes.reduce(
      (total, lane) => add([total, lane.rateLimitedCount], "rateLimitedCount"),
      0,
    ),
    independentRateBucketsEnabled: false as const,
    persistentOwnerDataWriteCount: 0 as const,
    r2WriteCount: 0 as const,
    rawPayloadIncluded: false as const,
    secretMaterialIncluded: false as const,
    productionChangesAllowed: false as const,
  });
  return Object.freeze({
    ...reportBase,
    evidenceSha256: dnaOpenLabRawEvidenceSha256(reportBase),
  });
}
