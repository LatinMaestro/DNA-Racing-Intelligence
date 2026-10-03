import { createHash } from "node:crypto";

import type { RaceMode } from "@/domain/import-contract";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MODES = Object.freeze(["bike", "car", "horse"] as const);

export type DnaPopulationCoreRaceLink = Readonly<{
  sourceCoreId: number;
  sourceRaceId: string;
  mode: RaceMode;
}>;

export type DnaPopulationCoreLinkedHistory = Readonly<{
  sourceCoreId: number;
  raceCount: number;
  raceIdsByMode: Readonly<Record<RaceMode, readonly string[]>>;
}>;

export type DnaPopulationCoreRaceLinkIndex = Readonly<{
  version: 1;
  status: "complete_for_resolved_race_authority";
  raceDocumentCount: number;
  resolvedRaceCount: number;
  quarantinedRaceCount: number;
  linkedCoreCount: number;
  membershipCount: number;
  membershipSetSha256: string;
  dnaProviderRequestCount: 0;
  raceDocumentDuplicationPerformed: false;
  performanceEnrichmentRequiredForLinkedHistory: false;
  read: () => AsyncIterable<DnaPopulationCoreLinkedHistory>;
  cleanup: () => Promise<void>;
}>;

export type DnaPopulationCoreRaceLinkIndexBounds = Readonly<{
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumMemberships: number;
  maximumRunObjects: number;
  maximumRacesPerCore: number;
}>;

type MutableCounts = {
  raceDocumentCount: number;
  resolvedRaceCount: number;
  quarantinedRaceCount: number;
};

function indexError(message: string): never {
  throw new Error(`DNA population Core-Race link index: ${message}`);
}

function sourceRaceId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    indexError("source Race identity is invalid");
  }
  return value;
}

