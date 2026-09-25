import { createHash } from "node:crypto";

import {
  replayDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityReplay,
} from "./dna-population-entrant-authority-replay";
import type { DnaPopulationEntrantAuthorityRecord } from "./dna-population-entrant-authority-record";
import { dnaOpenLabRawEvidenceCanonicalJson } from "./dna-open-lab-v1-adapters";
import {
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
} from "./dna-population-race-index-r2-chunk";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_VERSION = "population-entrant-authority-r2-v1";

export type DnaPopulationEntrantAuthorityChunkReceipt = Readonly<{
  version: 1;
  generationId: string;
  chunkOrdinal: number;
  bodySha256: string;
  byteLength: number;
  rowCount: number;
  firstSourceRaceId: string;
  lastSourceRaceId: string;
  raceSetSha256: string;
  recordSetSha256: string;
}>;

export type DnaPopulationEntrantAuthorityChunk = Readonly<{
  receipt: DnaPopulationEntrantAuthorityChunkReceipt;
  body: Uint8Array;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}>;

export type DnaPopulationEntrantAuthorityArchiveReplay = Readonly<{
  generationId: string;
  chunkCount: number;
  rowCount: number;
  archiveRecordSetSha256: string;
  replay: DnaPopulationEntrantAuthorityReplay;
  replayIntegrityStatus: "proven_compact_population_archive_replay";
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
}>;

function archiveError(message: string): never {
  throw new Error(`Population entrant authority archive: ${message}`);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    archiveError(`${field} is invalid`);
  }
  return normalized;
}

function positive(
  value: number,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    archiveError(`${field} is invalid`);
  }
  return value;
}

