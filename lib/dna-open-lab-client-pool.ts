import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
  type DnaOpenLabScope,
} from "./dna-open-lab-v1-client";
import {
  createDnaOpenLabRequestBudget,
  type DnaOpenLabRequestBudget,
  type DnaOpenLabRequestBudgetSnapshot,
} from "./dna-open-lab-request-budget";

const MAXIMUM_POOL_LANES = 3;
const DEFAULT_AGGREGATE_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAXIMUM_LANE_REQUESTS_PER_MINUTE = 150;
const LANE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const scopes = new Set<DnaOpenLabScope>([
  "vault",
  "races",
  "cores",
  "tokens",
  "splice",
]);

export type DnaOpenLabClientPoolLaneInput = Readonly<{
  id: string;
  client: DnaOpenLabClient;
  scopes: readonly DnaOpenLabScope[];
}>;

export type DnaOpenLabClientPoolLaneSnapshot = Readonly<{
  id: string;
  scopes: readonly DnaOpenLabScope[];
  requestCount: number;
  successCount: number;
  rateLimitedCount: number;
  budget: DnaOpenLabRequestBudgetSnapshot;
}>;

export type DnaOpenLabClientPoolSnapshot = Readonly<{
  independentRateBucketsEnabled: boolean;
  aggregateBudget: DnaOpenLabRequestBudgetSnapshot | null;
  lanes: readonly DnaOpenLabClientPoolLaneSnapshot[];
}>;

export type DnaOpenLabClientPool = Readonly<{
  execute: <T>(input: {
    scope: DnaOpenLabScope;
    request: (
      client: DnaOpenLabClient,
      laneId: string,
    ) => Promise<DnaOpenLabResponse<T>>;
  }) => Promise<DnaOpenLabResponse<T>>;
  snapshot: () => DnaOpenLabClientPoolSnapshot;
}>;

type LaneState = {
  id: string;
  client: DnaOpenLabClient;
  scopes: readonly DnaOpenLabScope[];
  scopeSet: ReadonlySet<DnaOpenLabScope>;
  budget: DnaOpenLabRequestBudget;
  requestCount: number;
  successCount: number;
  rateLimitedCount: number;
};

function poolError(message: string): never {
  throw new Error(`DNA Open Lab client pool: ${message}`);
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    poolError(`${field} must be a positive safe integer`);
  }
  return value;
}

function laneId(value: string): string {
  const normalized = value.trim();
  if (
    !LANE_ID_PATTERN.test(normalized) ||
    normalized.toLowerCase().startsWith("dna_")
  ) {
    poolError("lane id is invalid or credential-like");
  }
  return normalized;
}

function laneScopes(values: readonly DnaOpenLabScope[]): readonly DnaOpenLabScope[] {
  if (values.length < 1) poolError("each lane requires at least one scope");
  const unique = new Set<DnaOpenLabScope>();
  for (const value of values) {
    if (!scopes.has(value)) poolError("lane contains an unsupported scope");
    unique.add(value);
  }
  return Object.freeze([...unique]);
}

function requestScope(value: DnaOpenLabScope): DnaOpenLabScope {
  if (!scopes.has(value)) poolError("request scope is unsupported");
  return value;
}

function firstRoundRobinCandidate(input: {
  lanes: readonly LaneState[];
  eligibleIndexes: readonly number[];
  cursor: number;
  requireUnblocked: boolean;
}): number | null {
  for (let offset = 0; offset < input.lanes.length; offset += 1) {
    const index = (input.cursor + offset) % input.lanes.length;
    if (!input.eligibleIndexes.includes(index)) continue;
    if (
      input.requireUnblocked &&
      input.lanes[index]?.budget.snapshot().blockedUntilMilliseconds !== null
    ) {
      continue;
    }
    return index;
  }
  return null;
}

/**
 * Creates a secret-free client pool for one to three already-authenticated DNA
 * Open Lab clients. In the default conservative mode every request passes both
 * a lane-local budget and one fixed aggregate vault budget, so adding keys does
 * not silently multiply request volume. `allowIndependentRateBuckets` is an
 * explicit future P3 switch: when true, the aggregate gate is removed and a
 * rate-limited lane may fail over once to another eligible lane.
 */
