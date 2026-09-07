import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { NeonProLeagueEvidenceGenerationRepository } from "@/lib/neon-pro-league-evidence-generation-repository";
import { publishSpillableProLeagueEvidence } from "@/lib/pro-league-evidence-publication-service";
import type {
  SpillableProLeagueExactFormatRow,
  SpillableProLeagueExactFormatSource,
} from "@/lib/race-archive-spillable-pro-league-exact-format";

const generationId = "84000000-0000-4000-8000-000000000301";
const rows: readonly SpillableProLeagueExactFormatRow[] = [
  {
    kind: "benchmark",
    value: {
      raceType: "1v1",
      distanceMetres: 1000,
      resultRule: "first_place",
      mapIds: ["map-1"],
      refreshedAt: "2026-09-07T01:00:00.000Z",
      dataCurrentThrough: "2026-09-07T00:00:00.000Z",
      raceEntryCount: 2,
      coreCount: 2,
      winningEntryCount: 1,
      topThreeEntryCount: 2,
      winningP25Milliseconds: 1000,
      winningMedianMilliseconds: 1000,
      winningP75Milliseconds: 1000,
      winningStandardDeviationMilliseconds: 0,
      winningInterquartileRangeMilliseconds: 0,
      topThreeP25Milliseconds: 1025,
      topThreeMedianMilliseconds: 1050,
      topThreeP75Milliseconds: 1075,
      topThreeStandardDeviationMilliseconds: 50,
      topThreeInterquartileRangeMilliseconds: 50,
    },
  },
  {
    kind: "profile",
    value: {
      sourceCoreId: "core-1",
      raceType: "1v1",
      distanceMetres: 1000,
      raceCount: 1,
      sampleStatus: "hypothesis_only",
      freshness: "current",
      dataCurrentThrough: "2026-09-07T00:00:00.000Z",
      benchmarkAssessment: "winning_range",
      elapsedTime: {
        bestMilliseconds: 1000,
        medianMilliseconds: 1000,
        trimmedMeanMilliseconds: 1000,
        standardDeviationMilliseconds: 0,
        interquartileRangeMilliseconds: 0,
      },
      speed: { bestMetresPerSecond: 1000, medianMetresPerSecond: 1000 },
      populationBenchmark: {} as never,
      supportingEvidence: {} as never,
    },
  },
];

function source(overrides: Partial<SpillableProLeagueExactFormatSource> = {}) {
  const cleanup = vi.fn(async () => undefined);
  const value: SpillableProLeagueExactFormatSource = {
    inputObservationCount: 4,
    acceptedPublishedCellEntryCount: 2,
    nonBikeEntryCount: 1,
    missingFormatEntryCount: 1,
    unsupportedFormatEntryCount: 0,
    unpublishedCellEntryCount: 0,
    preparationInitialRunCount: 2,
    unbenchmarkedPublishedCellEntryCount: () => 0,
    readRows: () =>
      (async function* () {
        try {
          for (const row of rows) yield row;
        } finally {
          await cleanup();
        }
      })(),
    cleanup,
    ...overrides,
  };
  return { cleanup, value };
}

function repository() {
  const begin = vi.fn(async () => "staging" as const);
  const stageRows = vi.fn(async (_ownerId, input) =>
    input.rows.map((_: unknown, index: number) => ({
      ordinal: input.startOrdinal + index,
      sha256: input.family === "benchmark" ? "a".repeat(64) : "b".repeat(64),
    })),
  );
  const publish = vi.fn(async (_ownerId, input) => ({
    disposition: "published" as const,
    benchmarkCount: input.expectedBenchmarkCount,
    profileCount: input.expectedProfileCount,
  }));
  const value = {
    begin,
    stageRows,
    publish,
    readActiveGeneration: vi.fn(),
    listActiveRows: vi.fn(),
  } as unknown as NeonProLeagueEvidenceGenerationRepository;
  return { begin, publish, stageRows, value };
}

describe("Pro League evidence publication service", () => {
  it("streams bounded families, verifies their digest and publishes once", async () => {
    const inputSource = source();
    const target = repository();
    const result = await publishSpillableProLeagueEvidence({
      ownerId: "private_owner",
      generationId,
      raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
      workerId: "evidence-worker",
      sourceVersionSetSha256: "c".repeat(64),
      evidenceCutoffAt: "2026-09-07T01:00:00Z",
      publishedAt: "2026-09-07T01:01:00Z",
      source: inputSource.value,
      repository: target.value,
      maximumRowsPerBatch: 1,
    });
    const benchmarkDigest = createHash("sha256")
      .update(`0:${"a".repeat(64)}\n`)
      .digest("hex");
    const profileDigest = createHash("sha256")
      .update(`0:${"b".repeat(64)}\n`)
      .digest("hex");
    const expectedDigest = createHash("sha256")
      .update(`benchmark:1:${benchmarkDigest}\nprofile:1:${profileDigest}\n`)
      .digest("hex");
    expect(result).toEqual({
      disposition: "published",
      benchmarkCount: 1,
      profileCount: 1,
      payloadSha256: expectedDigest,
      unbenchmarkedEntryCount: 0,
    });
    expect(target.stageRows).toHaveBeenCalledTimes(2);
    expect(target.publish).toHaveBeenCalledWith(
      "private_owner",
      expect.objectContaining({ payloadSha256: expectedDigest }),
    );
    expect(inputSource.cleanup).toHaveBeenCalledOnce();
  });

  it("keeps partial staged work invisible and still cleans source scratch on failure", async () => {
    const inputSource = source();
    const target = repository();
    target.stageRows.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      publishSpillableProLeagueEvidence({
        ownerId: "private_owner",
        generationId,
        raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
        workerId: "evidence-worker",
        sourceVersionSetSha256: "c".repeat(64),
        evidenceCutoffAt: "2026-09-07T01:00:00Z",
        publishedAt: "2026-09-07T01:01:00Z",
        source: inputSource.value,
        repository: target.value,
        maximumRowsPerBatch: 1,
      }),
    ).rejects.toThrow("database unavailable");
    expect(target.publish).not.toHaveBeenCalled();
    expect(inputSource.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans an unread source when an identical generation is already published", async () => {
    const inputSource = source();
    const target = repository();
    target.begin.mockResolvedValueOnce("published");
    vi.mocked(target.value.readActiveGeneration).mockResolvedValueOnce({
      generationId,
      raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
      sourceVersionSetSha256: "c".repeat(64),
      evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
      inputObservationCount: 4,
      acceptedEntryCount: 2,
      nonBikeEntryCount: 1,
      missingFormatEntryCount: 1,
      unsupportedFormatEntryCount: 0,
      unpublishedCellEntryCount: 0,
      unbenchmarkedEntryCount: 0,
      benchmarkCount: 1,
      profileCount: 1,
      payloadSha256: "d".repeat(64),
      publishedAt: "2026-09-07T01:01:00.000Z",
    });

    await expect(
      publishSpillableProLeagueEvidence({
        ownerId: "private_owner",
        generationId,
        raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
        workerId: "evidence-worker",
        sourceVersionSetSha256: "c".repeat(64),
        evidenceCutoffAt: "2026-09-07T01:00:00Z",
        publishedAt: "2026-09-07T01:01:00Z",
        source: inputSource.value,
        repository: target.value,
      }),
    ).resolves.toMatchObject({ disposition: "existing" });
    expect(target.stageRows).not.toHaveBeenCalled();
    expect(target.publish).not.toHaveBeenCalled();
    expect(inputSource.cleanup).toHaveBeenCalledOnce();
  });
});
