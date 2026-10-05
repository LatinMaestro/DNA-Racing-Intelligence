import { createHash } from "node:crypto";

import type {
  DnaCompactCoreOutcomeEvidence,
} from "./dna-population-core-outcome-gap-plan";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  ActiveDnaCoreRaceHistoryGenerationRow,
} from "./neon-active-dna-core-race-history-generation";
import type {
  RaceMergeCoreOutcomeR2GenerationRepository,
  RaceMergeCoreOutcomeR2Manifest,
} from "./race-merge-core-outcome-r2-generation";
import type { RaceMergeCoreOutcomeR2Store } from "./race-merge-core-outcome-r2-store";

const MAXIMUM_COHORT_CORES = 100;
const MAXIMUM_API_PAGE_SIZE = 250;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

function sourceError(message: string): never {
  throw new Error(`DNA population Core outcome durable source: ${message}`);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    sourceError(`${field} is invalid`);
  }
  return parsed as number;
}

function safeCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    sourceError(`${field} is invalid`);
  }
  return value as number;
}

function safeText(value: unknown, field: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    sourceError(`${field} is invalid`);
  }
  return value;
}

function sameOutcome(
  left: DnaCompactCoreOutcomeEvidence,
  right: DnaCompactCoreOutcomeEvidence,
): boolean {
  return (
    left.sourceCoreId === right.sourceCoreId &&
    left.sourceRaceId === right.sourceRaceId &&
    left.finishPosition === right.finishPosition &&
    left.elapsedMilliseconds === right.elapsedMilliseconds
  );
}

function compactApiOutcome(
  row: ActiveDnaCoreRaceHistoryGenerationRow,
): DnaCompactCoreOutcomeEvidence {
  const payload = row.payload;
  if (
    payload.sourceType !== "core_race_history_outcome" &&
    payload.sourceType !== "joined_core_race_history_result"
  ) {
    sourceError("active API payload authority is invalid");
  }
  return Object.freeze({
    source: "core_history_api" as const,
    sourceCoreId: positiveInteger(payload.sourceCoreId, "sourceCoreId"),
    sourceRaceId: safeText(payload.sourceRaceId, "sourceRaceId"),
    finishPosition: positiveInteger(payload.finishPosition, "finishPosition"),
    elapsedMilliseconds: positiveInteger(
      payload.elapsedMilliseconds,
      "elapsedMilliseconds",
    ),
  });
}

