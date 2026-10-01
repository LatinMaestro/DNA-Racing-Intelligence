import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "@/lib/dna-population-entrant-authority-record";
import { planDnaPopulationEntrantAuthoritySuccessor } from "@/lib/dna-population-entrant-authority-successor-plan";

const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const RESOLVED_AT = "2026-10-01T01:00:00.000Z";

function resolved(
  raceId: string,
  raw = "a".repeat(64),
  observedAt = OBSERVED_AT,
): DnaPopulationEntrantAuthorityResolvedRecord {
  return Object.freeze({
    sourceRaceId: raceId,
    observedAt,
    rawEvidenceSha256: raw,
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["1", "2"]),
  });
}

function fixture() {
  const records: readonly DnaPopulationEntrantAuthorityRecord[] = [
    resolved("race-1"),
    dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "race-2",
      observedAt: OBSERVED_AT,
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: "b".repeat(64),
    }),
    dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "race-3",
      observedAt: OBSERVED_AT,
      quarantineReason: "provider_document_unusable",
      sourceEvidenceSha256: "c".repeat(64),
    }),
  ];
  const raceIds = records.map((record) => record.sourceRaceId).sort();
  const unresolvedRaceSetSha256 =
    dnaPopulationEntrantAuthorityRaceSetSha256(raceIds);
  const replay = replayDnaPopulationEntrantAuthority({
    records,
    expectedUnresolvedRaceCount: records.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  return { records, unresolvedRaceSetSha256, replay };
}

describe("population entrant authority successor plan", () => {
  it("replaces only quarantined authority and derives a new immutable generation", () => {
    const base = fixture();
    const replacement = resolved("race-2", "d".repeat(64), RESOLVED_AT);

    const plan = planDnaPopulationEntrantAuthoritySuccessor({
      baseGenerationId: base.unresolvedRaceSetSha256,
      baseRecords: base.records,
      expectedUnresolvedRaceCount: base.records.length,
      expectedUnresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
      expectedBaseRecordSetSha256: base.replay.recordSetSha256,
      replacements: [replacement],
    });

    expect(plan).toMatchObject({
      baseGenerationId: base.unresolvedRaceSetSha256,
      baseRecordSetSha256: base.replay.recordSetSha256,
      unresolvedRaceCount: 3,
      unresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
      replacementRaceCount: 1,
      quarantinedRaceCountBefore: 2,
      quarantinedRaceCountAfter: 1,
      lastGoodBasePreserved: true,
      providerRequestPerformed: false,
      persistentWriteAllowed: false,
      paidUsageAllowed: false,
    });
    expect(plan.successorGenerationId).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.successorGenerationId).not.toBe(plan.baseGenerationId);
    expect(plan.records).toHaveLength(3);
    expect(base.records[1]).toHaveProperty(
      "quarantineReason",
      "entrant_authority_unresolved",
    );
  });

  it("is deterministic across base and replacement order", () => {
    const base = fixture();
    const replacements = [
      resolved("race-2", "d".repeat(64), RESOLVED_AT),
      resolved("race-3", "e".repeat(64), RESOLVED_AT),
    ];
    const input = {
      baseGenerationId: base.unresolvedRaceSetSha256,
      expectedUnresolvedRaceCount: base.records.length,
      expectedUnresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
      expectedBaseRecordSetSha256: base.replay.recordSetSha256,
    };

    const first = planDnaPopulationEntrantAuthoritySuccessor({
      ...input,
      baseRecords: base.records,
      replacements,
    });
    const second = planDnaPopulationEntrantAuthoritySuccessor({
      ...input,
      baseRecords: [...base.records].reverse(),
      replacements: [...replacements].reverse(),
    });

    expect(second.successorGenerationId).toBe(first.successorGenerationId);
    expect(second.successorRecordSetSha256).toBe(
      first.successorRecordSetSha256,
    );
    expect(second.records).toEqual(first.records);
  });

  it("rejects stale base authority and duplicate replacements", () => {
    const base = fixture();
    const replacement = resolved("race-2", "d".repeat(64), RESOLVED_AT);
    const common = {
      baseGenerationId: base.unresolvedRaceSetSha256,
      baseRecords: base.records,
      expectedUnresolvedRaceCount: base.records.length,
      expectedUnresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
      replacements: [replacement],
    };

    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        ...common,
        expectedBaseRecordSetSha256: "f".repeat(64),
      }),
    ).toThrow("base generation replay is not exact");
    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        ...common,
        expectedBaseRecordSetSha256: base.replay.recordSetSha256,
        replacements: [replacement, replacement],
      }),
    ).toThrow("replacement authority is not uniquely resolved");
  });

  it("rejects replacement of accepted authority or non-newer evidence", () => {
    const base = fixture();
    const common = {
      baseGenerationId: base.unresolvedRaceSetSha256,
      baseRecords: base.records,
      expectedUnresolvedRaceCount: base.records.length,
      expectedUnresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
      expectedBaseRecordSetSha256: base.replay.recordSetSha256,
    };

    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        ...common,
        replacements: [resolved("race-1", "d".repeat(64), RESOLVED_AT)],
      }),
    ).toThrow("replacement targets non-quarantined Race authority");
    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        ...common,
        replacements: [
          resolved("race-2", "d".repeat(64), "2026-09-30T23:59:59.000Z"),
        ],
      }),
    ).toThrow("replacement evidence is not newer than quarantined authority");
    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        ...common,
        replacements: [resolved("race-2", "d".repeat(64), OBSERVED_AT)],
      }),
    ).toThrow("replacement evidence is not newer than quarantined authority");
  });

  it("requires actual entrant membership and a quarantined base", () => {
    const base = fixture();
    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        baseGenerationId: base.unresolvedRaceSetSha256,
        baseRecords: base.records,
        expectedUnresolvedRaceCount: base.records.length,
        expectedUnresolvedRaceSetSha256: base.unresolvedRaceSetSha256,
        expectedBaseRecordSetSha256: base.replay.recordSetSha256,
        replacements: [
          Object.freeze({
            sourceRaceId: "race-2",
            observedAt: RESOLVED_AT,
            rawEvidenceSha256: "d".repeat(64),
            entrantCoreIdsEvidenceStatus: "unsupported_source_value" as const,
          }),
        ],
      }),
    ).toThrow("replacement authority is not uniquely resolved");

    const accepted = [resolved("race-1")];
    const acceptedSet = dnaPopulationEntrantAuthorityRaceSetSha256(["race-1"]);
    const acceptedReplay = replayDnaPopulationEntrantAuthority({
      records: accepted,
      expectedUnresolvedRaceCount: 1,
      expectedUnresolvedRaceSetSha256: acceptedSet,
    });
    expect(() =>
      planDnaPopulationEntrantAuthoritySuccessor({
        baseGenerationId: acceptedSet,
        baseRecords: accepted,
        expectedUnresolvedRaceCount: 1,
        expectedUnresolvedRaceSetSha256: acceptedSet,
        expectedBaseRecordSetSha256: acceptedReplay.recordSetSha256,
        replacements: [resolved("race-1", "d".repeat(64), RESOLVED_AT)],
      }),
    ).toThrow("base generation has no quarantined authority to replace");
  });
});
