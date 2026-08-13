import { describe, expect, it } from "vitest";

import {
  projectTournamentEvidenceAuthority,
  type TournamentEvidenceBenchmark,
  type TournamentEvidenceCandidate,
  type TournamentEvidenceProfile,
} from "@/domain/tournament-evidence-authority";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

const candidates: readonly TournamentEvidenceCandidate[] = [
  { coreId: "strong", eligibility: "eligible" },
  { coreId: "competitive", eligibility: "eligible" },
  { coreId: "weak", eligibility: "eligible" },
];

function rule(
  distances: readonly number[] = [1_200],
): Pick<
  TournamentRuleConfiguration,
  "mode" | "eligibleDistancesMetres" | "qualification"
> {
  return {
    mode: "bike",
    eligibleDistancesMetres: distances,
    qualification: {
      minimumRaceCount: 10,
      target: { kind: "count", value: 5 },
      rankingMetric: "fastest_single_time",
      topFinishPosition: null,
      pointsTable: {},
      customScoringConfiguration: {},
    },
  };
}

function profile(
  coreId: string,
  bestMilliseconds: number,
  medianMilliseconds: number,
  overrides: Partial<TournamentEvidenceProfile> = {},
): TournamentEvidenceProfile {
  return {
    coreId,
    mode: "bike",
    distanceMetres: 1_200,
    raceCount: 10,
    bestMilliseconds,
    medianMilliseconds,
    ...overrides,
  };
}

function benchmark(
  overrides: Partial<TournamentEvidenceBenchmark> = {},
): TournamentEvidenceBenchmark {
  return {
    mode: "bike",
    distanceMetres: 1_200,
    dataCurrentThrough: "2026-08-01T00:00:00.000Z",
    raceEntryCount: 1_000,
    winningEntryCount: 100,
    topThreeEntryCount: 300,
    winningP75Milliseconds: 60_000,
    winningMedianMilliseconds: 59_000,
    topThreeP75Milliseconds: 63_000,
    topThreeMedianMilliseconds: 62_000,
    refreshedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("Tournament evidence authority", () => {
  it("classifies exact-distance time evidence against population outcomes", () => {
    const result = projectTournamentEvidenceAuthority(
      rule(),
      candidates,
      [
        profile("strong", 59_500, 60_500),
        profile("competitive", 62_500, 63_500),
        profile("weak", 64_000, 65_000),
      ],
      [benchmark()],
    );

    expect([...result]).toEqual([
      ["strong", { timeEvidence: "strong", evidenceConfidence: "medium" }],
      [
        "competitive",
        { timeEvidence: "competitive", evidenceConfidence: "medium" },
      ],
      ["weak", { timeEvidence: "weak", evidenceConfidence: "medium" }],
    ]);
  });

  it("keeps a promising sub-minimum sample low confidence", () => {
    const result = projectTournamentEvidenceAuthority(
      rule(),
      candidates.slice(0, 1),
      [profile("strong", 59_000, 60_000, { raceCount: 9 })],
      [benchmark()],
    );

    expect(result.get("strong")).toEqual({
      timeEvidence: "strong",
      evidenceConfidence: "low",
    });
  });

  it("fails closed without exact comparable evidence", () => {
    const missingProfile = projectTournamentEvidenceAuthority(
      rule(),
      candidates.slice(0, 1),
      [],
      [benchmark()],
    );
    expect(missingProfile.get("strong")).toEqual({
      timeEvidence: "unknown",
      evidenceConfidence: "unknown",
    });

    const missingBenchmark = projectTournamentEvidenceAuthority(
      rule(),
      candidates.slice(0, 1),
      [profile("strong", 59_000, 60_000)],
      [],
    );
    expect(missingBenchmark.get("strong")).toEqual({
      timeEvidence: "unknown",
      evidenceConfidence: "low",
    });

    const multipleDistances = projectTournamentEvidenceAuthority(
      rule([1_200, 1_400]),
      candidates.slice(0, 1),
      [profile("strong", 59_000, 60_000)],
      [benchmark()],
    );
    expect(multipleDistances.get("strong")).toEqual({
      timeEvidence: "unknown",
      evidenceConfidence: "unknown",
    });
  });

  it("does not publish evidence authority for an ineligible candidate", () => {
    const result = projectTournamentEvidenceAuthority(
      rule(),
      [{ coreId: "ineligible", eligibility: "ineligible" }],
      [profile("ineligible", 59_000, 60_000)],
      [benchmark()],
    );

    expect(result.get("ineligible")).toEqual({
      timeEvidence: "unknown",
      evidenceConfidence: "unknown",
    });
  });

  it("rejects duplicated or inconsistent evidence", () => {
    expect(() =>
      projectTournamentEvidenceAuthority(
        rule(),
        candidates.slice(0, 1),
        [profile("strong", 59_000, 60_000), profile("strong", 59_000, 60_000)],
        [benchmark()],
      ),
    ).toThrow("profile is duplicated");

    expect(() =>
      projectTournamentEvidenceAuthority(
        rule(),
        candidates.slice(0, 1),
        [profile("strong", 59_000, 60_000)],
        [benchmark(), benchmark()],
      ),
    ).toThrow("benchmark is duplicated");

    expect(() =>
      projectTournamentEvidenceAuthority(
        rule(),
        candidates.slice(0, 1),
        [profile("strong", 59_000, 60_000)],
        [benchmark({ winningEntryCount: 400 })],
      ),
    ).toThrow("benchmark is inconsistent");
  });
});
