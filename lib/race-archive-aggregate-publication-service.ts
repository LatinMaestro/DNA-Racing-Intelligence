import type {
  NeonRaceArchiveAggregatePublicationRepository,
  RaceArchiveAggregateFamily,
} from "./neon-race-archive-aggregate-publication";

const FAMILY_BOUNDS: Readonly<Record<RaceArchiveAggregateFamily, number>> =
  Object.freeze({
    core_performance: 500_000,
    discovery_benchmark: 100_000,
    payout_format: 500_000,
    core_star_profile: 500_000,
  });

export type RaceArchiveAggregatePublicationRows = Readonly<{
  corePerformance: readonly Readonly<Record<string, unknown>>[];
  discoveryBenchmarks: readonly Readonly<Record<string, unknown>>[];
  payoutFormatProfiles: readonly Readonly<Record<string, unknown>>[];
  coreStarProfiles: readonly Readonly<Record<string, unknown>>[];
}>;

export type RaceArchiveAggregatePublicationResult = Readonly<{
  status: "published" | "existing";
  materializedRowCount: number;
  stagedRowCount: number;
}>;

function safeInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function chunkSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_000) {
    throw new Error("maximumRowsPerStage is outside its bound");
  }
  return value;
}

function rows(
  values: readonly Readonly<Record<string, unknown>>[],
  family: RaceArchiveAggregateFamily,
): readonly Readonly<Record<string, unknown>>[] {
  if (values.length > FAMILY_BOUNDS[family]) {
    throw new Error(`${family} row count exceeds its publication bound`);
  }
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${family} rows must be objects`);
    }
  }
  return values;
}

async function stageFamily(input: {
  repository: NeonRaceArchiveAggregatePublicationRepository;
  ownerId: string;
  refreshId: string;
  workerId: string;
  family: RaceArchiveAggregateFamily;
  rows: readonly Readonly<Record<string, unknown>>[];
  maximumRowsPerStage: number;
}): Promise<number> {
  let stagedRowCount = 0;
  for (
    let startOrdinal = 0;
    startOrdinal < input.rows.length;
    startOrdinal += input.maximumRowsPerStage
  ) {
    const chunk = input.rows.slice(
      startOrdinal,
      startOrdinal + input.maximumRowsPerStage,
    );
    const staged = await input.repository.stageRows({
      ownerId: input.ownerId,
      refreshId: input.refreshId,
      workerId: input.workerId,
      family: input.family,
      startOrdinal,
      rows: chunk,
    });
    if (staged !== chunk.length) {
      throw new Error(`${input.family} staged row count changed`);
    }
    stagedRowCount += staged;
  }
  return stagedRowCount;
}

export async function publishRaceArchiveAggregates(input: {
  repository: NeonRaceArchiveAggregatePublicationRepository;
  ownerId: string;
  refreshId: string;
  raceDatasetVersionId: string;
  workerId: string;
  sourceVersionSetSha256: string;
  payloadSha256: string;
  refreshedAt: string;
  completedAt: string;
  validatedEventCount: number;
  acceptedFormatEntryCount: number;
  rows: RaceArchiveAggregatePublicationRows;
  maximumRowsPerStage?: number;
}): Promise<RaceArchiveAggregatePublicationResult> {
  const maximumRowsPerStage = chunkSize(input.maximumRowsPerStage ?? 2_000);
  const validatedEventCount = safeInteger(
    input.validatedEventCount,
    "validatedEventCount",
    1_000_000,
  );
  const acceptedFormatEntryCount = safeInteger(
    input.acceptedFormatEntryCount,
    "acceptedFormatEntryCount",
    5_000_000,
  );
  const corePerformance = rows(input.rows.corePerformance, "core_performance");
  const discoveryBenchmarks = rows(
    input.rows.discoveryBenchmarks,
    "discovery_benchmark",
  );
  const payoutFormatProfiles = rows(
    input.rows.payoutFormatProfiles,
    "payout_format",
  );
  const coreStarProfiles = rows(
    input.rows.coreStarProfiles,
    "core_star_profile",
  );
  if (acceptedFormatEntryCount < payoutFormatProfiles.length) {
    throw new Error("acceptedFormatEntryCount is inconsistent");
  }

  const beginStatus = await input.repository.begin({
    ownerId: input.ownerId,
    refreshId: input.refreshId,
    raceDatasetVersionId: input.raceDatasetVersionId,
    workerId: input.workerId,
    sourceVersionSetSha256: input.sourceVersionSetSha256,
    refreshedAt: input.refreshedAt,
  });

  let stagedRowCount = 0;
  if (beginStatus === "staging") {
    for (const [family, familyRows] of [
      ["core_performance", corePerformance],
      ["discovery_benchmark", discoveryBenchmarks],
      ["payout_format", payoutFormatProfiles],
      ["core_star_profile", coreStarProfiles],
    ] as const) {
      stagedRowCount += await stageFamily({
        repository: input.repository,
        ownerId: input.ownerId,
        refreshId: input.refreshId,
        workerId: input.workerId,
        family,
        rows: familyRows,
        maximumRowsPerStage,
      });
    }
  }

  const publication = await input.repository.publish({
    ownerId: input.ownerId,
    refreshId: input.refreshId,
    workerId: input.workerId,
    payloadSha256: input.payloadSha256,
    validatedEventCount,
    acceptedFormatEntryCount,
    corePerformanceProfileCount: corePerformance.length,
    discoveryBenchmarkCount: discoveryBenchmarks.length,
    payoutFormatProfileCount: payoutFormatProfiles.length,
    coreStarProfileCount: coreStarProfiles.length,
    completedAt: input.completedAt,
  });

  return Object.freeze({
    status: publication.status,
    materializedRowCount: publication.materializedRowCount,
    stagedRowCount,
  });
}
