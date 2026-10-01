import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "@/lib/dna-population-entrant-authority-record";
import { planDnaPopulationEntrantAuthoritySuccessor } from "@/lib/dna-population-entrant-authority-successor-plan";
import { verifyDnaPopulationEntrantAuthoritySuccessorPublication } from "@/lib/dna-population-entrant-authority-successor-publication";

const BASE_AT = "2026-10-01T00:00:00.000Z";
const REPLACED_AT = "2026-10-01T01:00:00.000Z";

function resolved(
  raceId: string,
  observedAt = BASE_AT,
  entrants: readonly string[] = ["1", "2"],
): DnaPopulationEntrantAuthorityResolvedRecord {
  return Object.freeze({
    sourceRaceId: raceId,
    observedAt,
    rawEvidenceSha256: createHash("sha256").update(raceId).digest("hex"),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze([...entrants]),
  });
}

function fixture() {
  const baseRecords: readonly DnaPopulationEntrantAuthorityRecord[] = [
    resolved("race-1"),
    dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "race-2",
      observedAt: BASE_AT,
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: "a".repeat(64),
    }),
    dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "race-3",
      observedAt: BASE_AT,
      quarantineReason: "provider_document_unusable",
      sourceEvidenceSha256: "b".repeat(64),
    }),
  ];
  const unresolvedRaceSetSha256 = dnaPopulationEntrantAuthorityRaceSetSha256([
    "race-1",
    "race-2",
    "race-3",
  ]);
  const baseReplay = replayDnaPopulationEntrantAuthority({
    records: baseRecords,
    expectedUnresolvedRaceCount: baseRecords.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  const replacements = [resolved("race-2", REPLACED_AT, ["7", "8"])];
  const plan = planDnaPopulationEntrantAuthoritySuccessor({
    baseGenerationId: unresolvedRaceSetSha256,
    baseRecords,
    expectedUnresolvedRaceCount: baseRecords.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
    expectedBaseRecordSetSha256: baseReplay.recordSetSha256,
    replacements,
  });
  const common = {
    baseGenerationId: unresolvedRaceSetSha256,
    baseRecords,
    expectedUnresolvedRaceCount: baseRecords.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
    expectedBaseRecordSetSha256: baseReplay.recordSetSha256,
    replacements,
  };
  return { common, plan };
}

describe("population entrant authority successor publication", () => {
  it("independently proves the complete immutable successor archive", () => {
    const { common, plan } = fixture();
    const successorChunks = [
      buildDnaPopulationEntrantAuthorityChunk({
        generationId: plan.successorGenerationId,
        chunkOrdinal: 1,
        records: plan.records.slice(0, 2),
      }),
      buildDnaPopulationEntrantAuthorityChunk({
        generationId: plan.successorGenerationId,
        chunkOrdinal: 2,
        records: plan.records.slice(2),
      }),
    ];

    const proof = verifyDnaPopulationEntrantAuthoritySuccessorPublication({
      ...common,
      successorChunks,
    });

    expect(proof).toMatchObject({
      baseGenerationId: plan.baseGenerationId,
      successorGenerationId: plan.successorGenerationId,
      successorRecordSetSha256: plan.successorRecordSetSha256,
      unresolvedRaceCount: 3,
      replacementRaceCount: 1,
      chunkCount: 2,
      quarantinedRaceCountBefore: 2,
      quarantinedRaceCountAfter: 1,
      publicationIntegrityStatus: "proven_immutable_successor_archive",
      lastGoodBasePreserved: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      publicationAllowed: false,
      paidUsageAllowed: false,
    });
  });

  it("fails closed when the archive contains a different accepted record", () => {
    const { common, plan } = fixture();
    const wrongRecords = plan.records.map((record) =>
      record.sourceRaceId === "race-1"
        ? resolved("race-1", BASE_AT, ["999"])
        : record,
    );
    const successorChunks = [
      buildDnaPopulationEntrantAuthorityChunk({
        generationId: plan.successorGenerationId,
        chunkOrdinal: 1,
        records: wrongRecords,
      }),
    ];

    expect(() =>
      verifyDnaPopulationEntrantAuthoritySuccessorPublication({
        ...common,
        successorChunks,
      }),
    ).toThrow("archive disagrees with the deterministic successor");
  });

  it("fails closed on wrong lineage or incomplete archive coverage", () => {
    const { common, plan } = fixture();
    const wrongLineage = buildDnaPopulationEntrantAuthorityChunk({
      generationId: "f".repeat(64),
      chunkOrdinal: 1,
      records: plan.records,
    });
    expect(() =>
      verifyDnaPopulationEntrantAuthoritySuccessorPublication({
        ...common,
        successorChunks: [wrongLineage],
      }),
    ).toThrow("chunk sequence authority is invalid");

    const incomplete = buildDnaPopulationEntrantAuthorityChunk({
      generationId: plan.successorGenerationId,
      chunkOrdinal: 1,
      records: plan.records.slice(0, 2),
    });
    expect(() =>
      verifyDnaPopulationEntrantAuthoritySuccessorPublication({
        ...common,
        successorChunks: [incomplete],
      }),
    ).toThrow("replayed Race authority does not match the audited set");
  });
});
