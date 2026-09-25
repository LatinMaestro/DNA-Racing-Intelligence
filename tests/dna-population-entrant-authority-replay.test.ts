import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";

function setHash(raceIds: readonly string[]): string {
  return createHash("sha256")
    .update(
      ["dna_open_lab", "population_history", "unresolved_races", ...raceIds]
        .map(String)
        .join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function record(input: {
  raceId: string;
  raw?: string;
  mode?: "bike" | "car" | "horse";
  entrants?: readonly string[];
}): DnaPopulationEntrantAuthorityRecord {
  return Object.freeze({
    sourceRaceId: input.raceId,
    observedAt: "2026-09-25T00:00:00.000Z",
    rawEvidenceSha256: input.raw ?? "a".repeat(64),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.entrants === undefined
      ? {}
      : { entrantCoreIds: Object.freeze([...input.entrants]) }),
  });
}

describe("population entrant authority replay", () => {
  it("reconstructs canonical population authority and accepts exact replay duplicates", () => {
    const records = [
      record({ raceId: "10", mode: "bike", entrants: ["101", "202"] }),
      record({ raceId: "2", mode: "car", entrants: ["303"] }),
      record({ raceId: "10", mode: "bike", entrants: ["101", "202"] }),
    ];
    const expectedIds = ["10", "2"].sort();

    const replay = replayDnaPopulationEntrantAuthority({
      records,
      expectedUnresolvedRaceCount: 2,
      expectedUnresolvedRaceSetSha256: setHash(expectedIds),
    });

    expect(replay.authority).toEqual({
      unresolvedRaceCount: 2,
      unresolvedRaceSetSha256: setHash(expectedIds),
      replayedUniqueRaceCount: 2,
      replayedRaceSetSha256: setHash(expectedIds),
    });
    expect(replay.exactReplayDuplicateCount).toBe(1);
    expect(replay.recordSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay.canonicalDocuments).toEqual([
      {
        sourceType: "race_document",
        sourceRaceId: "10",
        mode: "bike",
        entrantCoreIds: ["101", "202"],
      },
      {
        sourceType: "race_document",
        sourceRaceId: "2",
        mode: "car",
        entrantCoreIds: ["303"],
      },
    ]);
    expect(replay.replayIntegrityStatus).toBe(
      "proven_compact_population_authority_replay",
    );
    expect(replay.providerReadRequired).toBe(false);
    expect(replay.persistentWriteAllowed).toBe(false);
    expect(replay.paidUsageAllowed).toBe(false);
  });

  it("fails closed when the same Race replays with altered authority or provenance", () => {
    expect(() =>
      replayDnaPopulationEntrantAuthority({
        records: [
          record({ raceId: "10", mode: "bike", entrants: ["101"] }),
          record({
            raceId: "10",
            raw: "b".repeat(64),
            mode: "bike",
            entrants: ["101"],
          }),
        ],
        expectedUnresolvedRaceCount: 1,
        expectedUnresolvedRaceSetSha256: setHash(["10"]),
      }),
    ).toThrow("conflicting compact entrant replay detected");
  });

  it("fails closed when replay does not match the audited unresolved Race set", () => {
    expect(() =>
      replayDnaPopulationEntrantAuthority({
        records: [record({ raceId: "10", mode: "horse", entrants: ["404"] })],
        expectedUnresolvedRaceCount: 2,
        expectedUnresolvedRaceSetSha256: setHash(["10", "20"]),
      }),
    ).toThrow("replayed Race authority does not match the audited set");
  });

  it("rejects non-canonical compact records", () => {
    expect(() =>
      replayDnaPopulationEntrantAuthority({
        records: [
          {
            ...record({ raceId: "10", mode: "bike", entrants: ["101"] }),
            observedAt: "2026-09-25T10:00:00+10:00",
          },
        ],
        expectedUnresolvedRaceCount: 1,
        expectedUnresolvedRaceSetSha256: setHash(["10"]),
      }),
    ).toThrow("compact entrant record is not canonical");
  });
});
