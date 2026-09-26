import { createHash } from "node:crypto";

import {
  dnaOpenLabRawEvidenceCanonicalJson,
  type CanonicalRaceDocumentMetadata,
} from "./dna-open-lab-v1-adapters";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  dnaPopulationEntrantAuthorityRecord,
  isDnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "./dna-population-entrant-authority-record";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaPopulationEntrantAuthorityReplay = Readonly<{
  authority: Readonly<{
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    replayedUniqueRaceCount: number;
    replayedRaceSetSha256: string;
  }>;
  exactReplayDuplicateCount: number;
  recordSetSha256: string;
  resolvedRaceCount: number;
  quarantinedRaceCount: number;
  quarantinedRaceSetSha256: string | null;
  canonicalDocuments: readonly CanonicalRaceDocumentMetadata[];
  replayIntegrityStatus: "proven_compact_population_authority_replay";
  providerReadRequired: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
}>;

function replayError(message: string): never {
  throw new Error(`Population entrant authority replay: ${message}`);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function unresolvedRaceSetSha256(raceIds: readonly string[]): string {
  return createHash("sha256")
    .update(
      ["dna_open_lab", "population_history", "unresolved_races", ...raceIds]
        .map(String)
        .join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    replayError(`${field} is invalid`);
  }
  return value;
}

function expectedHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    replayError("expected unresolved Race set SHA-256 is invalid");
  }
  return normalized;
}

function canonicalDocument(
  record: DnaPopulationEntrantAuthorityResolvedRecord,
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document" as const,
    sourceRaceId: record.sourceRaceId,
    ...(record.mode === undefined ? {} : { mode: record.mode }),
    ...(record.modeEvidenceStatus === undefined
      ? {}
      : { modeEvidenceStatus: record.modeEvidenceStatus }),
    ...(record.entrantCoreIds === undefined
      ? {}
      : { entrantCoreIds: Object.freeze([...record.entrantCoreIds]) }),
    ...(record.entrantCoreIdsEvidenceStatus === undefined
      ? {}
      : {
          entrantCoreIdsEvidenceStatus: record.entrantCoreIdsEvidenceStatus,
        }),
  });
}

function normalizedRecord(
  record: DnaPopulationEntrantAuthorityRecord,
): DnaPopulationEntrantAuthorityRecord {
  if (isDnaPopulationEntrantAuthorityQuarantineRecord(record)) {
    return dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: record.sourceRaceId,
      observedAt: record.observedAt,
      quarantineReason: record.quarantineReason,
      ...(record.sourceEvidenceSha256 === undefined
        ? {}
        : { sourceEvidenceSha256: record.sourceEvidenceSha256 }),
    });
  }

  const canonical = canonicalDocument(record);
  return dnaPopulationEntrantAuthorityRecord(
    Object.freeze({
      source: "dna_open_lab" as const,
      sourceVersion: "v1" as const,
      scope: "races" as const,
      endpoint: "races.docs" as const,
      entityKey: `race:${record.sourceRaceId}`,
      observedAt: record.observedAt,
      rawEvidenceSha256: record.rawEvidenceSha256,
      canonical,
    }),
  );
}

/**
 * Proves that compact entrant-authority records are sufficient to replay the
 * population-only canonical Race authority they intentionally retain.
 *
 * This does not recreate omitted non-population Race fields. It validates the
 * stored compact shape, rejects conflicting duplicates, preserves the binding
 * to each exact raw-provider checksum, reconstructs canonical population input,
 * and requires the replayed Race set to match the audited unresolved authority.
 *
 * The proof is pure: it performs no provider access and no persistence.
 */
export function replayDnaPopulationEntrantAuthority(input: {
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
}): DnaPopulationEntrantAuthorityReplay {
  const expectedCount = positive(
    input.expectedUnresolvedRaceCount,
    "expected unresolved Race count",
  );
  const expectedSetHash = expectedHash(input.expectedUnresolvedRaceSetSha256);
  if (input.records.length < 1) {
    replayError("at least one compact entrant record is required");
  }

  const byRaceId = new Map<
    string,
    Readonly<{
      record: DnaPopulationEntrantAuthorityRecord;
      canonical: string;
    }>
  >();
  let exactReplayDuplicateCount = 0;

  for (const candidate of input.records) {
    const normalized = normalizedRecord(candidate);
    const normalizedCanonical = dnaOpenLabRawEvidenceCanonicalJson(normalized);
    const suppliedCanonical = dnaOpenLabRawEvidenceCanonicalJson(candidate);
    if (normalizedCanonical !== suppliedCanonical) {
      replayError("compact entrant record is not canonical");
    }

    const existing = byRaceId.get(normalized.sourceRaceId);
    if (existing !== undefined) {
      if (existing.canonical !== normalizedCanonical) {
        replayError("conflicting compact entrant replay detected");
      }
      exactReplayDuplicateCount += 1;
      continue;
    }
    byRaceId.set(
      normalized.sourceRaceId,
      Object.freeze({ record: normalized, canonical: normalizedCanonical }),
    );
  }

  const raceIds = [...byRaceId.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const replayedRaceSetSha256 = unresolvedRaceSetSha256(raceIds);
  if (
    raceIds.length !== expectedCount ||
    replayedRaceSetSha256 !== expectedSetHash
  ) {
    replayError("replayed Race authority does not match the audited set");
  }

  const ordered = raceIds.map((raceId) => byRaceId.get(raceId)!);
  const recordSetSha256 = sha256Text(
    ordered.map((entry) => entry.canonical).join("\n"),
  );
  const resolved = ordered.filter(
    (
      entry,
    ): entry is typeof entry & {
      record: DnaPopulationEntrantAuthorityResolvedRecord;
    } => !isDnaPopulationEntrantAuthorityQuarantineRecord(entry.record),
  );
  const quarantinedRaceIds = ordered
    .filter((entry) =>
      isDnaPopulationEntrantAuthorityQuarantineRecord(entry.record),
    )
    .map((entry) => entry.record.sourceRaceId);
  const canonicalDocuments = Object.freeze(
    resolved.map((entry) => canonicalDocument(entry.record)),
  );

  return Object.freeze({
    authority: Object.freeze({
      unresolvedRaceCount: expectedCount,
      unresolvedRaceSetSha256: expectedSetHash,
      replayedUniqueRaceCount: raceIds.length,
      replayedRaceSetSha256,
    }),
    exactReplayDuplicateCount,
    recordSetSha256,
    resolvedRaceCount: resolved.length,
    quarantinedRaceCount: quarantinedRaceIds.length,
    quarantinedRaceSetSha256:
      quarantinedRaceIds.length === 0
        ? null
        : unresolvedRaceSetSha256(quarantinedRaceIds),
    canonicalDocuments,
    replayIntegrityStatus:
      "proven_compact_population_authority_replay" as const,
    providerReadRequired: false as const,
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
