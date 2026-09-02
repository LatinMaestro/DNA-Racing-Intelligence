import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type { DnaOpenLabP5FirstBackfillApprovalPacket } from "./dna-open-lab-p5-first-backfill-approval";
import type {
  DnaOpenLabP5FirstBackfillFamilyInventoryResult,
  DnaOpenLabP5FirstBackfillInventoryRequest,
  DnaOpenLabP5FirstBackfillInventoryRequestInput,
} from "./dna-open-lab-p5-first-backfill-inventory-runner";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
  type DnaOpenLabP5FirstBackfillSourceFamily,
} from "./dna-open-lab-p5-first-backfill-measurement";
import type {
  DnaOpenLabP5FirstBackfillPersistenceCoordinator,
  DnaOpenLabP5FirstBackfillPersistenceSnapshot,
} from "./dna-open-lab-p5-first-backfill-persistence-coordinator";
import { DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY } from "./dna-open-lab-p5-first-backfill-projection-policy";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
  type DnaOpenLabScope,
} from "./dna-open-lab-v1-client";

export const DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE =
  150 as const;

export type DnaOpenLabP5PersistentCommissioningRateAuthorization = Readonly<{
  kind: "owner_approved_one_run_persistent_private_preview_backfill";
  maximumAggregateRequestsPerMinute: typeof DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE;
  maximumAuthorizedMicroUsd: number;
  measurementEvidenceSha256: string;
}>;

export type DnaOpenLabP5FirstBackfillPersistentAcquisitionResult = Readonly<{
  status: "already_complete" | "complete";
  persistence: DnaOpenLabP5FirstBackfillPersistenceSnapshot;
  families: readonly DnaOpenLabP5FirstBackfillFamilyInventoryResult[];
  apiRequestAttemptCount: number;
  replayedLogicalRequestCount: number;
  newlyPersistedLogicalRequestCount: number;
}>;

const FAMILY_SCOPES = Object.freeze({
  finished_races: Object.freeze(["races"] as const),
  race_activity: Object.freeze(["races"] as const),
  token_prices: Object.freeze(["tokens"] as const),
  vault_identity: Object.freeze(["vault"] as const),
  core_current_state: Object.freeze(["cores"] as const),
  splice_arena: Object.freeze(["splice"] as const),
} satisfies Readonly<
  Record<DnaOpenLabP5FirstBackfillSourceFamily, readonly DnaOpenLabScope[]>
>);

function acquisitionError(message: string): never {
  throw new Error(`DNA Open Lab P5 persistent acquisition: ${message}`);
}

function approvedLimits(packet: DnaOpenLabP5FirstBackfillApprovalPacket): {
  apiRequestAttemptLimit: number;
  logicalRequestLimit: number;
  measurementEvidenceSha256: string;
  maximumAuthorizedMicroUsd: number;
} {
  if (
    packet.status !== "approved_for_first_private_preview_backfill" ||
    packet.firstPersistentPrivatePreviewBackfillAllowed !== true ||
    packet.productionChangesAllowed !== false ||
    packet.measuredUpperBound === null ||
    packet.identityOmissionAuthority === null ||
    packet.ownerAuthorization === null ||
    packet.identityOmissionAuthority.maximumObservationCount !== 1 ||
    packet.measuredUpperBound.unresolvedIdentityObservationUpperBound !== 1 ||
    packet.ownerAuthorization.maximumAuthorizedMicroUsd <
      packet.measuredUpperBound.projectedCostMicroUsd
  ) {
    return acquisitionError("bounded private Preview approval is unavailable");
  }
  const policy = DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY;
  const classB = packet.measuredUpperBound.classBOperationsUpperBound;
  if (classB % policy.r2ClassBOperationsPerLogicalRequest !== 0) {
    return acquisitionError("measured request authority is inconsistent");
  }
  const logicalRequestLimit =
    classB / policy.r2ClassBOperationsPerLogicalRequest;
  if (
    logicalRequestLimit * policy.apiRequestAttemptsPerLogicalRequest !==
    packet.measuredUpperBound.apiRequestUpperBound
  ) {
    return acquisitionError("measured API attempt authority is inconsistent");
  }
  return {
    apiRequestAttemptLimit: packet.measuredUpperBound.apiRequestUpperBound,
    logicalRequestLimit,
    measurementEvidenceSha256:
      packet.identityOmissionAuthority.measurementEvidenceSha256,
    maximumAuthorizedMicroUsd:
      packet.ownerAuthorization.maximumAuthorizedMicroUsd,
  };
}