function sourceCoreId(value: string): number {
  if (!POSITIVE_INTEGER.test(value)) {
    indexError("source Core identity is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    indexError("source Core identity is invalid");
  }
  return parsed;
}

function raceMode(value: unknown): RaceMode | null {
  return typeof value === "string" && MODES.includes(value as RaceMode)
    ? (value as RaceMode)
    : null;
}

function compareLinks(
  left: DnaPopulationCoreRaceLink,
  right: DnaPopulationCoreRaceLink,
): number {
  if (left.sourceCoreId !== right.sourceCoreId) {
    return left.sourceCoreId - right.sourceCoreId;
  }
  if (left.sourceRaceId !== right.sourceRaceId) {
    return left.sourceRaceId < right.sourceRaceId ? -1 : 1;
  }
  return left.mode < right.mode ? -1 : left.mode > right.mode ? 1 : 0;
}

function membershipIdentity(link: DnaPopulationCoreRaceLink): string {
  return `${link.sourceCoreId}\u0000${link.sourceRaceId}\u0000${link.mode}`;
}

function membershipNaturalKey(link: DnaPopulationCoreRaceLink): string {
  return `${link.sourceCoreId}\u0000${link.sourceRaceId}`;
}

function linksFromDocuments(input: {
  documents: AsyncIterable<CanonicalRaceDocumentMetadata>;
  counts: MutableCounts;
}): AsyncIterable<DnaPopulationCoreRaceLink> {
  return (async function* () {
    for await (const document of input.documents) {
      input.counts.raceDocumentCount += 1;
      if (document.sourceType !== "race_document") {
        indexError("document authority is invalid");
      }
      const raceId = sourceRaceId(document.sourceRaceId);
      const mode = raceMode(document.mode);
      if (
        mode === null ||
        document.entrantCoreIds === undefined ||
        document.entrantCoreIds.length === 0
      ) {
        input.counts.quarantinedRaceCount += 1;
        continue;
      }

      const entrantIds = document.entrantCoreIds.map(sourceCoreId);
      if (new Set(entrantIds).size !== entrantIds.length) {
        input.counts.quarantinedRaceCount += 1;
        continue;
      }
      input.counts.resolvedRaceCount += 1;
      for (const coreId of entrantIds) {
        yield Object.freeze({
          sourceCoreId: coreId,
          sourceRaceId: raceId,
          mode,
        });
      }
    }
  })();
}

function groupedHistories(input: {
  sorted: RaceArchiveExternalSortedResult<DnaPopulationCoreRaceLink>;
  maximumRacesPerCore: number;
}): AsyncIterable<DnaPopulationCoreLinkedHistory> {
  return (async function* () {
    let activeCoreId: number | null = null;
    let raceIdsByMode: Record<RaceMode, string[]> = {
      bike: [],
      car: [],
      horse: [],
    };
    let previousNaturalKey: string | null = null;

    const history = (): DnaPopulationCoreLinkedHistory => {
      if (activeCoreId === null) indexError("grouping state is unavailable");
      const raceCount = MODES.reduce(
        (count, mode) => count + raceIdsByMode[mode].length,
        0,
      );
      if (raceCount > input.maximumRacesPerCore) {
        indexError("one Core exceeds the linked Race bound");
      }
      return Object.freeze({
        sourceCoreId: activeCoreId,
        raceCount,
        raceIdsByMode: Object.freeze({
          bike: Object.freeze([...raceIdsByMode.bike]),
          car: Object.freeze([...raceIdsByMode.car]),
          horse: Object.freeze([...raceIdsByMode.horse]),
        }),
      });
    };

    for await (const link of input.sorted.read()) {
      const naturalKey = membershipNaturalKey(link);
      if (naturalKey === previousNaturalKey) {
        indexError("duplicate Core-Race membership was detected");
      }
      previousNaturalKey = naturalKey;
      if (activeCoreId !== null && link.sourceCoreId !== activeCoreId) {
        yield history();
        raceIdsByMode = { bike: [], car: [], horse: [] };
      }
      activeCoreId = link.sourceCoreId;
      raceIdsByMode[link.mode].push(link.sourceRaceId);
    }
    if (activeCoreId !== null) yield history();
  })();
}

/**
 * Transposes the already-retained canonical Race authority into a compact
 * Core -> Race membership stream. It performs no DNA request and stores no
 * duplicate Race document; finish position and elapsed time remain optional
 * performance enrichment outside this linked-history authority.
 */
export async function buildDnaPopulationCoreRaceLinkIndex(input: {
  documents: AsyncIterable<CanonicalRaceDocumentMetadata>;
  store: RaceArchiveExternalSortedRunStore<DnaPopulationCoreRaceLink>;
  runPrefix: string;
  bounds: DnaPopulationCoreRaceLinkIndexBounds;
}): Promise<DnaPopulationCoreRaceLinkIndex> {
  const counts: MutableCounts = {
    raceDocumentCount: 0,
    resolvedRaceCount: 0,
    quarantinedRaceCount: 0,
  };
  const sorted = await spillExactSortedRaceArchiveRecords({
    records: linksFromDocuments({ documents: input.documents, counts }),
    store: input.store,
    compare: compareLinks,
    runPrefix: input.runPrefix,
    maximumRecordsInMemory: input.bounds.maximumRecordsInMemory,
    mergeFanIn: input.bounds.mergeFanIn,
    maximumInputRecords: input.bounds.maximumMemberships,
    maximumRunObjects: input.bounds.maximumRunObjects,
  });

  const digest = createHash("sha256");
  let linkedCoreCount = 0;
  let previousCoreId: number | null = null;
  let previousNaturalKey: string | null = null;
  let activeCoreMembershipCount = 0;
  try {
    for await (const link of sorted.read()) {
      const identity = membershipIdentity(link);
      const naturalKey = membershipNaturalKey(link);
      if (naturalKey === previousNaturalKey) {
        indexError("duplicate Core-Race membership was detected");
      }
      previousNaturalKey = naturalKey;
      digest.update(`${identity}\n`, "utf8");
      if (link.sourceCoreId !== previousCoreId) {
        linkedCoreCount += 1;
        previousCoreId = link.sourceCoreId;
        activeCoreMembershipCount = 0;
      }
      activeCoreMembershipCount += 1;
      if (activeCoreMembershipCount > input.bounds.maximumRacesPerCore) {
        indexError("one Core exceeds the linked Race bound");
      }
    }
  } catch (error) {
    await sorted.cleanup();
    throw error;
  }
  if (counts.raceDocumentCount < 1 || sorted.recordCount < 1) {
    await sorted.cleanup();
    indexError("resolved Race membership authority is empty");
  }
  if (
    counts.resolvedRaceCount + counts.quarantinedRaceCount !==
    counts.raceDocumentCount
  ) {
    await sorted.cleanup();
    indexError("Race coverage does not reconcile");
  }

  return Object.freeze({
    version: 1 as const,
    status: "complete_for_resolved_race_authority" as const,
    ...counts,
    linkedCoreCount,
    membershipCount: sorted.recordCount,
    membershipSetSha256: digest.digest("hex"),
    dnaProviderRequestCount: 0 as const,
    raceDocumentDuplicationPerformed: false as const,
    performanceEnrichmentRequiredForLinkedHistory: false as const,
    read: () =>
      groupedHistories({
        sorted,
        maximumRacesPerCore: input.bounds.maximumRacesPerCore,
      }),
    cleanup: sorted.cleanup,
  });
}