function raceSetSha256(raceIds: readonly string[]): string {
  return createHash("sha256")
    .update(
      ["dna_open_lab", "population_history", "unresolved_races", ...raceIds]
        .map(String)
        .join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function sortedRecords(
  records: readonly DnaPopulationEntrantAuthorityRecord[],
): readonly DnaPopulationEntrantAuthorityRecord[] {
  if (
    records.length < 1 ||
    records.length > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS
  ) {
    archiveError("chunk record count is invalid");
  }
  return Object.freeze(
    [...records].sort((left, right) =>
      left.sourceRaceId < right.sourceRaceId
        ? -1
        : left.sourceRaceId > right.sourceRaceId
          ? 1
          : 0,
    ),
  );
}

function canonicalBody(input: {
  generationId: string;
  chunkOrdinal: number;
  raceSetSha256: string;
  recordSetSha256: string;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}): string {
  return dnaOpenLabRawEvidenceCanonicalJson({
    version: 1,
    source: "dna_open_lab",
    sourceVersion: SOURCE_VERSION,
    generationId: input.generationId,
    chunkOrdinal: input.chunkOrdinal,
    raceSetSha256: input.raceSetSha256,
    recordSetSha256: input.recordSetSha256,
    records: input.records,
  });
}

function exactChunkReplay(input: {
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}): DnaPopulationEntrantAuthorityReplay {
  const raceIds = input.records
    .map((record) => record.sourceRaceId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return replayDnaPopulationEntrantAuthority({
    records: input.records,
    expectedUnresolvedRaceCount: raceIds.length,
    expectedUnresolvedRaceSetSha256: raceSetSha256(raceIds),
  });
}

/**
 * Creates the deterministic immutable body/receipt pair for one compact entrant
 * authority chunk. This is pure encoding only and performs no R2 write.
 */
export function buildDnaPopulationEntrantAuthorityChunk(input: {
  generationId: string;
  chunkOrdinal: number;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}): DnaPopulationEntrantAuthorityChunk {
  const generationId = sha256(input.generationId, "generationId");
  const chunkOrdinal = positive(input.chunkOrdinal, "chunkOrdinal", 1_000_000);
  const records = sortedRecords(input.records);
  const replay = exactChunkReplay({ records });
  if (
    replay.exactReplayDuplicateCount !== 0 ||
    replay.canonicalDocuments.length !== records.length
  ) {
    archiveError("chunk contains duplicate Race authority");
  }

  const raceIds = records.map((record) => record.sourceRaceId);
  const raceSetSha = raceSetSha256(raceIds);
  if (replay.authority.replayedRaceSetSha256 !== raceSetSha) {
    archiveError("chunk Race authority disagrees with replay");
  }

  const canonical = canonicalBody({
    generationId,
    chunkOrdinal,
    raceSetSha256: raceSetSha,
    recordSetSha256: replay.recordSetSha256,
    records,
  });
  const body = new TextEncoder().encode(canonical);
  if (
    body.byteLength < 1 ||
    body.byteLength > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES
  ) {
    archiveError("chunk exceeds the bounded byte capacity");
  }

  return Object.freeze({
    receipt: Object.freeze({
      version: 1 as const,
      generationId,
      chunkOrdinal,
      bodySha256: sha256Text(canonical),
      byteLength: body.byteLength,
      rowCount: records.length,
      firstSourceRaceId: records[0]!.sourceRaceId,
      lastSourceRaceId: records.at(-1)!.sourceRaceId,
      raceSetSha256: raceSetSha,
      recordSetSha256: replay.recordSetSha256,
    }),
    body,
    records,
  });
}

/**
 * Strictly re-opens a stored compact chunk from its immutable receipt/body.
 * The canonical envelope, checksum, range, Race set and record set must all
 * rebuild exactly before records are exposed.
 */
export function decodeDnaPopulationEntrantAuthorityChunk(input: {
  receipt: DnaPopulationEntrantAuthorityChunkReceipt;
  body: Uint8Array;
}): DnaPopulationEntrantAuthorityChunk {
  if (input.receipt.version !== 1) {
    archiveError("receipt version is invalid");
  }
  const generationId = sha256(input.receipt.generationId, "generationId");
  const chunkOrdinal = positive(
    input.receipt.chunkOrdinal,
    "chunkOrdinal",
    1_000_000,
  );
  positive(
    input.receipt.rowCount,
    "rowCount",
    DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
  );
  positive(
    input.receipt.byteLength,
    "byteLength",
    DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
  );
  const expectedBodySha256 = sha256(input.receipt.bodySha256, "bodySha256");
  const expectedRaceSetSha256 = sha256(
    input.receipt.raceSetSha256,
    "raceSetSha256",
  );
  const expectedRecordSetSha256 = sha256(
    input.receipt.recordSetSha256,
    "recordSetSha256",
  );

  if (
    !(input.body instanceof Uint8Array) ||
    input.body.byteLength !== input.receipt.byteLength ||
    sha256Bytes(input.body) !== expectedBodySha256
  ) {
    archiveError("stored chunk body conflicts with its receipt");
  }

  let parsed: unknown;
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  try {
    parsed = JSON.parse(decoded);
  } catch {
    archiveError("stored chunk body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    archiveError("stored chunk envelope is invalid");
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.version !== 1 ||
    envelope.source !== "dna_open_lab" ||
    envelope.sourceVersion !== SOURCE_VERSION ||
    envelope.generationId !== generationId ||
    envelope.chunkOrdinal !== chunkOrdinal ||
    envelope.raceSetSha256 !== expectedRaceSetSha256 ||
    envelope.recordSetSha256 !== expectedRecordSetSha256 ||
    !Array.isArray(envelope.records) ||
    envelope.records.length !== input.receipt.rowCount ||
    dnaOpenLabRawEvidenceCanonicalJson(envelope) !== decoded
  ) {
    archiveError("stored chunk envelope conflicts with its receipt");
  }

  const rebuilt = buildDnaPopulationEntrantAuthorityChunk({
    generationId,
    chunkOrdinal,
    records: envelope.records as DnaPopulationEntrantAuthorityRecord[],
  });
  const receipt = rebuilt.receipt;
  if (
    receipt.bodySha256 !== expectedBodySha256 ||
    receipt.byteLength !== input.receipt.byteLength ||
    receipt.rowCount !== input.receipt.rowCount ||
    receipt.firstSourceRaceId !== input.receipt.firstSourceRaceId ||
    receipt.lastSourceRaceId !== input.receipt.lastSourceRaceId ||
    receipt.raceSetSha256 !== expectedRaceSetSha256 ||
    receipt.recordSetSha256 !== expectedRecordSetSha256
  ) {
    archiveError("stored chunk replay conflicts with its receipt");
  }
  return rebuilt;
}

/**
 * Reconciles a complete ordered compact archive back to the exact audited
 * unresolved Race authority. This is recovery verification only: it performs
 * no provider request and does not authorize persistence.
 */
export function replayDnaPopulationEntrantAuthorityArchive(input: {
  generationId: string;
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  chunks: readonly DnaPopulationEntrantAuthorityChunk[];
}): DnaPopulationEntrantAuthorityArchiveReplay {
  const generationId = sha256(input.generationId, "generationId");
  const expectedUnresolvedRaceCount = positive(
    input.expectedUnresolvedRaceCount,
    "expected unresolved Race count",
  );
  const expectedUnresolvedRaceSetSha256 = sha256(
    input.expectedUnresolvedRaceSetSha256,
    "expected unresolved Race set SHA-256",
  );
  if (input.chunks.length < 1) {
    archiveError("at least one chunk is required");
  }

  const records: DnaPopulationEntrantAuthorityRecord[] = [];
  let previousLastRaceId: string | null = null;
  for (const [index, chunk] of input.chunks.entries()) {
    if (
      chunk.receipt.generationId !== generationId ||
      chunk.receipt.chunkOrdinal !== index + 1
    ) {
      archiveError("chunk sequence authority is invalid");
    }
    const decoded = decodeDnaPopulationEntrantAuthorityChunk({
      receipt: chunk.receipt,
      body: chunk.body,
    });
    if (
      previousLastRaceId !== null &&
      decoded.receipt.firstSourceRaceId <= previousLastRaceId
    ) {
      archiveError("chunk Race ranges overlap or are out of order");
    }
    previousLastRaceId = decoded.receipt.lastSourceRaceId;
    records.push(...decoded.records);
  }

  const replay = replayDnaPopulationEntrantAuthority({
    records,
    expectedUnresolvedRaceCount,
    expectedUnresolvedRaceSetSha256,
  });
  if (replay.exactReplayDuplicateCount !== 0) {
    archiveError("complete archive contains duplicate Race authority");
  }
  const archiveRecordSetSha256 = sha256Text(
    input.chunks.map((chunk) => chunk.receipt.recordSetSha256).join("\n"),
  );

  return Object.freeze({
    generationId,
    chunkCount: input.chunks.length,
    rowCount: records.length,
    archiveRecordSetSha256,
    replay,
    replayIntegrityStatus: "proven_compact_population_archive_replay" as const,
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
