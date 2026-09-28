import type {
  DnaOpenLabClient,
  DnaOpenLabRateLimit,
  DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";
import type {
  DnaOpenLabRequestBudget,
  DnaOpenLabRequestBudgetSnapshot,
} from "./dna-open-lab-request-budget";

export type DnaOpenLabIndependentRaceDocLane = Readonly<{
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
}>;

export type DnaOpenLabIndependentRaceDocRuntime = Readonly<{
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
}>;

function snapshot(
  lanes: readonly DnaOpenLabIndependentRaceDocLane[],
): DnaOpenLabRequestBudgetSnapshot {
  const snapshots = lanes.map((lane) => lane.requestBudget.snapshot());
  return Object.freeze({
    effectiveRequestsPerMinute: snapshots.reduce(
      (total, item) => total + item.effectiveRequestsPerMinute,
      0,
    ),
    requestsInCurrentWindow: snapshots.reduce(
      (total, item) => total + item.requestsInCurrentWindow,
      0,
    ),
    blockedUntilMilliseconds: snapshots.reduce<number | null>(
      (latest, item) => {
        if (item.blockedUntilMilliseconds === null) return latest;
        return latest === null
          ? item.blockedUntilMilliseconds
          : Math.max(latest, item.blockedUntilMilliseconds);
      },
      null,
    ),
  });
}

/**
 * Couples a deterministic round-robin Race-doc client with one independent
 * server-observed request budget per API key. Calls are serialized so the
 * selected credential cannot bleed across requests, while each key retains
 * its own 30-RPM window and response-derived rate state.
 */
export function createDnaOpenLabIndependentRaceDocRuntime(
  lanes: readonly DnaOpenLabIndependentRaceDocLane[],
): DnaOpenLabIndependentRaceDocRuntime {
  if (lanes.length < 1 || lanes.length > 16) {
    throw new Error("race-doc lane count is invalid");
  }

  let laneCursor = 0;
  let activeLane: DnaOpenLabIndependentRaceDocLane | null = null;
  let executionTail: Promise<void> = Promise.resolve();

  const client = Object.freeze({
    raceDocs: async (raceIds: Parameters<DnaOpenLabClient["raceDocs"]>[0]) => {
      if (activeLane === null) {
        throw new Error("race-doc lane is not selected");
      }
      return activeLane.client.raceDocs(raceIds);
    },
  });

  const execute = async <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ): Promise<DnaOpenLabResponse<T>> => {
    const previous = executionTail;
    let release: (() => void) | undefined;
    executionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const lane = lanes[laneCursor % lanes.length];
    laneCursor += 1;
    if (lane === undefined) throw new Error("race-doc lane is unavailable");
    try {
      return await lane.requestBudget.execute(async () => {
        if (activeLane !== null) {
          throw new Error("race-doc lane overlap is unavailable");
        }
        activeLane = lane;
        try {
          return await request();
        } finally {
          activeLane = null;
        }
      });
    } finally {
      release?.();
    }
  };

  const observeRateLimit = (rateLimit: DnaOpenLabRateLimit): void => {
    if (activeLane === null) {
      throw new Error("race-doc lane is not selected");
    }
    activeLane.requestBudget.observeRateLimit(rateLimit);
  };

  const reduceEffectiveRequestsPerMinute = (
    requestsPerMinute: number,
  ): void => {
    if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error("requestsPerMinute must be a positive safe integer");
    }
    const perLane = Math.max(1, Math.floor(requestsPerMinute / lanes.length));
    for (const lane of lanes) {
      lane.requestBudget.reduceEffectiveRequestsPerMinute(perLane);
    }
  };

  return Object.freeze({
    client,
    requestBudget: Object.freeze({
      execute,
      observeRateLimit,
      reduceEffectiveRequestsPerMinute,
      snapshot: () => snapshot(lanes),
    }),
  });
}