function verifyPool(input: {
  clientPool: DnaOpenLabClientPool;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  rateAuthorization?: DnaOpenLabP5PersistentCommissioningRateAuthorization;
}): void {
  const limits = approvedLimits(input.approvalPacket);
  const maximumRequestsPerMinute =
    input.rateAuthorization === undefined
      ? DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
      : input.rateAuthorization.kind ===
            "owner_approved_one_run_persistent_private_preview_backfill" &&
          input.rateAuthorization.maximumAggregateRequestsPerMinute ===
            DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE &&
          input.rateAuthorization.maximumAuthorizedMicroUsd ===
            limits.maximumAuthorizedMicroUsd &&
          input.rateAuthorization.measurementEvidenceSha256 ===
            limits.measurementEvidenceSha256
        ? DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE
        : acquisitionError(
            "temporary persistent commissioning rate is invalid",
          );
  const snapshot = input.clientPool.snapshot();
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
    acquisitionError("client pool exceeds its aggregate authority");
  }
}

function totalPoolRequestCount(pool: DnaOpenLabClientPool): number {
  return pool.snapshot().lanes.reduce((total, lane) => {
    const result = total + lane.requestCount;
    if (!Number.isSafeInteger(result)) {
      acquisitionError("API request accounting overflowed");
    }
    return result;
  }, 0);
}

function timestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return acquisitionError("observation timestamp is invalid");
  }
  return new Date(value).toISOString();
}

function omissionCount<T>(input: {
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  result: T;
  classify: ((result: T) => number) | undefined;
}): 0 | 1 {
  const count = input.classify?.(input.result) ?? 0;
  if (
    (count !== 0 && count !== 1) ||
    (count === 1 && input.family !== "finished_races")
  ) {
    acquisitionError("identity omission exceeds its measured authority");
  }
  return count;
}

function verifyReplay<T>(input: {
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  requestOrdinal: number;
  endpoint: string;
  evidenceRequest: unknown;
  document: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    requestOrdinal: number;
    endpoint: string;
    request: unknown;
    response: DnaOpenLabResponse<unknown>;
  };
  classify: ((result: T) => number) | undefined;
  committedOmissionCount?: 0 | 1;
}): 0 | 1 {
  if (
    input.document.family !== input.family ||
    input.document.requestOrdinal !== input.requestOrdinal ||
    input.document.endpoint !== input.endpoint ||
    dnaOpenLabRawEvidenceSha256(input.document.request) !==
      dnaOpenLabRawEvidenceSha256(input.evidenceRequest)
  ) {
    acquisitionError("durable replay disagrees with the acquisition plan");
  }
  const omitted = omissionCount({
    family: input.family,
    result: input.document.response.result as T,
    classify: input.classify,
  });
  if (
    input.committedOmissionCount !== undefined &&
    input.committedOmissionCount !== omitted
  ) {
    acquisitionError("durable omission authority disagrees with replay");
  }
  return omitted;
}

/**
 * Executes the exact measured six-family acquisition through immutable R2 and
 * the compact owner-RLS Neon receipt ledger. Every committed response is
 * replayed into the adaptive family adapter; only the first absent ordinal may
 * reach the API. A response is published nowhere by this service.
 */
