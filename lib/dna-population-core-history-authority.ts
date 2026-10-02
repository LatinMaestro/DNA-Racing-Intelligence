import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "./dna-population-history-acquisition-plan";
import {
  replayDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityReplay,
} from "./dna-population-entrant-authority-replay";
import type { DnaPopulationEntrantAuthorityRecord } from "./dna-population-entrant-authority-record";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationCoreHistoryAuthority = Readonly<{
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  entrantReplay: DnaPopulationEntrantAuthorityReplay;
  plan: DnaPopulationHistoryAcquisitionPlan;
  providerReadRequired: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
}>;

function authorityError(message: string): never {
  throw new Error(`Population Core history authority: ${message}`);
}

function raceId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    authorityError("Race identity is invalid");
  }
  return value;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function supplementRaceDocument(
  base: CanonicalRaceDocumentMetadata,
  supplement: CanonicalRaceDocumentMetadata,
): CanonicalRaceDocumentMetadata {
  if (
    raceId(base.sourceRaceId) !== raceId(supplement.sourceRaceId) ||
    base.sourceType !== "race_document" ||
    supplement.sourceType !== "race_document"
  ) {
    authorityError("Race supplement identity is invalid");
  }
  if (
    base.mode !== undefined &&
    supplement.mode !== undefined &&
    base.mode !== supplement.mode
  ) {
    authorityError("Race mode authority conflicts");
  }
  if (
    base.entrantCoreIds !== undefined &&
    supplement.entrantCoreIds !== undefined &&
    !sameStrings(base.entrantCoreIds, supplement.entrantCoreIds)
  ) {
    authorityError("Race entrant authority conflicts");
  }

  const mode = base.mode ?? supplement.mode;
  const entrantCoreIds = base.entrantCoreIds ?? supplement.entrantCoreIds;
  const {
    modeEvidenceStatus: baseModeEvidenceStatus,
    entrantCoreIdsEvidenceStatus: baseEntrantEvidenceStatus,
    ...baseWithoutEvidenceStatus
  } = base;

  return Object.freeze({
    ...baseWithoutEvidenceStatus,
    ...(mode === undefined
      ? baseModeEvidenceStatus === undefined
        ? {}
        : { modeEvidenceStatus: baseModeEvidenceStatus }
      : { mode }),
    ...(entrantCoreIds === undefined
      ? baseEntrantEvidenceStatus === undefined
        ? {}
        : { entrantCoreIdsEvidenceStatus: baseEntrantEvidenceStatus }
      : { entrantCoreIds: Object.freeze([...entrantCoreIds]) }),
  });
}

/**
 * Reconstructs the complete population Race-to-Core authority without another
 * DNA request. The immutable compact entrant archive supplies only the missing
 * mode/entrant facts; every other Race field remains in the canonical Race
 * authority. Conflicts fail closed rather than being rewritten.
 */
export function completeDnaPopulationCoreHistoryAuthority(input: {
  baseRaceDocuments: readonly CanonicalRaceDocumentMetadata[];
  entrantRecords: readonly DnaPopulationEntrantAuthorityRecord[];
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  persistedPerformanceCoreIds?: readonly number[];
}): DnaPopulationCoreHistoryAuthority {
  const entrantReplay = replayDnaPopulationEntrantAuthority({
    records: input.entrantRecords,
    expectedUnresolvedRaceCount: input.expectedUnresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: input.expectedUnresolvedRaceSetSha256,
  });

  const baseByRaceId = new Map<string, CanonicalRaceDocumentMetadata>();
  for (const document of input.baseRaceDocuments) {
    const id = raceId(document.sourceRaceId);
    if (document.sourceType !== "race_document" || baseByRaceId.has(id)) {
      authorityError("base Race authority is duplicated or invalid");
    }
    baseByRaceId.set(id, document);
  }

  const supplementByRaceId = new Map<string, CanonicalRaceDocumentMetadata>();
  for (const document of entrantReplay.canonicalDocuments) {
    const id = raceId(document.sourceRaceId);
    if (!baseByRaceId.has(id) || supplementByRaceId.has(id)) {
      authorityError("entrant replay escaped the canonical Race authority");
    }
    supplementByRaceId.set(id, document);
  }

  const raceDocuments = Object.freeze(
    input.baseRaceDocuments.map((document) => {
      const supplement = supplementByRaceId.get(document.sourceRaceId);
      return supplement === undefined
        ? document
        : supplementRaceDocument(document, supplement);
    }),
  );

  const plan = planDnaPopulationHistoryAcquisition({
    raceDocuments,
    persistedPerformanceCoreIds: input.persistedPerformanceCoreIds ?? [],
    allowQuarantinedRaceGaps: true,
  });

  return Object.freeze({
    raceDocuments,
    entrantReplay,
    plan,
    providerReadRequired: false as const,
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
