import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildDnaPopulationEntrantAuthorityChunk,
  decodeDnaPopulationEntrantAuthorityChunk,
  replayDnaPopulationEntrantAuthorityArchive,
} from "@/lib/dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";

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

function record(
  raceId: string,
  mode: "bike" | "car" | "horse",
  entrants: readonly string[],
): DnaPopulationEntrantAuthorityRecord {
  return Object.freeze({
    sourceRaceId: raceId,
    observedAt: "2026-09-25T00:00:00.000Z",
    rawEvidenceSha256: createHash("sha256").update(raceId).digest("hex"),
    mode,
    entrantCoreIds: Object.freeze([...entrants]),
  });
}

describe("population entrant authority archive", () => {
  it("round-trips deterministic chunks and replays the exact audited Race set", () => {
    const generationId = "a".repeat(64);
    const chunk1 = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 1,
      records: [record("2", "car", ["202"]), record("1", "bike", ["101"])],
    });
    const chunk2 = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 2,
      records: [record("3", "horse", ["303"])],
    });

    const decoded = decodeDnaPopulationEntrantAuthorityChunk({
      receipt: chunk1.receipt,
      body: chunk1.body,
    });
    expect(decoded.receipt).toEqual(chunk1.receipt);
    expect(decoded.records.map((entry) => entry.sourceRaceId)).toEqual([
      "1",
      "2",
    ]);

    const replay = replayDnaPopulationEntrantAuthorityArchive({
      generationId,
      expectedUnresolvedRaceCount: 3,
      expectedUnresolvedRaceSetSha256: raceSetSha256(["1", "2", "3"]),
      chunks: [chunk1, chunk2],
    });

    expect(replay.chunkCount).toBe(2);
    expect(replay.rowCount).toBe(3);
    expect(replay.archiveRecordSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay.replay.authority.replayedUniqueRaceCount).toBe(3);
    expect(replay.replayIntegrityStatus).toBe(
      "proven_compact_population_archive_replay",
    );
    expect(replay.persistentWriteAllowed).toBe(false);
    expect(replay.paidUsageAllowed).toBe(false);
  });

  it("fails closed on body tampering", () => {
    const chunk = buildDnaPopulationEntrantAuthorityChunk({
      generationId: "b".repeat(64),
      chunkOrdinal: 1,
      records: [record("1", "bike", ["101"])],
    });
    const tampered = new Uint8Array(chunk.body);
    const tamperIndex = tampered.length - 2;
    tampered[tamperIndex] = (tampered[tamperIndex] ?? 0) ^ 1;

    expect(() =>
      decodeDnaPopulationEntrantAuthorityChunk({
        receipt: chunk.receipt,
        body: tampered,
      }),
    ).toThrow("stored chunk body conflicts with its receipt");
  });

  it("fails closed on gaps, overlaps or wrong final Race authority", () => {
    const generationId = "c".repeat(64);
    const first = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 1,
      records: [record("1", "bike", ["101"])],
    });
    const wrongOrdinal = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 3,
      records: [record("2", "car", ["202"])],
    });
    expect(() =>
      replayDnaPopulationEntrantAuthorityArchive({
        generationId,
        expectedUnresolvedRaceCount: 2,
        expectedUnresolvedRaceSetSha256: raceSetSha256(["1", "2"]),
        chunks: [first, wrongOrdinal],
      }),
    ).toThrow("chunk sequence authority is invalid");

    const overlap = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 2,
      records: [record("1", "bike", ["101"])],
    });
    expect(() =>
      replayDnaPopulationEntrantAuthorityArchive({
        generationId,
        expectedUnresolvedRaceCount: 2,
        expectedUnresolvedRaceSetSha256: raceSetSha256(["1", "2"]),
        chunks: [first, overlap],
      }),
    ).toThrow("chunk Race ranges overlap or are out of order");

    const second = buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 2,
      records: [record("2", "car", ["202"])],
    });
    expect(() =>
      replayDnaPopulationEntrantAuthorityArchive({
        generationId,
        expectedUnresolvedRaceCount: 3,
        expectedUnresolvedRaceSetSha256: raceSetSha256(["1", "2", "3"]),
        chunks: [first, second],
      }),
    ).toThrow("replayed Race authority does not match the audited set");
  });
});