export async function runDnaOpenLabP5FirstBackfillPersistentAcquisition(input: {
  clientPool: DnaOpenLabClientPool;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  coordinator: DnaOpenLabP5FirstBackfillPersistenceCoordinator;
  measureFamily: (input: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    request: DnaOpenLabP5FirstBackfillInventoryRequest;
  }) => Promise<DnaOpenLabP5FirstBackfillFamilyInventoryResult>;
  rateAuthorization?: DnaOpenLabP5PersistentCommissioningRateAuthorization;
  now?: () => string;
}): Promise<DnaOpenLabP5FirstBackfillPersistentAcquisitionResult> {
  verifyPool(input);
  const limits = approvedLimits(input.approvalPacket);
  const initialPoolRequestCount = totalPoolRequestCount(input.clientPool);
  const initialized = await input.coordinator.initialize();
  if (initialized.status === "complete") {
    if (
      initialized.logicalRequestCount !== limits.logicalRequestLimit ||
      initialized.nextRequestOrdinal !== limits.logicalRequestLimit + 1 ||
      initialized.omittedIdentityObservationCount !== 1 ||
      initialized.completionSha256 === null
    ) {
      acquisitionError("completed ledger disagrees with measured authority");
    }
    return Object.freeze({
      status: "already_complete",
      persistence: initialized,
      families: Object.freeze([]),
      apiRequestAttemptCount: 0,
      replayedLogicalRequestCount: 0,
      newlyPersistedLogicalRequestCount: 0,
    });
  }

  const now = input.now ?? (() => new Date().toISOString());
  const families: DnaOpenLabP5FirstBackfillFamilyInventoryResult[] = [];
  let requestOrdinal = 1;
  let replayedLogicalRequestCount = 0;
  let newlyPersistedLogicalRequestCount = 0;

  for (const family of DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES) {
    const persistentRequest: DnaOpenLabP5FirstBackfillInventoryRequest = async <
      T,
    >(
      requestInput: DnaOpenLabP5FirstBackfillInventoryRequestInput<T>,
    ): Promise<T> => {
      const {
        scope,
        endpoint,
        evidenceRequest,
        classifyOmittedIdentityObservationCount,
        request,
      } = requestInput;
      const allowedScopes: readonly DnaOpenLabScope[] = FAMILY_SCOPES[family];
      if (
        !allowedScopes.includes(scope) ||
        typeof endpoint !== "string" ||
        endpoint.trim() === "" ||
        evidenceRequest === undefined
      ) {
        return acquisitionError("family request metadata is incomplete");
      }
      const ordinal = requestOrdinal;
      if (ordinal > limits.logicalRequestLimit) {
        return acquisitionError("logical request bound would be exceeded");
      }
      const replay = await input.coordinator.replay(ordinal);
      if (replay !== null) {
        verifyReplay<T>({
          family,
          requestOrdinal: ordinal,
          endpoint,
          evidenceRequest,
          document: replay.document,
          classify: classifyOmittedIdentityObservationCount,
          ...(replay.status === "committed"
            ? {
                committedOmissionCount: replay.omittedIdentityObservationCount,
              }
            : {}),
        });
        if (replay.status === "pending_neon_receipt") {
          await input.coordinator.record({
            family,
            endpoint,
            request: evidenceRequest,
            response: replay.document.response,
            observedAt: replay.document.observedAt,
            omittedIdentityObservationCount: omissionCount({
              family,
              result: replay.document.response.result as T,
              classify: classifyOmittedIdentityObservationCount,
            }),
          });
        }
        requestOrdinal += 1;
        replayedLogicalRequestCount += 1;
        return replay.document.response.result as T;
      }

      let response: DnaOpenLabResponse<T> | null = null;
      for (
        let attempt = 1;
        attempt <=
        DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.apiRequestAttemptsPerLogicalRequest;
        attempt += 1
      ) {
        if (
          totalPoolRequestCount(input.clientPool) - initialPoolRequestCount >=
          limits.apiRequestAttemptLimit
        ) {
          return acquisitionError(
            "API request-attempt bound would be exceeded",
          );
        }
        try {
          response = await input.clientPool.execute({ scope, request });
          break;
        } catch (error) {
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
      if (response === null) {
        return acquisitionError("API response remained malformed");
      }
      const observedAt = timestamp(now());
      await input.coordinator.record({
        family,
        endpoint,
        request: evidenceRequest,
        response,
        observedAt,
        omittedIdentityObservationCount: omissionCount({
          family,
          result: response.result,
          classify: classifyOmittedIdentityObservationCount,
        }),
      });
      requestOrdinal += 1;
      newlyPersistedLogicalRequestCount += 1;
      return response.result;
    };
    const result = await input.measureFamily({
      family,
      request: persistentRequest,
    });
    if (result.family !== family || !result.terminalInventoryObserved) {
      acquisitionError("family did not complete its terminal inventory");
    }
    families.push(result);
  }

  verifyPool(input);
  if (requestOrdinal !== limits.logicalRequestLimit + 1) {
    acquisitionError(
      "acquisition did not reproduce the measured request count",
    );
  }
  const persistence = await input.coordinator.complete();
  if (
    persistence.status !== "complete" ||
    persistence.logicalRequestCount !== limits.logicalRequestLimit ||
    persistence.omittedIdentityObservationCount !== 1
  ) {
    acquisitionError("durable completion authority is incomplete");
  }
  return Object.freeze({
    status: "complete",
    persistence,
    families: Object.freeze(families),
    apiRequestAttemptCount:
      totalPoolRequestCount(input.clientPool) - initialPoolRequestCount,
    replayedLogicalRequestCount,
    newlyPersistedLogicalRequestCount,
  });
}
