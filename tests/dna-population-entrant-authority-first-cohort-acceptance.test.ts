import { describe, expect, it } from "vitest";

import type { CanonicalCoreRaceHistoryResult } from "@/lib/dna-core-race-history-adapter";
import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import { assessDnaPopulationEntrantAuthorityFirstCohortAcceptance } from "@/lib/dna-population-entrant-authority-first-cohort-acceptance";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const GENERATION = "a".repeat(64);

function records(): readonly DnaPopulationEntrantAuthorityRecord[] {
  return Object.freeze([
    Object.freeze({
      sourceRaceId: "race-1",
      observedAt: "2026-09-27T00:00:00.000Z",
      rawEvidenceSha256: "b".repeat(64),
      mode: "bike" as const,
      entrantCoreIds: Object.freeze(["101", "202"]),
    }),
  ]);
}

function raceDocuments(): readonly CanonicalRaceDocumentMetadata[] {
  return Object.freeze([
    Object.freeze({
      sourceType: "race_document" as const,
      sourceRaceId: "race-1",
      displayName: "Synthetic race",
      format: "standard",
      raceClassSourceValue: 2,
      distanceMetres: 1_000,
      gateCount: 2,
      payoutSourceValue: "winner_take_all",
      prizeDistributionSourceValue: Object.freeze({ first: 10 }),
      trackSourceValue: "synthetic-track",
    }),
  ]);
}

function outcome(
  sourceCoreId: string,
  finishPosition: number,
): CanonicalCoreRaceHistoryResult {
  return Object.freeze({
    sourceType: "core_race_history_result",
    sourceCoreId,
    sourceRaceId: "race-1",
    mode: "bike",
    distance: 1_000,
    elapsedTimeSourceValue: finishPosition === 1 ? "51.250" : "52.125",
    finishPosition,
    eventAt: "2026-09-26T00:00:00.000Z",
    sourceFormat: "standard",
    trackSourceValue: "synthetic-track",
  });
}

function assess(coreOutcomes: readonly CanonicalCoreRaceHistoryResult[]) {
  const chunk = buildDnaPopulationEntrantAuthorityChunk({
    generationId: GENERATION,
    chunkOrdinal: 1,
    records: records(),
  });
  return assessDnaPopulationEntrantAuthorityFirstCohortAcceptance({
    raceDocuments: raceDocuments(),
    records: chunk.records,
    raceSetSha256: chunk.receipt.raceSetSha256,
    recordSetSha256: chunk.receipt.recordSetSha256,
    coreOutcomes,
  });
}

describe("population entrant first-cohort owner acceptance", () => {
  it("emits one sanitized PASS after complete Race/Core outcome joins", () => {
    const result = assess([
      outcome("101", 1),
      outcome("202", 2),
      outcome("101", 1),
    ]);

    expect(result).toEqual({
      verdict: "PASS",
      singleRaceAuthority: "PASS",
      availableCanonicalRaceFieldsPreserved: "PASS",
      completeCoreOutcomeIdentityJoins: "PASS",
      exactReplayAndConflictSafety: "PASS",
      compactStorageAttribution: "PASS",
      expectedCoreOutcomeCount: 2,
      verifiedCoreOutcomeCount: 2,
      exactCoreOutcomeReplayCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("race-1");
    expect(JSON.stringify(result)).not.toContain("101");
  });

  it("returns FAIL when durable Core outcome coverage is absent", () => {
    expect(assess([])).toMatchObject({
      verdict: "FAIL",
      completeCoreOutcomeIdentityJoins: "FAIL",
      expectedCoreOutcomeCount: 2,
      verifiedCoreOutcomeCount: 0,
    });
  });

  it("fails closed on a conflicting Core outcome identity", () => {
    expect(() =>
      assess([
        outcome("101", 1),
        { ...outcome("101", 1), elapsedTimeSourceValue: "99.000" },
      ]),
    ).toThrow("conflicting Core outcome replay detected");
  });

  it("fails closed when Core outcome mode or distance disagrees", () => {
    expect(() => assess([{ ...outcome("101", 1), distance: 2_000 }])).toThrow(
      "Core outcome identity join is invalid",
    );
  });
});
