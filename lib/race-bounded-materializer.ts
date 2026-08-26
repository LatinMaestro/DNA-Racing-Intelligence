import type {
  PreparedRacePreactivationMaterialization,
  RacePreactivationMaterializationRecord,
} from "./race-preactivation-materialization-spool";

const MAXIMUM_MATERIALIZATION_BATCH_RECORDS = 5_000;

export type RaceBoundedMaterializationSummary = Readonly<{
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  acceptedNaturalKeyCount: number;
  duplicateReadyRowCount: number;
}>;

export type RaceBoundedMaterializationCommit = Readonly<
  RaceBoundedMaterializationSummary & {
    materializationBatchCount: number;
    materializedNaturalKeyCount: number;
  }
>;

export type RaceBoundedMaterializationSession = Readonly<{
  writeBatch: (input: {
    batchNumber: number;
    records: readonly RacePreactivationMaterializationRecord[];
  }) => Promise<void>;
  commit: (input: RaceBoundedMaterializationCommit) => Promise<void>;
  rollback: (input: { reason: "materialization_failed" }) => Promise<void>;
}>;

export type RaceBoundedMaterializationSink = Readonly<{
  begin: (
    summary: RaceBoundedMaterializationSummary,
  ) => Promise<RaceBoundedMaterializationSession>;
}>;

function safeCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function materializationSummary(
  prepared: PreparedRacePreactivationMaterialization,
): RaceBoundedMaterializationSummary {
  const sourceRowCount = safeCount(prepared.sourceRowCount, "sourceRowCount");
  const readyRowCount = safeCount(prepared.readyRowCount, "readyRowCount");
  const quarantinedRowCount = safeCount(
    prepared.quarantinedRowCount,
    "quarantinedRowCount",
  );
  const acceptedNaturalKeyCount = safeCount(
    prepared.acceptedNaturalKeyCount,
    "acceptedNaturalKeyCount",
  );
  const duplicateReadyRowCount = safeCount(
    prepared.duplicateReadyRowCount,
    "duplicateReadyRowCount",
  );

  if (readyRowCount + quarantinedRowCount !== sourceRowCount) {
    throw new Error("Race bounded materialization source coverage is invalid.");
  }
  if (acceptedNaturalKeyCount < 1) {
    throw new Error(
      "Race bounded materialization has no accepted natural keys.",
    );
  }
  if (acceptedNaturalKeyCount + duplicateReadyRowCount !== readyRowCount) {
    throw new Error(
      "Race bounded materialization ready-row coverage is invalid.",
    );
  }

  return Object.freeze({
    sourceRowCount,
    readyRowCount,
    quarantinedRowCount,
    acceptedNaturalKeyCount,
    duplicateReadyRowCount,
  });
}

async function rollbackAndCleanup(input: {
  session?: RaceBoundedMaterializationSession;
  prepared: PreparedRacePreactivationMaterialization;
  cause: unknown;
}): Promise<never> {
  const cleanupResults = await Promise.allSettled([
    input.session?.rollback({ reason: "materialization_failed" }) ??
      Promise.resolve(),
    input.prepared.cleanup(),
  ]);
  const cleanupFailures = cleanupResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [input.cause, ...cleanupFailures],
      "Race bounded materialization failed and cleanup was incomplete.",
    );
  }
  throw input.cause;
}

export async function materializePreparedRacePreactivation(input: {
  prepared: PreparedRacePreactivationMaterialization;
  sink: RaceBoundedMaterializationSink;
}): Promise<RaceBoundedMaterializationCommit> {
  let summary: RaceBoundedMaterializationSummary;
  try {
    summary = materializationSummary(input.prepared);
  } catch (error) {
    await input.prepared.cleanup().catch(() => undefined);
    throw error;
  }

  let session: RaceBoundedMaterializationSession;
  try {
    session = await input.sink.begin(summary);
  } catch (error) {
    await input.prepared.cleanup().catch(() => undefined);
    throw error;
  }

  let materializationBatchCount = 0;
  let materializedNaturalKeyCount = 0;
  try {
    for await (const records of input.prepared.readBatches()) {
      if (
        records.length < 1 ||
        records.length > MAXIMUM_MATERIALIZATION_BATCH_RECORDS
      ) {
        throw new Error(
          "Race materialization batch is outside its safe bound.",
        );
      }
      materializationBatchCount += 1;
      materializedNaturalKeyCount += records.length;
      if (
        !Number.isSafeInteger(materializationBatchCount) ||
        !Number.isSafeInteger(materializedNaturalKeyCount) ||
        materializedNaturalKeyCount > summary.acceptedNaturalKeyCount
      ) {
        throw new Error("Race bounded materialization progress is unsafe.");
      }
      await session.writeBatch({
        batchNumber: materializationBatchCount,
        records,
      });
    }

    if (materializedNaturalKeyCount !== summary.acceptedNaturalKeyCount) {
      throw new Error("Race bounded materialization coverage changed.");
    }

    const commit = Object.freeze({
      ...summary,
      materializationBatchCount,
      materializedNaturalKeyCount,
    });
    await session.commit(commit);
    await input.prepared.cleanup();
    return commit;
  } catch (error) {
    return rollbackAndCleanup({
      session,
      prepared: input.prepared,
      cause: error,
    });
  }
}