export function createDnaOpenLabClientPool(input: {
  lanes: readonly DnaOpenLabClientPoolLaneInput[];
  nowMilliseconds?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  aggregateRequestsPerMinute?: number;
  maximumLaneRequestsPerMinute?: number;
  allowIndependentRateBuckets?: boolean;
}): DnaOpenLabClientPool {
  if (input.lanes.length < 1 || input.lanes.length > MAXIMUM_POOL_LANES) {
    poolError(`pool requires between 1 and ${MAXIMUM_POOL_LANES} lanes`);
  }

  const nowMilliseconds = input.nowMilliseconds ?? Date.now;
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maximumLaneRequestsPerMinute = positiveSafeInteger(
    input.maximumLaneRequestsPerMinute ??
      DEFAULT_MAXIMUM_LANE_REQUESTS_PER_MINUTE,
    "maximumLaneRequestsPerMinute",
  );
  const independentRateBucketsEnabled =
    input.allowIndependentRateBuckets === true;

  const seenLaneIds = new Set<string>();
  const laneStates: LaneState[] = input.lanes.map((lane) => {
    const id = laneId(lane.id);
    if (seenLaneIds.has(id)) poolError(`duplicate lane id ${id}`);
    seenLaneIds.add(id);
    const normalizedScopes = laneScopes(lane.scopes);
    return {
      id,
      client: lane.client,
      scopes: normalizedScopes,
      scopeSet: new Set(normalizedScopes),
      budget: createDnaOpenLabRequestBudget({
        nowMilliseconds,
        sleep,
        initialRequestsPerMinute: Math.min(
          DEFAULT_AGGREGATE_REQUESTS_PER_MINUTE,
          maximumLaneRequestsPerMinute,
        ),
        maximumRequestsPerMinute: maximumLaneRequestsPerMinute,
      }),
      requestCount: 0,
      successCount: 0,
      rateLimitedCount: 0,
    };
  });

  const aggregateBudget = independentRateBucketsEnabled
    ? null
    : (() => {
        const aggregateRequestsPerMinute = positiveSafeInteger(
          input.aggregateRequestsPerMinute ??
            DEFAULT_AGGREGATE_REQUESTS_PER_MINUTE,
          "aggregateRequestsPerMinute",
        );
        return createDnaOpenLabRequestBudget({
          nowMilliseconds,
          sleep,
          initialRequestsPerMinute: aggregateRequestsPerMinute,
          maximumRequestsPerMinute: aggregateRequestsPerMinute,
        });
      })();

  let cursor = 0;

  const executeLane = async <T>(input: {
    lane: LaneState;
    request: (
      client: DnaOpenLabClient,
      laneId: string,
    ) => Promise<DnaOpenLabResponse<T>>;
  }): Promise<DnaOpenLabResponse<T>> => {
    input.lane.requestCount += 1;
    try {
      const response = await input.lane.budget.execute(() =>
        input.request(input.lane.client, input.lane.id),
      );
      input.lane.successCount += 1;
      return response;
    } catch (error) {
      if (error instanceof DnaOpenLabApiError && error.kind === "rate_limited") {
        input.lane.rateLimitedCount += 1;
      }
      throw error;
    }
  };

  const execute = async <T>(requestInput: {
    scope: DnaOpenLabScope;
    request: (
      client: DnaOpenLabClient,
      laneId: string,
    ) => Promise<DnaOpenLabResponse<T>>;
  }): Promise<DnaOpenLabResponse<T>> => {
    const scope = requestScope(requestInput.scope);
    const eligibleIndexes = laneStates
      .map((lane, index) => (lane.scopeSet.has(scope) ? index : -1))
      .filter((index) => index >= 0);
    if (eligibleIndexes.length === 0) {
      poolError(`no lane is configured for scope ${scope}`);
    }

    const attempted = new Set<number>();
    while (attempted.size < eligibleIndexes.length) {
      const unattemptedEligible = eligibleIndexes.filter(
        (index) => !attempted.has(index),
      );
      const healthy = firstRoundRobinCandidate({
        lanes: laneStates,
        eligibleIndexes: unattemptedEligible,
        cursor,
        requireUnblocked: true,
      });
      const selectedIndex =
        healthy ??
        firstRoundRobinCandidate({
          lanes: laneStates,
          eligibleIndexes: unattemptedEligible,
          cursor,
          requireUnblocked: false,
        });
      if (selectedIndex === null) {
        poolError(`no lane is available for scope ${scope}`);
      }
      const lane = laneStates[selectedIndex];
      if (lane === undefined) poolError("selected lane is unavailable");
      attempted.add(selectedIndex);
      cursor = (selectedIndex + 1) % laneStates.length;

      try {
        const run = () =>
          executeLane({ lane, request: requestInput.request });
        return aggregateBudget === null
          ? await run()
          : await aggregateBudget.execute(run);
      } catch (error) {
        const mayFailOver =
          independentRateBucketsEnabled &&
          error instanceof DnaOpenLabApiError &&
          error.kind === "rate_limited" &&
          attempted.size < eligibleIndexes.length;
        if (!mayFailOver) throw error;
      }
    }

    return poolError(`all lanes are unavailable for scope ${scope}`);
  };

  const snapshot = (): DnaOpenLabClientPoolSnapshot =>
    Object.freeze({
      independentRateBucketsEnabled,
      aggregateBudget: aggregateBudget?.snapshot() ?? null,
      lanes: Object.freeze(
        laneStates.map((lane) =>
          Object.freeze({
            id: lane.id,
            scopes: lane.scopes,
            requestCount: lane.requestCount,
            successCount: lane.successCount,
            rateLimitedCount: lane.rateLimitedCount,
            budget: lane.budget.snapshot(),
          }),
        ),
      ),
    });

  return Object.freeze({ execute, snapshot });
}
