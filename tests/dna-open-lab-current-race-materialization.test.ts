import { describe, expect, it } from "vitest";

import type { DnaCurrentStateCandidate } from "@/lib/dna-open-lab-last-good-publication";
import { createDnaCurrentRaceMaterialization } from "@/lib/dna-open-lab-current-race-materialization";
import {
  adaptDnaActiveRace,
  adaptDnaRaceFill,
  type CanonicalRaceFillSnapshot,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";

function candidate(input?: {
  activeRaceCount?: number;
  raceFillCount?: number;
  partial?: "active_races" | "race_fills";
}): DnaCurrentStateCandidate {
  const candidate: DnaCurrentStateCandidate = {
    generationId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-08-28T01:00:00.000Z",
    families: {
      vault: { status: "complete", itemCount: 1 },
      cores: { status: "complete", itemCount: 2 },
      active_races: {
        status: input?.partial === "active_races" ? "partial" : "complete",
        itemCount: input?.activeRaceCount ?? 2,
      },
      race_fills: {
        status: input?.partial === "race_fills" ? "partial" : "complete",
        itemCount: input?.raceFillCount ?? 2,
      },
      tokens: { status: "complete", itemCount: 1 },
      splice_arena: { status: "complete", itemCount: 0 },
    },
  };
  return candidate;
}

function activeRace(sourceRaceId: string, observedAt: string) {
  return adaptDnaActiveRace({
    observedAt,
    raw: {
      rid: sourceRaceId,
      status: "open",
      race_name: `Synthetic ${sourceRaceId}`,
      format: "NORMAL",
      class: 2,
      cb: null,
      rgate: 6,
      hs_in: 2,
      fee_fixed: { DEZ: 1200 },
      feeusd: 1.25,
      paytoken: "DEZ",
      start_time: null,
      version: 1,
      rvmode: "bike",
    },
  });
}

function raceFill(sourceRaceId: string, observedAt: string) {
  return adaptDnaRaceFill({
    observedAt,
    raw: {
      rid: sourceRaceId,
      status: "open",
      rgate: 6,
      hs_in: 2,
      hids: [101, 202],
      entry_txns_confirmed: { "0": true, "1": false },
    },
  });
}

describe("DNA Open Lab current-race materialization", () => {
  it("creates deterministic generation-bound active-race and fill rows", () => {
    const result = createDnaCurrentRaceMaterialization({
      candidate: candidate(),
      activeRaces: [
        activeRace("race-b", "2026-08-28T00:59:20Z"),
        activeRace("race-a", "2026-08-28T00:59:10Z"),
      ],
      raceFills: [
        raceFill("race-b", "2026-08-28T00:59:40Z"),
        raceFill("race-a", "2026-08-28T00:59:30Z"),
      ],
    });

    expect(result.generationObservedAt).toBe("2026-08-28T01:00:00.000Z");
    expect(result.activeRaces.map((row) => row.sourceRaceId)).toEqual([
      "race-a",
      "race-b",
    ]);
    expect(result.raceFills.map((row) => row.sourceRaceId)).toEqual([
      "race-a",
      "race-b",
    ]);
    expect(result.activeRaces[0]).toMatchObject({
      observedAt: "2026-08-28T00:59:10.000Z",
      canonical: {
        sourceType: "active_race_snapshot",
        sourceRaceId: "race-a",
        mode: "bike",
        startAt: null,
        endAt: null,
      },
    });
    expect(result.activeRaces[0]!.canonical).not.toHaveProperty("distance");
    expect(result.raceFills[0]!.canonical).toMatchObject({
      gateCount: 6,
      filledGateCount: 2,
      entrantCoreIds: ["101", "202"],
    });
  });

  it("requires exact complete-family counts before materialization", () => {
    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ activeRaceCount: 2 }),
        activeRaces: [activeRace("race-a", "2026-08-28T00:59:10Z")],
        raceFills: [
          raceFill("race-a", "2026-08-28T00:59:20Z"),
          raceFill("race-b", "2026-08-28T00:59:30Z"),
        ],
      }),
    ).toThrow("active-race count must match");

    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ partial: "race_fills" }),
        activeRaces: [
          activeRace("race-a", "2026-08-28T00:59:10Z"),
          activeRace("race-b", "2026-08-28T00:59:20Z"),
        ],
        raceFills: [
          raceFill("race-a", "2026-08-28T00:59:30Z"),
          raceFill("race-b", "2026-08-28T00:59:40Z"),
        ],
      }),
    ).toThrow("generation is incomplete: race_fills");
  });

  it("rejects duplicate active IDs and fills outside the active snapshot", () => {
    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate(),
        activeRaces: [
          activeRace("race-a", "2026-08-28T00:59:10Z"),
          activeRace("race-a", "2026-08-28T00:59:20Z"),
        ],
        raceFills: [
          raceFill("race-a", "2026-08-28T00:59:30Z"),
          raceFill("race-a", "2026-08-28T00:59:40Z"),
        ],
      }),
    ).toThrow("active-race materialization contains duplicate race IDs");

    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ activeRaceCount: 1 }),
        activeRaces: [activeRace("race-a", "2026-08-28T00:59:10Z")],
        raceFills: [
          raceFill("race-a", "2026-08-28T00:59:30Z"),
          raceFill("race-b", "2026-08-28T00:59:40Z"),
        ],
      }),
    ).toThrow("race-fill race-b has no active-race observation");
  });

  it("rejects evidence from the wrong endpoint or after the generation", () => {
    const wrongEndpoint = {
      ...raceFill("race-a", "2026-08-28T00:59:30Z"),
      endpoint: "races.docs",
    } as unknown as DnaOpenLabEvidence<CanonicalRaceFillSnapshot>;
    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ activeRaceCount: 1, raceFillCount: 1 }),
        activeRaces: [activeRace("race-a", "2026-08-28T00:59:10Z")],
        raceFills: [wrongEndpoint],
      }),
    ).toThrow("race-fill evidence authority is invalid");

    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ activeRaceCount: 1, raceFillCount: 1 }),
        activeRaces: [activeRace("race-a", "2026-08-28T01:00:01Z")],
        raceFills: [raceFill("race-a", "2026-08-28T00:59:30Z")],
      }),
    ).toThrow("activeRace.observedAt cannot follow");
  });

  it("fails closed if a forged fill no longer matches its gate coverage", () => {
    const original = raceFill("race-a", "2026-08-28T00:59:30Z");
    const forged = {
      ...original,
      canonical: {
        ...original.canonical,
        filledGateCount: 3,
      },
    } as DnaOpenLabEvidence<CanonicalRaceFillSnapshot>;
    expect(() =>
      createDnaCurrentRaceMaterialization({
        candidate: candidate({ activeRaceCount: 1, raceFillCount: 1 }),
        activeRaces: [activeRace("race-a", "2026-08-28T00:59:10Z")],
        raceFills: [forged],
      }),
    ).toThrow("race-fill race-a coverage is invalid");
  });
});
