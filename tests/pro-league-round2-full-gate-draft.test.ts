import { describe, expect, it } from "vitest";

import { proLeagueMaps } from "@/domain/pro-league-maps";
import {
  buildRound2FullGateDraft,
  type Round2VerifiedCandidate,
} from "@/domain/pro-league-round2-full-gate-draft";

const now = "2026-09-23T09:44:57.874Z";

function candidates(): Extract<
  Round2VerifiedCandidate,
  { bikeAgeingBalance: number }
>[] {
  const cells = [
    ...new Map(
      proLeagueMaps.flatMap((map) =>
        map.races.map(
          (race) =>
            [
              JSON.stringify([
                race.raceType,
                race.distanceMetres,
                race.totalGateEntries,
              ]),
              race,
            ] as const,
        ),
      ),
    ).values(),
  ].map((race) => ({
    raceType: race.raceType,
    distanceMetres: race.distanceMetres,
    gateCount: race.totalGateEntries,
    scoring: race.raceType.toLowerCase().includes("madness")
      ? ("podium_majority" as const)
      : ("wta_win" as const),
    sampleCount: 20,
    recentSampleCount: 10,
    officialRaceCount: 20,
    medianMilliseconds: 50000,
    standardDeviationMilliseconds: 200,
    status: "elite_range" as const,
    distanceOnlyProjection: true as const,
  }));
  return Array.from({ length: 25 }, (_, index) => ({
    core: {
      coreId: String(100 + index),
      displayName: `Owned ${index + 1}`,
      element:
        index < 7
          ? ("Metal" as const)
          : index < 15
            ? ("Fire" as const)
            : ("Earth" as const),
      coreClass: "Morphed" as const,
      sex: index < 8 ? ("female" as const) : ("male" as const),
      fNumber: 16,
      inMyVault: true,
    },
    bikeAgeingBalance: 900,
    bikeAgeingObservedAt: now,
    completeOwnedBikeHistory: true as const,
    cells,
  }));
}

describe("Round 2 full-gate advisory draft", () => {
  it("fills all 168 lines and every unique owner gate from 25 legal elite Cores", () => {
    const draft = buildRound2FullGateDraft({
      roster: candidates(),
      currentThrough: now,
    });
    expect(draft.substitutionsUsed).toBe(0);
    expect(draft.rosterCoreIds).toHaveLength(25);
    expect(draft.lines).toHaveLength(168);
    expect(draft.lines.filter(({ first16 }) => first16)).toHaveLength(64);
    expect(draft.provisionalLineCount).toBe(0);
    for (const map of proLeagueMaps) {
      for (const race of map.races) {
        const line = draft.lines.find(
          (entry) =>
            entry.mapId === map.mapId && entry.raceNumber === race.raceNumber,
        )!;
        expect(line.coreIds).toHaveLength(race.gateEntriesPerVault);
        expect(new Set(line.coreIds).size).toBe(race.gateEntriesPerVault);
      }
    }
  });

  it("refuses stale or over-aged evidence, Reese Dylan and non-elite roster members", () => {
    const roster = candidates();
    const run = (member: Round2VerifiedCandidate) =>
      buildRound2FullGateDraft({
        roster: [member, ...roster.slice(1)],
        currentThrough: now,
      });
    expect(() => run({ ...roster[0]!, bikeAgeingBalance: 624 })).toThrow(
      "ageing limit",
    );
    expect(() =>
      run({ ...roster[0]!, bikeAgeingObservedAt: "2026-09-18T00:00:00.000Z" }),
    ).toThrow("current");
    expect(() =>
      run({
        ...roster[0]!,
        core: { ...roster[0]!.core, displayName: "Reese Dylan" },
      }),
    ).toThrow("excluded");
    expect(() =>
      run({
        ...roster[0]!,
        cells: roster[0]!.cells.map((cell) => ({
          ...cell,
          status: "positive_range" as const,
        })),
      }),
    ).toThrow("elite-range");
    expect(() =>
      run({
        ...roster[0]!,
        cells: roster[0]!.cells.map((cell) => ({ ...cell, sampleCount: 1 })),
      }),
    ).toThrow("repeated current pace");
  });

  it("identifies provisional gate deficits while keeping all assignments legal", () => {
    const roster = candidates().map((candidate) => ({
      ...candidate,
      cells: candidate.cells.map((cell) =>
        cell.distanceMetres === 1000 && cell.raceType === "1v1"
          ? { ...cell, status: "provisional" as const }
          : cell,
      ),
    }));
    const draft = buildRound2FullGateDraft({ roster, currentThrough: now });
    expect(draft.provisionalLineCount).toBeGreaterThan(0);
    expect(
      draft.mapCapability.some(
        ({ first16ProvisionalGaps }) => first16ProvisionalGaps > 0,
      ),
    ).toBe(true);
    expect(draft.lines).toHaveLength(168);
  });

  it("accepts a current connected Bike ageing band conservatively without inventing a balance", () => {
    const roster = candidates();
    const first = roster[0]!;
    const band: Round2VerifiedCandidate = {
      core: first.core,
      bikeAgeingObservedAt: first.bikeAgeingObservedAt,
      completeOwnedBikeHistory: true,
      cells: first.cells,
      verifiedBikeAgeingUsedUpperBound: 400,
      bikeAgeingProofSource: "connected_owner_bike_balance",
    };
    expect(
      buildRound2FullGateDraft({
        roster: [band, ...roster.slice(1)],
        currentThrough: now,
      }).lines,
    ).toHaveLength(168);
    expect(() =>
      buildRound2FullGateDraft({
        roster: [
          { ...band, verifiedBikeAgeingUsedUpperBound: 401 as 400 },
          ...roster.slice(1),
        ],
        currentThrough: now,
      }),
    ).toThrow("band authority");
    expect(() =>
      buildRound2FullGateDraft({
        roster: [
          { ...band, bikeAgeingObservedAt: "2026-09-19T00:00:00.000Z" },
          ...roster.slice(1),
        ],
        currentThrough: now,
      }),
    ).toThrow("current");
  });
});
