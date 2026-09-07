import { createHash } from "node:crypto";

import type {
  NeonProLeagueEvidenceGenerationRepository,
  ProLeagueEvidenceFamily,
} from "@/lib/neon-pro-league-evidence-generation-repository";
import type {
  SpillableProLeagueExactFormatRow,
  SpillableProLeagueExactFormatSource,
} from "@/lib/race-archive-spillable-pro-league-exact-format";

type PendingRow = Readonly<{
  naturalKey: string;
  payload: Readonly<Record<string, unknown>>;
}>;

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Pro League evidence ${label} is outside its bound.`);
  }
  return value;
}

function naturalKey(row: SpillableProLeagueExactFormatRow): string {
  return row.kind === "benchmark"
    ? JSON.stringify([
        row.value.raceType.toLowerCase(),
        row.value.distanceMetres,
      ])
    : JSON.stringify([
        row.value.sourceCoreId,
        row.value.raceType.toLowerCase(),
        row.value.distanceMetres,
      ]);
}

function payload(row: SpillableProLeagueExactFormatRow) {
  return row.value as unknown as Readonly<Record<string, unknown>>;
}

export async function publishSpillableProLeagueEvidence(
  input: Readonly<{
    ownerId: string;
    generationId: string;
    raceDatasetVersionId: string;
    workerId: string;
    sourceVersionSetSha256: string;
    evidenceCutoffAt: string;
    publishedAt: string;
    source: SpillableProLeagueExactFormatSource;
    repository: NeonProLeagueEvidenceGenerationRepository;
    maximumRowsPerBatch?: number;
  }>,
): Promise<
  Readonly<{
    disposition: "published" | "existing";
    benchmarkCount: number;
    profileCount: number;
    payloadSha256: string;
    unbenchmarkedEntryCount: number;
  }>
> {
  const maximumRowsPerBatch = boundedInteger(
    input.maximumRowsPerBatch ?? 250,
    "batch size",
    1,
    500,
  );
  const counts: Record<ProLeagueEvidenceFamily, number> = {
    benchmark: 0,
    profile: 0,
  };
  const digests = {
    benchmark: createHash("sha256"),
    profile: createHash("sha256"),
  };
  const pending: Record<ProLeagueEvidenceFamily, PendingRow[]> = {
    benchmark: [],
    profile: [],
  };

  async function flush(family: ProLeagueEvidenceFamily): Promise<void> {
    const rows = pending[family];
    if (rows.length === 0) return;
    const startOrdinal = counts[family];
    const staged = await input.repository.stageRows(input.ownerId, {
      generationId: input.generationId,
      workerId: input.workerId,
      family,
      startOrdinal,
      rows,
    });
    for (const [index, value] of staged.entries()) {
      const expectedOrdinal = startOrdinal + index;
      if (value.ordinal !== expectedOrdinal) {
        throw new Error("Pro League evidence stage acknowledgement drifted.");
      }
      digests[family].update(`${value.ordinal}:${value.sha256}\n`, "utf8");
    }
    counts[family] += rows.length;
    pending[family] = [];
  }

  try {
    const begun = await input.repository.begin(input.ownerId, {
      generationId: input.generationId,
      raceDatasetVersionId: input.raceDatasetVersionId,
      workerId: input.workerId,
      sourceVersionSetSha256: input.sourceVersionSetSha256,
      evidenceCutoffAt: input.evidenceCutoffAt,
      inputObservationCount: input.source.inputObservationCount,
      acceptedEntryCount: input.source.acceptedPublishedCellEntryCount,
      nonBikeEntryCount: input.source.nonBikeEntryCount,
      missingFormatEntryCount: input.source.missingFormatEntryCount,
      unsupportedFormatEntryCount: input.source.unsupportedFormatEntryCount,
      unpublishedCellEntryCount: input.source.unpublishedCellEntryCount,
    });
    if (begun === "published") {
      const active = await input.repository.readActiveGeneration(input.ownerId);
      if (active === null || active.generationId !== input.generationId) {
        throw new Error(
          "Published Pro League evidence replay is no longer the active generation.",
        );
      }
      return {
        disposition: "existing",
        benchmarkCount: active.benchmarkCount,
        profileCount: active.profileCount,
        payloadSha256: active.payloadSha256,
        unbenchmarkedEntryCount: active.unbenchmarkedEntryCount,
      };
    }

    for await (const row of input.source.readRows()) {
      pending[row.kind].push({
        naturalKey: naturalKey(row),
        payload: payload(row),
      });
      if (pending[row.kind].length === maximumRowsPerBatch) {
        await flush(row.kind);
      }
    }
    await flush("benchmark");
    await flush("profile");
    const benchmarkSha256 = digests.benchmark.digest("hex");
    const profileSha256 = digests.profile.digest("hex");
    const payloadSha256 = createHash("sha256")
      .update(
        `benchmark:${counts.benchmark}:${benchmarkSha256}\n` +
          `profile:${counts.profile}:${profileSha256}\n`,
        "utf8",
      )
      .digest("hex");
    const unbenchmarkedEntryCount =
      input.source.unbenchmarkedPublishedCellEntryCount();
    const publication = await input.repository.publish(input.ownerId, {
      generationId: input.generationId,
      workerId: input.workerId,
      expectedBenchmarkCount: counts.benchmark,
      expectedProfileCount: counts.profile,
      unbenchmarkedEntryCount,
      payloadSha256,
      publishedAt: input.publishedAt,
    });
    return {
      ...publication,
      payloadSha256,
      unbenchmarkedEntryCount,
    };
  } finally {
    await input.source.cleanup();
  }
}
