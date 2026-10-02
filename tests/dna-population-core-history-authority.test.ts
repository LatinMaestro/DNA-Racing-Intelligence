import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { completeDnaPopulationCoreHistoryAuthority } from "@/lib/dna-population-core-history-authority";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
} from "@/lib/dna-population-entrant-authority-record";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

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

function base(
  raceId: string,
  input: Partial<CanonicalRaceDocumentMetadata> = {},
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document",
    sourceRaceId: raceId,
    ...input,
  });
}

function entrant(
  sourceRaceId: string,
  mode: "bike" | "car" | "horse",
  entrantCoreIds: readonly string[],
): DnaPopulationEntrantAuthorityRecord {
  return Object.freeze({
    sourceRaceId,
    observedAt: "2026-09-25T00:00:00.000Z",
    rawEvidenceSha256: sourceRaceId.padStart(64, "a").slice(-64),
    mode,
    entrantCoreIds: Object.freeze([...entrantCoreIds]),
  });
}

describe("population Core history authority reconstruction", () => {
  it("overlays only missing entrant facts and builds one all-mode Core universe", () => {
    const records = [
      entrant("2", "car", ["202", "303"]),
      entrant("3", "horse", ["101", "404"]),
    ];

    const result = completeDnaPopulationCoreHistoryAuthority({
      baseRaceDocuments: [
        base("1", {
          mode: "bike",
          entrantCoreIds: ["101", "202"],
          distanceMetres: 1200,
          gateCount: 8,
        }),
        base("2", {
          mode: "car",
          distanceMetres: 1400,
          gateCount: 10,
          entrantCoreIdsEvidenceStatus: "unsupported_source_value",
        }),
        base("3", {
          distanceMetres: 1600,
          gateCount: 12,
          modeEvidenceStatus: "unsupported_source_value",
          entrantCoreIdsEvidenceStatus: "unsupported_source_value",
        }),
      ],
      entrantRecords: records,
      expectedUnresolvedRaceCount: 2,
      expectedUnresolvedRaceSetSha256: setHash(["2", "3"]),
      persistedPerformanceCoreIds: [101],
    });

    expect(result.plan).toMatchObject({
      status: "ready_for_budget_measurement",
      populationUniverseCompleteness: "complete_from_race_authority",
      raceDocumentCount: 3,
      raceCountByMode: { bike: 1, car: 1, horse: 1 },
      raceWithoutEntrantAuthorityByMode: { bike: 0, car: 0, horse: 0 },
      raceWithUnknownModeCount: 0,
      populationCoreCount: 4,
      persistedPerformanceCoreCount: 1,
      missingPerformanceCoreCount: 3,
      providerReadAllowed: false,
      persistentWriteAllowed: false,
      paidUsageAllowed: false,
    });
    expect(result.raceDocuments[0]).toMatchObject({
      sourceRaceId: "1",
      distanceMetres: 1200,
      gateCount: 8,
    });
    expect(result.raceDocuments[1]).toMatchObject({
      sourceRaceId: "2",
      mode: "car",
      entrantCoreIds: ["202", "303"],
      distanceMetres: 1400,
    });
    expect(result.raceDocuments[1]).not.toHaveProperty(
      "entrantCoreIdsEvidenceStatus",
    );
    expect(result.raceDocuments[2]).toMatchObject({
      sourceRaceId: "3",
      mode: "horse",
      entrantCoreIds: ["101", "404"],
    });
    expect(result.providerReadRequired).toBe(false);
  });

  it("fails closed when compact entrant authority conflicts with canonical Race facts", () => {
    expect(() =>
      completeDnaPopulationCoreHistoryAuthority({
        baseRaceDocuments: [
          base("1", { mode: "bike", entrantCoreIds: ["101"] }),
        ],
        entrantRecords: [entrant("1", "car", ["101"])],
        expectedUnresolvedRaceCount: 1,
        expectedUnresolvedRaceSetSha256: setHash(["1"]),
      }),
    ).toThrow("Race mode authority conflicts");

    expect(() =>
      completeDnaPopulationCoreHistoryAuthority({
        baseRaceDocuments: [
          base("1", { mode: "bike", entrantCoreIds: ["101"] }),
        ],
        entrantRecords: [entrant("2", "bike", ["202"])],
        expectedUnresolvedRaceCount: 1,
        expectedUnresolvedRaceSetSha256: setHash(["2"]),
      }),
    ).toThrow("escaped the canonical Race authority");
  });

  it("keeps quarantined entrant authority unresolved instead of inventing a Core", () => {
    const record = dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "2",
      observedAt: "2026-09-25T00:00:00.000Z",
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: "b".repeat(64),
    });
    const result = completeDnaPopulationCoreHistoryAuthority({
      baseRaceDocuments: [
        base("1", { mode: "bike", entrantCoreIds: ["101"] }),
        base("2", {
          mode: "horse",
          entrantCoreIdsEvidenceStatus: "unsupported_source_value",
        }),
      ],
      entrantRecords: [record],
      expectedUnresolvedRaceCount: 1,
      expectedUnresolvedRaceSetSha256: setHash(["2"]),
    });

    expect(result.entrantReplay.quarantinedRaceCount).toBe(1);
    expect(result.plan).toMatchObject({
      status: "ready_for_budget_measurement",
      populationUniverseCompleteness: "partial_due_to_unresolved_races",
      unresolvedRaceCount: 1,
      populationCoreCount: 1,
      missingPerformanceCoreCount: 1,
      budgetMeasurementRequired: true,
    });
    expect(result.plan.cohorts[0]?.coreIds).toEqual([101]);
  });
});
