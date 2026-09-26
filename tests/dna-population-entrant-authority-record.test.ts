import { describe, expect, it } from "vitest";

import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  dnaPopulationEntrantAuthorityRecord,
  dnaPopulationEntrantAuthorityRecordBytes,
} from "@/lib/dna-population-entrant-authority-record";
import type {
  CanonicalRaceDocumentMetadata,
  DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";

function evidence(
  canonical: CanonicalRaceDocumentMetadata,
): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  return Object.freeze({
    source: "dna_open_lab",
    sourceVersion: "v1",
    scope: "races",
    endpoint: "races.docs",
    entityKey: `race:${canonical.sourceRaceId}`,
    observedAt: "2026-09-25T00:00:00.000Z",
    rawEvidenceSha256: "a".repeat(64),
    canonical,
  });
}

describe("population entrant authority record", () => {
  it("retains only population entrant authority plus raw provenance", () => {
    const source = evidence({
      sourceType: "race_document",
      sourceRaceId: "42",
      status: "finished",
      displayName: "Large source field deliberately excluded",
      mode: "bike",
      distanceMetres: 1600,
      gateCount: 12,
      entrantCoreIds: ["101", "202"],
      payoutSourceValue: "some-payout",
    });

    const record = dnaPopulationEntrantAuthorityRecord(source);

    expect(record).toEqual({
      sourceRaceId: "42",
      observedAt: "2026-09-25T00:00:00.000Z",
      rawEvidenceSha256: "a".repeat(64),
      mode: "bike",
      entrantCoreIds: ["101", "202"],
    });
    expect(record).not.toHaveProperty("displayName");
    expect(record).not.toHaveProperty("distanceMetres");
    expect(record).not.toHaveProperty("gateCount");
    expect(record).not.toHaveProperty("payoutSourceValue");
    expect(dnaPopulationEntrantAuthorityRecordBytes(source)).toBeGreaterThan(0);
  });

  it("preserves unsupported and absent authority without inventing values", () => {
    expect(
      dnaPopulationEntrantAuthorityRecord(
        evidence({
          sourceType: "race_document",
          sourceRaceId: "7",
          modeEvidenceStatus: "unsupported_source_value",
          entrantCoreIdsEvidenceStatus: "unsupported_source_value",
        }),
      ),
    ).toMatchObject({
      sourceRaceId: "7",
      modeEvidenceStatus: "unsupported_source_value",
      entrantCoreIdsEvidenceStatus: "unsupported_source_value",
    });

    expect(
      dnaPopulationEntrantAuthorityRecord(
        evidence({
          sourceType: "race_document",
          sourceRaceId: "8",
        }),
      ),
    ).not.toHaveProperty("entrantCoreIds");
  });


  it("creates a compact quarantine outcome without inventing authority", () => {
    expect(
      dnaPopulationEntrantAuthorityQuarantineRecord({
        sourceRaceId: "77",
        observedAt: "2026-09-25T10:00:00+10:00",
        quarantineReason: "provider_document_missing",
      }),
    ).toEqual({
      sourceRaceId: "77",
      observedAt: "2026-09-25T00:00:00.000Z",
      quarantineReason: "provider_document_missing",
    });

    expect(
      dnaPopulationEntrantAuthorityQuarantineRecord({
        sourceRaceId: "78",
        observedAt: "2026-09-25T00:00:00.000Z",
        quarantineReason: "entrant_authority_unresolved",
        sourceEvidenceSha256: "b".repeat(64),
      }),
    ).toEqual({
      sourceRaceId: "78",
      observedAt: "2026-09-25T00:00:00.000Z",
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: "b".repeat(64),
    });
  });

  it("fails closed on contradictory or duplicate entrant authority", () => {
    expect(() =>
      dnaPopulationEntrantAuthorityRecord(
        evidence({
          sourceType: "race_document",
          sourceRaceId: "9",
          mode: "bike",
          modeEvidenceStatus: "unsupported_source_value",
        }),
      ),
    ).toThrow("Race mode authority is contradictory");

    expect(() =>
      dnaPopulationEntrantAuthorityRecord(
        evidence({
          sourceType: "race_document",
          sourceRaceId: "10",
          entrantCoreIds: ["101", "101"],
        }),
      ),
    ).toThrow("entrant Core IDs are invalid");
  });
});
