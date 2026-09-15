import { createHash } from "node:crypto";

import type {
  DnaCoreRaceHistoryJoinedObservation,
  DnaCoreRaceHistoryMaterialization,
} from "@/lib/dna-core-race-history-materialization";
import {
  dnaOpenLabRawEvidenceCanonicalJson,
  dnaOpenLabRawEvidenceSha256,
} from "@/lib/dna-open-lab-v1-adapters";

export const DNA_CORE_RACE_HISTORY_GENERATION_VERSION = 1 as const;
export const DNA_CORE_RACE_HISTORY_GENERATION_STAGE_BATCH_SIZE = 250;
export const DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS = 500_000;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export type DnaCoreRaceHistoryGenerationMetadata = Readonly<{
  version: typeof DNA_CORE_RACE_HISTORY_GENERATION_VERSION;
  generationId: string;
  materializedAt: string;
  cycleSetSha256: string;
  observationSetSha256: string;
  payloadSha256: string;
  inputCycleCount: number;
  inputPageCount: number;
  inputResultCount: number;
  replayDuplicateCount: number;
  raceDocumentCount: number;
  exactDistanceConfirmedCount: number;
  acceptedPublishedCellCount: number;
  missingFormatCount: number;
  unsupportedFormatCount: number;
  unpublishedCellCount: number;
  observationCount: number;
}>;

export type DnaCoreRaceHistoryPublishedGeneration =
  DnaCoreRaceHistoryGenerationMetadata &
    Readonly<{
      state: "published";
      publishedAt: string;
    }>;

export type DnaCoreRaceHistoryGenerationStageRow = Readonly<{
  ordinal: number;
  naturalKey: string;
  rowSha256: string;
  canonicalPayload: string;
  payload: DnaCoreRaceHistoryJoinedObservation;
}>;

export type DnaCoreRaceHistoryGenerationRepository = Readonly<{
  begin(
    ownerId: string,
    input: Readonly<{
      workerId: string;
      generation: DnaCoreRaceHistoryGenerationMetadata;
    }>,
  ): Promise<"staging" | "published">;
  stageRows(
    ownerId: string,
    input: Readonly<{
      workerId: string;
      generationId: string;
      startOrdinal: number;
      rows: readonly DnaCoreRaceHistoryGenerationStageRow[];
    }>,
  ): Promise<readonly Readonly<{ ordinal: number; rowSha256: string }>[]>;
  publish(
    ownerId: string,
    input: Readonly<{
      workerId: string;
      generationId: string;
      expectedObservationCount: number;
      payloadSha256: string;
      publishedAt: string;
    }>,
  ): Promise<DnaCoreRaceHistoryPublishedGeneration>;
  load(
    ownerId: string,
    generationId: string,
  ): Promise<DnaCoreRaceHistoryPublishedGeneration | null>;
}>;

function generationError(message: string): never {
  throw new Error(`DNA Core race history generation: ${message}`);
}

function timestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    return generationError(`${field} is invalid`);
  }
  return new Date(value).toISOString();
}

function sha256(value: string, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    return generationError(`${field} is invalid`);
  }
  return value;
}

function count(value: number, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS
  ) {
    return generationError(`${field} is invalid`);
  }
  return value;
}

function workerId(value: string): string {
  if (typeof value !== "string" || !SAFE_WORKER_PATTERN.test(value)) {
    return generationError("workerId is invalid");
  }
  return value;
}

function generationMetadata(
  materialization: DnaCoreRaceHistoryMaterialization,
): Readonly<{
  generation: DnaCoreRaceHistoryGenerationMetadata;
  rows: readonly DnaCoreRaceHistoryGenerationStageRow[];
}> {
  const materializedAt = timestamp(
    materialization.materializedAt,
    "materializedAt",
  );
  const cycleSetSha256 = sha256(
    materialization.cycleSetSha256,
    "cycleSetSha256",
  );
  const observationSetSha256 = sha256(
    materialization.observationSetSha256,
    "observationSetSha256",
  );
  const observations = materialization.observations;
  if (
    observations.length >
      DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS ||
    dnaOpenLabRawEvidenceSha256(observations) !== observationSetSha256
  ) {
    return generationError("observation authority is invalid");
  }

  let previousNaturalKey: string | null = null;
  const rows = observations.map((observation, ordinal) => {
    if (
      typeof observation.naturalKey !== "string" ||
      observation.naturalKey.length < 1 ||
      observation.naturalKey.length > 1024 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(observation.naturalKey) ||
      (previousNaturalKey !== null &&
        previousNaturalKey.localeCompare(observation.naturalKey) >= 0)
    ) {
      return generationError("observation order or identity is invalid");
    }
    previousNaturalKey = observation.naturalKey;
    return Object.freeze({
      ordinal,
      naturalKey: observation.naturalKey,
      rowSha256: dnaOpenLabRawEvidenceSha256(observation),
      canonicalPayload: dnaOpenLabRawEvidenceCanonicalJson(observation),
      payload: observation,
    });
  });
  const payloadSha256 = createHash("sha256")
    .update(
      rows
        .map(
          ({ ordinal, naturalKey, rowSha256 }) =>
            `${ordinal}:${naturalKey}:${rowSha256}\n`,
        )
        .join(""),
      "utf8",
    )
    .digest("hex");
  const counts = Object.freeze({
    inputCycleCount: count(materialization.inputCycleCount, "inputCycleCount"),
    inputPageCount: count(materialization.inputPageCount, "inputPageCount"),
    inputResultCount: count(
      materialization.inputResultCount,
      "inputResultCount",
    ),
    replayDuplicateCount: count(
      materialization.replayDuplicateCount,
      "replayDuplicateCount",
    ),
    raceDocumentCount: count(
      materialization.raceDocumentCount,
      "raceDocumentCount",
    ),
    exactDistanceConfirmedCount: count(
      materialization.exactDistanceConfirmedCount,
      "exactDistanceConfirmedCount",
    ),
    acceptedPublishedCellCount: count(
      materialization.acceptedPublishedCellCount,
      "acceptedPublishedCellCount",
    ),
    missingFormatCount: count(
      materialization.missingFormatCount,
      "missingFormatCount",
    ),
    unsupportedFormatCount: count(
      materialization.unsupportedFormatCount,
      "unsupportedFormatCount",
    ),
    unpublishedCellCount: count(
      materialization.unpublishedCellCount,
      "unpublishedCellCount",
    ),
    observationCount: observations.length,
  });
  if (
    counts.exactDistanceConfirmedCount !== observations.length ||
    counts.acceptedPublishedCellCount +
      counts.missingFormatCount +
      counts.unsupportedFormatCount +
      counts.unpublishedCellCount !==
      observations.length ||
    counts.inputResultCount !==
      observations.length + counts.replayDuplicateCount
  ) {
    return generationError("materialization counts disagree");
  }
  const identity = Object.freeze({
    version: DNA_CORE_RACE_HISTORY_GENERATION_VERSION,
    materializedAt,
    cycleSetSha256,
    observationSetSha256,
    payloadSha256,
    ...counts,
  });
  return Object.freeze({
    generation: Object.freeze({
      ...identity,
      generationId: dnaOpenLabRawEvidenceSha256(identity),
    }),
    rows: Object.freeze(rows),
  });
}

