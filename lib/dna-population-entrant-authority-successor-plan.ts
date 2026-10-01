import { createHash } from "node:crypto";

import { replayDnaPopulationEntrantAuthority } from "./dna-population-entrant-authority-replay";
import {
  isDnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "./dna-population-entrant-authority-record";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION =
  "dna-population-entrant-authority-successor-plan/v1" as const;

export type DnaPopulationEntrantAuthoritySuccessorPlan = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION;
  baseGenerationId: string;
  baseRecordSetSha256: string;
  successorGenerationId: string;
  successorRecordSetSha256: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  replacementRaceCount: number;
  replacementRaceSetSha256: string;
  replacementRecordSetSha256: string;
  quarantinedRaceCountBefore: number;
  quarantinedRaceCountAfter: number;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  lastGoodBasePreserved: true;
  providerRequestPerformed: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
}>;

function planError(message: string): never {
  throw new Error(`Population entrant authority successor plan: ${message}`);
}

function sha256(value: string, field: string): string {
  if (typeof value !== "string") {
    planError(`${field} is invalid`);
  }
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    planError(`${field} is invalid`);
  }
  return normalized;
}

function digest(parts: readonly (string | number)[]): string {
  return createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest("hex");
}

function raceSetSha256(raceIds: readonly string[]): string {
  return digest([
    "dna_open_lab",
    "population_history",
    "unresolved_races",
    ...raceIds,
  ]);
}

function orderedRecords(
  records: readonly DnaPopulationEntrantAuthorityRecord[],
): readonly DnaPopulationEntrantAuthorityRecord[] {
  return Object.freeze(
    [...records]
      .sort((left, right) =>
        left.sourceRaceId < right.sourceRaceId
          ? -1
          : left.sourceRaceId > right.sourceRaceId
            ? 1
            : 0,
      )
      .map((record) =>
        isDnaPopulationEntrantAuthorityQuarantineRecord(record)
          ? Object.freeze({
              sourceRaceId: record.sourceRaceId,
              observedAt: record.observedAt,
              quarantineReason: record.quarantineReason,
              ...(record.sourceEvidenceSha256 === undefined
                ? {}
                : { sourceEvidenceSha256: record.sourceEvidenceSha256 }),
            })
          : Object.freeze({
              sourceRaceId: record.sourceRaceId,
              observedAt: record.observedAt,
              rawEvidenceSha256: record.rawEvidenceSha256,
              ...(record.mode === undefined ? {} : { mode: record.mode }),
              ...(record.modeEvidenceStatus === undefined
                ? {}
                : { modeEvidenceStatus: record.modeEvidenceStatus }),
              ...(record.entrantCoreIds === undefined
                ? {}
                : {
                    entrantCoreIds: Object.freeze([...record.entrantCoreIds]),
                  }),
              ...(record.entrantCoreIdsEvidenceStatus === undefined
                ? {}
                : {
                    entrantCoreIdsEvidenceStatus:
                      record.entrantCoreIdsEvidenceStatus,
                  }),
            }),
      ),
  );
}

/**
 * Builds a deterministic successor to one immutable entrant-authority
 * generation by replacing only its quarantined Race records with newly
 * resolved compact authority.
 *
 * This boundary is deliberately pure. It neither reads the provider nor
 * persists the returned generation. A separately authorized connected path
 * must re-open the exact base and apply its own capacity/write gates.
 */
export function planDnaPopulationEntrantAuthoritySuccessor(input: {
  baseGenerationId: string;
  baseRecords: readonly DnaPopulationEntrantAuthorityRecord[];
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  expectedBaseRecordSetSha256: string;
  replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
}): DnaPopulationEntrantAuthoritySuccessorPlan {
  const baseGenerationId = sha256(input.baseGenerationId, "base generation ID");
  const unresolvedRaceSetSha256 = sha256(
    input.expectedUnresolvedRaceSetSha256,
    "unresolved Race set SHA-256",
  );
  const expectedBaseRecordSetSha256 = sha256(
    input.expectedBaseRecordSetSha256,
    "base record set SHA-256",
  );
  if (baseGenerationId !== unresolvedRaceSetSha256) {
    planError("immutable v1 base generation binding is invalid");
  }

  const base = replayDnaPopulationEntrantAuthority({
    records: input.baseRecords,
    expectedUnresolvedRaceCount: input.expectedUnresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  if (
    base.exactReplayDuplicateCount !== 0 ||
    base.recordSetSha256 !== expectedBaseRecordSetSha256
  ) {
    planError("base generation replay is not exact");
  }
  if (base.quarantinedRaceCount < 1) {
    planError("base generation has no quarantined authority to replace");
  }
  if (input.replacements.length < 1) {
    planError("at least one resolved replacement is required");
  }

  const baseByRaceId = new Map(
    input.baseRecords.map((record) => [record.sourceRaceId, record] as const),
  );
  const replacementRaceIds = input.replacements
    .map((record) => record.sourceRaceId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (new Set(replacementRaceIds).size !== replacementRaceIds.length) {
    planError("replacement authority is not uniquely resolved");
  }
  const replacementRaceSetSha256 = raceSetSha256(replacementRaceIds);
  const replacementReplay = replayDnaPopulationEntrantAuthority({
    records: input.replacements,
    expectedUnresolvedRaceCount: input.replacements.length,
    expectedUnresolvedRaceSetSha256: replacementRaceSetSha256,
  });
  if (
    replacementReplay.exactReplayDuplicateCount !== 0 ||
    replacementReplay.quarantinedRaceCount !== 0 ||
    replacementReplay.canonicalDocuments.some(
      (document) => document.entrantCoreIds === undefined,
    )
  ) {
    planError("replacement authority is not uniquely resolved");
  }

  for (const replacement of input.replacements) {
    const previous = baseByRaceId.get(replacement.sourceRaceId);
    if (
      previous === undefined ||
      !isDnaPopulationEntrantAuthorityQuarantineRecord(previous)
    ) {
      planError("replacement targets non-quarantined Race authority");
    }
    if (Date.parse(replacement.observedAt) <= Date.parse(previous.observedAt)) {
      planError("replacement evidence is not newer than quarantined authority");
    }
    baseByRaceId.set(replacement.sourceRaceId, replacement);
  }

  const records = orderedRecords([...baseByRaceId.values()]);
  const successor = replayDnaPopulationEntrantAuthority({
    records,
    expectedUnresolvedRaceCount: input.expectedUnresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  if (
    successor.exactReplayDuplicateCount !== 0 ||
    successor.quarantinedRaceCount !==
      base.quarantinedRaceCount - input.replacements.length
  ) {
    planError("successor generation does not reduce quarantine exactly");
  }

  const successorGenerationId = digest([
    DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION,
    baseGenerationId,
    expectedBaseRecordSetSha256,
    replacementRaceSetSha256,
    replacementReplay.recordSetSha256,
    successor.recordSetSha256,
  ]);

  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION,
    baseGenerationId,
    baseRecordSetSha256: expectedBaseRecordSetSha256,
    successorGenerationId,
    successorRecordSetSha256: successor.recordSetSha256,
    unresolvedRaceCount: successor.authority.unresolvedRaceCount,
    unresolvedRaceSetSha256,
    replacementRaceCount: input.replacements.length,
    replacementRaceSetSha256,
    replacementRecordSetSha256: replacementReplay.recordSetSha256,
    quarantinedRaceCountBefore: base.quarantinedRaceCount,
    quarantinedRaceCountAfter: successor.quarantinedRaceCount,
    records,
    lastGoodBasePreserved: true as const,
    providerRequestPerformed: false as const,
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
