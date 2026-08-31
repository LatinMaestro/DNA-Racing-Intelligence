import { describe, expect, it } from "vitest";

import {
  assessBreedingOffspringEvidence,
  toAuthoritativeBreederOutcome,
  toQualifiedBreederOutcome,
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
    expect(toQualifiedBreederOutcome(evidence())).not.toBeNull();
    expect(toAuthoritativeBreederOutcome(evidence())).not.toBeNull();
  });

  it("accepts owner-approved first-race chronology for elite-breeder modelling while retaining proxy warnings", () => {
    const proxy = evidence({
      creationAuthority: "first_race_proxy",
      offspringCreatedAt: "2025-04-10T00:00:00.000Z",
      expectedModelCutoff: "2025-04-01T00:00:00.000Z",
      source: "legacy_first_race_proxy",
    });
    const assessment = assessBreedingOffspringEvidence(proxy);
    expect(assessment.usableForEliteBreederTarget).toBe(true);
    expect(assessment.warnings).toContain(
      "FIRST_RACE_USED_AS_APPROXIMATE_CREATION_TIME",
    );
    expect(assessment.warnings).toContain(
      "FIRST_RACE_PROXY_MAY_LAG_ACTUAL_BREED_TIME",
    );
    expect(toQualifiedBreederOutcome(proxy)).not.toBeNull();
    expect(toAuthoritativeBreederOutcome(proxy)).not.toBeNull();
  });

  it("rejects a mating expectation frozen after authoritative creation", () => {
    expect(() =>
      assessBreedingOffspringEvidence(
        evidence({
          offspringCreatedAt: "2025-03-15T00:00:00.000Z",
          expectedModelCutoff: "2025-03-16T00:00:00.000Z",
        }),
      ),
    ).toThrow(
      /baseline must be frozen no later than authoritative offspring creation/i,
    );
  });

  it("rejects a mating expectation frozen after the first-race chronology proxy", () => {
    expect(() =>
      assessBreedingOffspringEvidence(
        evidence({
          creationAuthority: "first_race_proxy",
          offspringCreatedAt: "2025-04-10T00:00:00.000Z",
          expectedModelCutoff: "2025-04-11T00:00:00.000Z",
          source: "legacy_first_race_proxy",
        }),
      ),
    ).toThrow(/first-race chronology proxy/i);
  });

  it("keeps unknown creation time unavailable for TARGET modelling", () => {
    const unknown = evidence({
      creationAuthority: "unknown",
      offspringCreatedAt: null,
      source: "lineage_only",
    });
    const assessment = assessBreedingOffspringEvidence(unknown);
    expect(assessment.usableForEliteBreederTarget).toBe(false);
    expect(toQualifiedBreederOutcome(unknown)).toBeNull();
    expect(toAuthoritativeBreederOutcome(unknown)).toBeNull();
  });
});