export type DnaRaceMergeOutcomeDurableSource = Readonly<{
  generationId: string;
  cohortCount: number;
  manifestCount: number;
  uniqueOutcomeCount: number;
  sourceObservationCount: number;
  retainedR2Bytes: number;
  firstSourceCoreId: number;
  lastSourceCoreId: number;
  loadOutcomes: (
    sourceCoreId: number,
  ) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
  dnaProviderRequestCount: 0;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

/**
 * Reopens every completed Race Merge outcome cohort without calling DNA or
 * mutating the durable generation. All pre-terminal cohorts must contain 100
 * Cores; the terminal cohort is explicitly bound to its durable Core count.
 */
export async function readDnaRaceMergeOutcomeDurableSource(input: {
  ownerId: string;
  generationId: string;
  terminalCohortOrdinal: number;
  terminalCoreCount: number;
  repository: Pick<\n    RaceMergeCoreOutcomeR2GenerationRepository,\n    "listManifests"\n  >;
  store: Pick<RaceMergeCoreOutcomeR2Store, "read">;
}): Promise<DnaRaceMergeOutcomeDurableSource> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const generationId = safeText(input.generationId, "generationId", 128);
  const terminalCohortOrdinal = positiveInteger(
    input.terminalCohortOrdinal,
    "terminalCohortOrdinal",
  );
  const terminalCoreCount = positiveInteger(
    input.terminalCoreCount,
    "terminalCoreCount",
  );
  if (terminalCoreCount > MAXIMUM_COHORT_CORES) {
    sourceError("terminalCoreCount exceeds bounded cohort");
  }

  const manifestByCore = new Map<number, RaceMergeCoreOutcomeR2Manifest>();
  let uniqueOutcomeCount = 0;
  let sourceObservationCount = 0;
  let retainedR2Bytes = 0;
  let previousCoreId = 0;

  for (
    let cohortOrdinal = 1;
    cohortOrdinal <= terminalCohortOrdinal;
    cohortOrdinal += 1
  ) {
    const expectedCoreCount =
      cohortOrdinal === terminalCohortOrdinal
        ? terminalCoreCount
        : MAXIMUM_COHORT_CORES;
    const manifests = await input.repository.listManifests(ownerId, {
      generationId,
      cohortOrdinal,
      afterSourceCoreId: 0,
      limit: MAXIMUM_COHORT_CORES,
    });
    if (manifests.length !== expectedCoreCount) {
      sourceError("cohort manifest count disagrees with durable authority");
    }
    const tail = await input.repository.listManifests(ownerId, {
      generationId,
      cohortOrdinal,
      afterSourceCoreId: manifests.at(-1)!.sourceCoreId,
      limit: 1,
    });
    if (tail.length !== 0) {
      sourceError("cohort manifest range exceeds durable authority");
    }

    for (const manifest of manifests) {
      const coreId = positiveInteger(manifest.sourceCoreId, "manifest Core");
      if (
        manifest.generationId !== generationId ||
        coreId <= previousCoreId ||
        manifestByCore.has(coreId)
      ) {
        sourceError("manifest generation or Core ordering drifted");
      }
      previousCoreId = coreId;
      manifestByCore.set(coreId, manifest);
      uniqueOutcomeCount += safeCount(
        manifest.uniqueOutcomeCount,
        "uniqueOutcomeCount",
      );
      sourceObservationCount += safeCount(
        manifest.sourceObservationCount,
        "sourceObservationCount",
      );
      retainedR2Bytes += safeCount(manifest.byteLength, "byteLength");
      for (const value of [
        uniqueOutcomeCount,
        sourceObservationCount,
        retainedR2Bytes,
      ]) {
        if (!Number.isSafeInteger(value)) {
          sourceError("manifest totals exceed safe integer range");
        }
      }
    }
  }

  if (manifestByCore.size < 1)\n    sourceError("Race Merge outcome source is empty");

  return Object.freeze({
    generationId,
    cohortCount: terminalCohortOrdinal,
    manifestCount: manifestByCore.size,
    uniqueOutcomeCount,
    sourceObservationCount,
    retainedR2Bytes,
    firstSourceCoreId: manifestByCore.keys().next().value as number,
    lastSourceCoreId: previousCoreId,
    async loadOutcomes(sourceCoreIdInput) {
      const sourceCoreId = positiveInteger(sourceCoreIdInput, "requested Core");
      const manifest = manifestByCore.get(sourceCoreId);
      if (manifest === undefined) return Object.freeze([]);
      const outcomes = await input.store.read(manifest);
      if (outcomes.length !== manifest.uniqueOutcomeCount) {
        sourceError("Race Merge object count disagrees with manifest");
      }
      for (const outcome of outcomes) {
        if (
          outcome.source !== "race_merge" ||
          outcome.sourceCoreId !== sourceCoreId
        ) {
          sourceError("Race Merge object changed source authority");
        }
      }
      return Object.freeze([...outcomes]);
    },
    dnaProviderRequestCount: 0 as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

export type DnaPersistedApiOutcomeDurableSource = Readonly<{
  generationId: string;
  observationCount: number;
  coreCount: number;
  payloadSha256: string;
  loadOutcomes: (
    sourceCoreId: number,
  ) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
  dnaProviderRequestCount: 0;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

/**
 * Reopens the currently published compact Core-history generation and indexes
 * only Race/Core finish-position + elapsed-time outcomes. A pointer change or
 * row/digest drift fails closed.
 */
export async function readDnaPersistedApiOutcomeDurableSource(input: {
  ownerId: string;
  repository: ActiveDnaCoreRaceHistoryGenerationReadRepository;
  pageSize?: number;
}): Promise<DnaPersistedApiOutcomeDurableSource | null> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const generation = await input.repository.readActiveGeneration(ownerId);
  if (generation === null) return null;
  const pageSize = input.pageSize ?? MAXIMUM_API_PAGE_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAXIMUM_API_PAGE_SIZE
  ) {
    sourceError("API outcome pageSize is invalid");
  }
  if (!SHA_256_PATTERN.test(generation.payloadSha256)) {
    sourceError("active API payload digest is invalid");
  }

  const byCore = new Map<number, Map<string, DnaCompactCoreOutcomeEvidence>>();
  const digest = createHash("sha256");
  let afterOrdinal = -1;
  let count = 0;
  let previousNaturalKey: string | null = null;

  while (count < generation.observationCount) {
    const page = await input.repository.readActiveRows(
      ownerId,
      afterOrdinal,
      pageSize,
    );
    if (page.length < 1 || page.length > pageSize) {
      sourceError("active API outcome coverage is incomplete");
    }
    for (const row of page) {
      if (
        row.generationId !== generation.generationId ||
        row.ordinal !== count ||
        (previousNaturalKey !== null &&
          previousNaturalKey.localeCompare(row.naturalKey) >= 0)
      ) {
        sourceError("active API outcome ordering drifted");
      }
      digest.update(
        `${row.ordinal}:${row.naturalKey}:${row.rowSha256}\n`,
        "utf8",
      );
      const outcome = compactApiOutcome(row);
      const core = byCore.get(outcome.sourceCoreId) ?? new Map();
      const previous = core.get(outcome.sourceRaceId);
      if (previous !== undefined) {
        if (!sameOutcome(previous, outcome)) {
          sourceError("active API outcome replay conflicts");
        }
        sourceError("active API generation contains duplicate Core/Race rows");
      }
      core.set(outcome.sourceRaceId, outcome);
      byCore.set(outcome.sourceCoreId, core);
      previousNaturalKey = row.naturalKey;
      afterOrdinal = row.ordinal;
      count += 1;
      if (count > generation.observationCount) {
        sourceError("active API outcome coverage exceeded");
      }
    }
  }

  if (digest.digest("hex") !== generation.payloadSha256) {
    sourceError("active API outcome digest changed");
  }
  const confirmed = await input.repository.readActiveGeneration(ownerId);
  if (
    confirmed === null ||
    confirmed.generationId !== generation.generationId ||
    confirmed.payloadSha256 !== generation.payloadSha256 ||
    confirmed.observationCount !== generation.observationCount
  ) {
    sourceError("active API generation pointer changed");
  }

  return Object.freeze({
    generationId: generation.generationId,
    observationCount: generation.observationCount,
    coreCount: byCore.size,
    payloadSha256: generation.payloadSha256,
    async loadOutcomes(sourceCoreIdInput) {
      const sourceCoreId = positiveInteger(sourceCoreIdInput, "requested Core");
      return Object.freeze([\n        ...(byCore.get(sourceCoreId)?.values() ?? []),\n      ]);
    },
    dnaProviderRequestCount: 0 as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
