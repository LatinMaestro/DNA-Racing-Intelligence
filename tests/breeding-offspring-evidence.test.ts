import { describe, expect, it } from "vitest";
import {
  assessBreedingOffspringEvidence,
  toAuthoritativeBreederOutcome,
  type BreedingOffspringEvidence,
} from "@/domain/breeding-offspring-evidence";

function evidence(
  overrides: Partial<BreedingOffspringEvidence> = {},
): BreedingOffspringEvidence {
  return {
    parentCoreId: "100",
    coParentCoreId: "200",
    offspringCoreId: "300",
    mode: "bike",
    distanceMetres: 1_400,
    offspringQualityPercentile: 99,
    expectedQualityPercentile: 60,
    residualPercentile: 98,
    offspringRaceSampleSize: 20,
    benchmarkPopulationSize: 300,
    creationAuthority: "authoritative_minted_at",
    offspringCreatedAt: "2025-03-15T00:00:00.000Z",
    expectedModelCutoff: "2025-03-01T00:00:00.000Z",
    evaluationCutoff: "2026-08-30T00:00:00.000Z",
    source: "dna_splice_document_plus_race_history",
    ...overrides,
  };
}

describe("breeding offspring evidence authority", () => {
  it("allows authoritative minted-at evidence into elite-breeder modelling", () => {
    const assessment = assessBreedingOffspringEvidence(evidence());
    expect(assessment.usableForEliteBreederTarget).toBe(true);
    expect(toAuthoritativeBreederOutcome(evidence())).not.toBeNull();
  });

  it("keeps first-race creation proxies out of elite-breeder TARGET evidence", () => {
    const proxy = evidence({
      creationAuthority: "first_race_proxy",
      offspringCreatedAt: "2025-04-10T00:00:00.000Z",
      expectedModelCutoff: "2025-04-01T00:00:00.000Z",
      source: "legacy_first_race_proxy",
    });
    const assessment = assessBreedingOffspringEvidence(proxy);
    expect(assessment.usableForEliteBreederTarget).toBe(false);
    expect(assessment.warnings).toContain(
      "PROXY_EVIDENCE_CANNOT_PROMOTE_ELITE_BREEDER_TARGET",
    );
    expect(toAuthoritativeBreederOutcome(proxy)).toBeNull();
  });

  it("rejects a mating expectation frozen after authoritative creation", () => {
    expect(() =>
      assessBreedingOffspringEvidence(
        evidence({
          offspringCreatedAt: "2025-03-15T00:00:00.000Z",
          expectedModelCutoff: "2025-03-16T00:00:00.000Z",
        }),
      ),
    ).toThrow(/baseline must be frozen no later than authoritative offspring creation/i);
  });

  it("keeps unknown creation time unavailable for TARGET modelling", () => {
    const unknown = evidence({
      creationAuthority: "unknown",
      offspringCreatedAt: null,
      source: "lineage_only",
    });
    const assessment = assessBreedingOffspringEvidence(unknown);
    expect(assessment.usableForEliteBreederTarget).toBe(false);
    expect(toAuthoritativeBreederOutcome(unknown)).toBeNull();
  });
});
