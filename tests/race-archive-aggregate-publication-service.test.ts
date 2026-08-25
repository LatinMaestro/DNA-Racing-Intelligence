import { describe, expect, it, vi } from "vitest";

import type { NeonRaceArchiveAggregatePublicationRepository } from "../lib/neon-race-archive-aggregate-publication";
import { publishRaceArchiveAggregates } from "../lib/race-archive-aggregate-publication-service";

const baseInput = {
  ownerId: "owner-1",
  refreshId: "22222222-2222-4222-8222-222222222222",
  raceDatasetVersionId: "33333333-3333-4333-8333-333333333333",
  workerId: "aggregate-worker-1",
  sourceVersionSetSha256: "a".repeat(64),
  payloadSha256: "b".repeat(64),
  refreshedAt: "2026-08-25T00:00:00.000Z",
  completedAt: "2026-08-25T00:05:00.000Z",
  validatedEventCount: 20,
  acceptedFormatEntryCount: 30,
} as const;

function repository(input?: {
  beginStatus?: "staging" | "published";
  publishStatus?: "published" | "existing";
  stagedCountOverride?: number;
}) {
  const begin = vi.fn(async () => input?.beginStatus ?? "staging");
  const stageRows = vi.fn(
    async (value: { rows: readonly unknown[] }) =>
      input?.stagedCountOverride ?? value.rows.length,
  );
  const publish = vi.fn(async () => ({
    status: input?.publishStatus ?? "published",
    materializedRowCount: 80,
  }));
  return {
    repository: {
      begin,
      stageRows,
      publish,
    } as NeonRaceArchiveAggregatePublicationRepository,
    begin,
    stageRows,
    publish,
  };
}

describe("Race archive aggregate publication service", () => {
  it("stages each family in bounded ordinal chunks before one atomic publish", async () => {
    const test = repository();
    const corePerformance = Array.from({ length: 2_001 }, (_, index) => ({
      source_core_id: `core-${index}`,
    }));
    const discoveryBenchmarks = [{ mode: "bike", distance_metres: 1000 }];
    const payoutFormatProfiles = [{ source_core_id: "core-1" }];
    const coreStarProfiles = [{ source_core_id: "core-1", distance: 1000 }];

    await expect(
      publishRaceArchiveAggregates({
        ...baseInput,
        repository: test.repository,
        rows: {
          corePerformance,
          discoveryBenchmarks,
          payoutFormatProfiles,
          coreStarProfiles,
        },
      }),
    ).resolves.toEqual({
      status: "published",
      materializedRowCount: 80,
      stagedRowCount: 2_004,
    });

    expect(test.begin).toHaveBeenCalledOnce();
    expect(test.stageRows).toHaveBeenCalledTimes(5);
    expect(
      test.stageRows.mock.calls.map(([value]) => [
        value.family,
        value.startOrdinal,
        value.rows.length,
      ]),
    ).toEqual([
      ["core_performance", 0, 2_000],
      ["core_performance", 2_000, 1],
      ["discovery_benchmark", 0, 1],
      ["payout_format", 0, 1],
      ["core_star_profile", 0, 1],
    ]);
    expect(test.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        corePerformanceProfileCount: 2_001,
        discoveryBenchmarkCount: 1,
        payoutFormatProfileCount: 1,
        coreStarProfileCount: 1,
      }),
    );
  });

  it("verifies an existing publication without restaging immutable rows", async () => {
    const test = repository({
      beginStatus: "published",
      publishStatus: "existing",
    });

    await expect(
      publishRaceArchiveAggregates({
        ...baseInput,
        repository: test.repository,
        rows: {
          corePerformance: [{ source_core_id: "core-1" }],
          discoveryBenchmarks: [],
          payoutFormatProfiles: [],
          coreStarProfiles: [],
        },
      }),
    ).resolves.toEqual({
      status: "existing",
      materializedRowCount: 80,
      stagedRowCount: 0,
    });

    expect(test.stageRows).not.toHaveBeenCalled();
    expect(test.publish).toHaveBeenCalledOnce();
  });

  it("supports empty families without emitting invalid zero-row staging calls", async () => {
    const test = repository();

    await publishRaceArchiveAggregates({
      ...baseInput,
      repository: test.repository,
      rows: {
        corePerformance: [],
        discoveryBenchmarks: [],
        payoutFormatProfiles: [],
        coreStarProfiles: [],
      },
    });

    expect(test.stageRows).not.toHaveBeenCalled();
    expect(test.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        corePerformanceProfileCount: 0,
        discoveryBenchmarkCount: 0,
        payoutFormatProfileCount: 0,
        coreStarProfileCount: 0,
      }),
    );
  });

  it("fails closed on impossible payout evidence before claiming publication", async () => {
    const test = repository();

    await expect(
      publishRaceArchiveAggregates({
        ...baseInput,
        acceptedFormatEntryCount: 0,
        repository: test.repository,
        rows: {
          corePerformance: [],
          discoveryBenchmarks: [],
          payoutFormatProfiles: [{ source_core_id: "core-1" }],
          coreStarProfiles: [],
        },
      }),
    ).rejects.toThrow("acceptedFormatEntryCount is inconsistent");

    expect(test.begin).not.toHaveBeenCalled();
  });

  it("fails closed when the persistence adapter reports a changed staged count", async () => {
    const test = repository({ stagedCountOverride: 0 });

    await expect(
      publishRaceArchiveAggregates({
        ...baseInput,
        repository: test.repository,
        rows: {
          corePerformance: [{ source_core_id: "core-1" }],
          discoveryBenchmarks: [],
          payoutFormatProfiles: [],
          coreStarProfiles: [],
        },
      }),
    ).rejects.toThrow("core_performance staged row count changed");

    expect(test.publish).not.toHaveBeenCalled();
  });
});