function assertPublished(
  actual: DnaCoreRaceHistoryPublishedGeneration,
  expected: DnaCoreRaceHistoryGenerationMetadata,
  publishedAt?: string,
): DnaCoreRaceHistoryPublishedGeneration {
  const normalizedPublishedAt = timestamp(actual.publishedAt, "publishedAt");
  if (
    actual.state !== "published" ||
    normalizedPublishedAt !== actual.publishedAt ||
    (publishedAt !== undefined && normalizedPublishedAt !== publishedAt) ||
    Date.parse(normalizedPublishedAt) < Date.parse(expected.materializedAt)
  ) {
    return generationError("published generation is invalid");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof typeof actual] !== value) {
      return generationError("published generation authority drifted");
    }
  }
  return Object.freeze({ ...actual, publishedAt: normalizedPublishedAt });
}

/**
 * Stages a complete joined result set in bounded, replay-safe batches and asks
 * the repository to replace last-good only after exact count and digest
 * verification. A staging or publication failure is surfaced without claiming
 * that the candidate became serving authority.
 */
export async function publishDnaCoreRaceHistoryGeneration(input: {
  ownerId: string;
  workerId: string;
  publishedAt: string;
  materialization: DnaCoreRaceHistoryMaterialization;
  repository: DnaCoreRaceHistoryGenerationRepository;
}): Promise<DnaCoreRaceHistoryPublishedGeneration> {
  if (
    input.ownerId !== input.materialization.ownerId ||
    input.ownerId.trim() !== input.ownerId ||
    input.ownerId.length < 1
  ) {
    return generationError("owner authority is invalid");
  }
  const worker = workerId(input.workerId);
  const publishedAt = timestamp(input.publishedAt, "publishedAt");
  const { generation, rows } = generationMetadata(input.materialization);
  if (Date.parse(publishedAt) < Date.parse(generation.materializedAt)) {
    return generationError("publishedAt predates materialization");
  }
  const disposition = await input.repository.begin(input.ownerId, {
    workerId: worker,
    generation,
  });
  if (disposition === "published") {
    const existing = await input.repository.load(
      input.ownerId,
      generation.generationId,
    );
    if (existing === null) {
      return generationError("published replay is unavailable");
    }
    return assertPublished(existing, generation);
  }
  if (disposition !== "staging") {
    return generationError("begin disposition is invalid");
  }

  for (
    let startOrdinal = 0;
    startOrdinal < rows.length;
    startOrdinal += DNA_CORE_RACE_HISTORY_GENERATION_STAGE_BATCH_SIZE
  ) {
    const batch = rows.slice(
      startOrdinal,
      startOrdinal + DNA_CORE_RACE_HISTORY_GENERATION_STAGE_BATCH_SIZE,
    );
    const accepted = await input.repository.stageRows(input.ownerId, {
      workerId: worker,
      generationId: generation.generationId,
      startOrdinal,
      rows: batch,
    });
    if (
      accepted.length !== batch.length ||
      accepted.some(
        (entry, index) =>
          entry.ordinal !== startOrdinal + index ||
          entry.rowSha256 !== batch[index]?.rowSha256,
      )
    ) {
      return generationError("staged row authority drifted");
    }
  }

  return assertPublished(
    await input.repository.publish(input.ownerId, {
      workerId: worker,
      generationId: generation.generationId,
      expectedObservationCount: rows.length,
      payloadSha256: generation.payloadSha256,
      publishedAt,
    }),
    generation,
    publishedAt,
  );
}
