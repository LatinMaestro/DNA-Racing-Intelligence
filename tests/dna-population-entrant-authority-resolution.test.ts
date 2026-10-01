import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";
import { resolveDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-resolution";

const OBSERVED_AT = "2026-10-01T00:00:00.000Z";

function resolve(records: readonly DnaPopulationEntrantAuthorityRecord[]) {
  return resolveDnaPopulationEntrantAuthority({
    records,
    expectedUnresolvedRaceCount: records.length,
    expectedUnresolvedRaceSetSha256: dnaPopulationEntrantAuthorityRaceSetSha256(
      records.map((record) => record.sourceRaceId),
    ),
  });
}

describe("population entrant authority resolution", () => {
  it("reports resolved authority complete only when strict replay has no quarantine", () => {
    const receipt = resolve([
      Object.freeze({
        sourceRaceId: "race-1",
        observedAt: OBSERVED_AT,
        rawEvidenceSha256: "a".repeat(64),
        mode: "bike" as const,
        entrantCoreIds: Object.freeze(["1", "2"]),
      }),
    ]);

    expect(receipt).toMatchObject({
      status: "resolved_authority_complete",
      unresolvedRaceCount: 1,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 0,
      quarantinedRaceSetSha256: null,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("reports complete coverage with quarantine as unresolved authority", () => {
    const receipt = resolve([
      Object.freeze({
        sourceRaceId: "race-1",
        observedAt: OBSERVED_AT,
        rawEvidenceSha256: "a".repeat(64),
        mode: "bike" as const,
        entrantCoreIds: Object.freeze(["1"]),
      }),
      Object.freeze({
        sourceRaceId: "race-2",
        observedAt: OBSERVED_AT,
        quarantineReason: "provider_document_unusable" as const,
        sourceEvidenceSha256: "b".repeat(64),
      }),
      Object.freeze({
        sourceRaceId: "race-3",
        observedAt: OBSERVED_AT,
        quarantineReason: "entrant_authority_unresolved" as const,
        sourceEvidenceSha256: "c".repeat(64),
      }),
    ]);

    expect(receipt).toMatchObject({
      status: "coverage_complete_with_quarantine",
      unresolvedRaceCount: 3,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 2,
      quarantinedRaceCountByReason: {
        provider_document_missing: 0,
        provider_document_unusable: 1,
        entrant_authority_unresolved: 1,
      },
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(receipt.quarantinedRaceSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
