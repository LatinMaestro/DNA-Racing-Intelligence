import { AsyncLocalStorage } from "node:async_hooks";

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
 * server-observed request budget per API key. Permit acquisition and network
 * responses may overlap across calls. Async request context retains the selected
 * credential and per-key rate state through wrappers that await before invoking
 * the coupled provider client.
 */
export function createDnaOpenLabIndependentRaceDocRuntime(
  lanes: readonly DnaOpenLabIndependentRaceDocLane[],
): DnaOpenLabIndependentRaceDocRuntime {
  if (lanes.length < 1 || lanes.length > 16) {
    throw new Error("race-doc lane count is invalid");
  }

  let laneCursor = 0;
  const laneContext =
    new AsyncLocalStorage<DnaOpenLabIndependentRaceDocLane>();

  const client = Object.freeze({
    raceDocs: async (raceIds: Parameters<DnaOpenLabClient["raceDocs"]>[0]) => {
      const lane = laneContext.getStore();
      if (lane === undefined) {
        throw new Error("race-doc lane is not selected");
      }
      return lane.client.raceDocs(raceIds);
    },
  });

  const execute = async <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ): Promise<DnaOpenLabResponse<T>> => {
    const lane = lanes[laneCursor % lanes.length];
    laneCursor += 1;
    if (lane === undefined) throw new Error("race-doc lane is unavailable");

    return lane.requestBudget.execute(() => laneContext.run(lane, request));
  };

  const observeRateLimit = (rateLimit: DnaOpenLabRateLimit): void => {
    const lane = laneContext.getStore();
    if (lane === undefined) {
      throw new Error("race-doc lane is not selected");
    }
    lane.requestBudget.observeRateLimit(rateLimit);
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
