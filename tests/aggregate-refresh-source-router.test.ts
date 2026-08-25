import { describe, expect, it, vi } from "vitest";

import { createAggregateRefreshSourceRouter } from "../lib/aggregate-refresh-source-router";
import type { BoundedAggregateRefresher } from "../lib/import-aggregate-refresh-service";
import type { AggregateRefreshTargetSourceReader } from "../lib/neon-aggregate-refresh-target-source";

const request = {
  ownerId: "owner-1",
  refreshId: "22222222-2222-4222-8222-222222222222",
  updateSessionId: "33333333-3333-4333-8333-333333333333",
  sourceVersionSetSha256: "a".repeat(64),
} as const;

const raceResult = {
  preparedAggregateSetId: "44444444-4444-4444-8444-444444444444",
  sourceVersionSetSha256: request.sourceVersionSetSha256,
  aggregateFamilyCount: 4,
  materializedRowCount: 40,
} as const;

const currentStateResult = {
  preparedAggregateSetId: "55555555-5555-4555-8555-555555555555",
  sourceVersionSetSha256: request.sourceVersionSetSha256,
  aggregateFamilyCount: 2,
  materializedRowCount: 20,
} as const;

function harness(sourceType: "race_merge" | "core_details" | "current_arena") {
  const targetSourceType = vi.fn(async () => sourceType);
  const racePrepare = vi.fn(async () => raceResult);
  const currentStatePrepare = vi.fn(async () => currentStateResult);
  const targetSourceReader: AggregateRefreshTargetSourceReader = {
    targetSourceType,
  };
  const raceRefresher: BoundedAggregateRefresher = { prepare: racePrepare };
  const currentStateRefresher: BoundedAggregateRefresher = {
    prepare: currentStatePrepare,
  };
  return {
    router: createAggregateRefreshSourceRouter({
      targetSourceReader,
      raceRefresher,
      currentStateRefresher,
    }),
    targetSourceType,
    racePrepare,
    currentStatePrepare,
  };
}

describe("aggregate refresh source router", () => {
  it("routes Race Merge claims only to archive-backed reconstruction", async () => {
    const test = harness("race_merge");

    await expect(test.router.prepare(request)).resolves.toEqual(raceResult);

    expect(test.targetSourceType).toHaveBeenCalledWith(request);
    expect(test.racePrepare).toHaveBeenCalledWith(request);
    expect(test.currentStatePrepare).not.toHaveBeenCalled();
  });

  it.each(["core_details", "current_arena"] as const)(
    "routes %s claims to the current-state refresher",
    async (sourceType) => {
      const test = harness(sourceType);

      await expect(test.router.prepare(request)).resolves.toEqual(
        currentStateResult,
      );

      expect(test.targetSourceType).toHaveBeenCalledWith(request);
      expect(test.currentStatePrepare).toHaveBeenCalledWith(request);
      expect(test.racePrepare).not.toHaveBeenCalled();
    },
  );

  it("fails closed before either refresher when source selection fails", async () => {
    const error = new Error("target source unavailable");
    const targetSourceType = vi.fn(async () => {
      throw error;
    });
    const racePrepare = vi.fn(async () => raceResult);
    const currentStatePrepare = vi.fn(async () => currentStateResult);
    const router = createAggregateRefreshSourceRouter({
      targetSourceReader: { targetSourceType },
      raceRefresher: { prepare: racePrepare },
      currentStateRefresher: { prepare: currentStatePrepare },
    });

    await expect(router.prepare(request)).rejects.toThrow(error);
    expect(racePrepare).not.toHaveBeenCalled();
    expect(currentStatePrepare).not.toHaveBeenCalled();
  });
});
