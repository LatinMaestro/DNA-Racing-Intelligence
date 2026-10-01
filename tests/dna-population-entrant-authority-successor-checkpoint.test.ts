import { describe, expect, it } from "vitest";

import { createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority } from "@/lib/dna-population-entrant-authority-successor-checkpoint";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";
import {
  planDnaPopulationEntrantAuthoritySuccessor,
  type DnaPopulationEntrantAuthoritySuccessorPlan,
} from "@/lib/dna-population-entrant-authority-successor-plan";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";

const baseRecords = Object.freeze([
  Object.freeze({
    sourceRaceId: "race-1",
    observedAt: "2026-09-01T00:00:00.000Z",
    rawEvidenceSha256: "1".repeat(64),
    mode: "bike",
    entrantCoreIds: Object.freeze(["1"]),
  }),
  Object.freeze({
    sourceRaceId: "race-2",
    observedAt: "2026-09-01T00:00:00.000Z",
    quarantineReason: "entrant_authority_unresolved",
    sourceEvidenceSha256: "2".repeat(64),
  }),
] satisfies readonly DnaPopulationEntrantAuthorityRecord[]);

function plan() {
  const unresolvedRaceSetSha256 = dnaPopulationEntrantAuthorityRaceSetSha256([
    "race-1",
    "race-2",
  ]);
  const base = replayDnaPopulationEntrantAuthority({
    records: baseRecords,
    expectedUnresolvedRaceCount: 2,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  return planDnaPopulationEntrantAuthoritySuccessor({
    baseGenerationId: unresolvedRaceSetSha256,
    baseRecords,
    expectedUnresolvedRaceCount: 2,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
    expectedBaseRecordSetSha256: base.recordSetSha256,
    replacements: [
      {
        sourceRaceId: "race-2",
        observedAt: "2026-09-02T00:00:00.000Z",
        rawEvidenceSha256: "3".repeat(64),
        mode: "car",
        entrantCoreIds: ["2"],
      },
    ],
  });
}

describe("population entrant authority successor checkpoint", () => {
  it("projects exact immutable base and successor lineage without records", () => {
    const successor = plan();
    const authority =
      createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority(
        successor,
      );

    expect(authority).toEqual({
      version: "dna-population-entrant-authority-successor-checkpoint/v1",
      baseGenerationId: successor.baseGenerationId,
      baseRecordSetSha256: successor.baseRecordSetSha256,
      successorGenerationId: successor.successorGenerationId,
      successorRecordSetSha256: successor.successorRecordSetSha256,
      unresolvedRaceCount: 2,
      unresolvedRaceSetSha256: successor.unresolvedRaceSetSha256,
      replacementRaceCount: 1,
      replacementRaceSetSha256: successor.replacementRaceSetSha256,
      replacementRecordSetSha256: successor.replacementRecordSetSha256,
      quarantinedRaceCountBefore: 1,
      quarantinedRaceCountAfter: 0,
    });
    expect(authority.successorGenerationId).not.toBe(
      authority.baseGenerationId,
    );
    expect(Object.isFrozen(authority)).toBe(true);
    expect(authority).not.toHaveProperty("records");
    expect(authority).not.toHaveProperty("persistentWriteAllowed");
  });

  it.each<
    [
      string,
      (
        value: DnaPopulationEntrantAuthoritySuccessorPlan,
      ) => DnaPopulationEntrantAuthoritySuccessorPlan,
    ]
  >([
    [
      "changed base binding",
      (value) => ({ ...value, baseGenerationId: "f".repeat(64) }),
    ],
    [
      "reused base identity",
      (value) => ({
        ...value,
        successorGenerationId: value.baseGenerationId,
      }),
    ],
    [
      "wrong quarantine delta",
      (value) => ({ ...value, quarantinedRaceCountAfter: 1 }),
    ],
    [
      "invalid replacement count",
      (value) => ({ ...value, replacementRaceCount: 0 }),
    ],
  ])("rejects %s", (_label, alter) => {
    const successor = plan();
    const altered = alter(successor);

    expect(() =>
      createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority(altered),
    ).toThrow(/successor checkpoint:/u);
  });
});
