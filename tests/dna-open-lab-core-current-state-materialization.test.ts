import { describe, expect, it } from "vitest";

import {
  createDnaSupplementalCoreMaterialization,
  type DnaSupplementalCoreMaterialization,
} from "@/lib/dna-open-lab-core-current-state-materialization";
import type { DnaCurrentStateCandidate } from "@/lib/dna-open-lab-last-good-publication";
import {
  adaptDnaCoreAttachedAssets,
  adaptDnaCoreListingPrice,
  adaptDnaCoreOwner,
  adaptDnaCorePower,
  adaptDnaCoreRacingStats,
  adaptDnaCoreSplicingInfo,
  adaptDnaCoreStamina,
  type CanonicalCorePowerSnapshot,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";

const GENERATION_AT = "2026-08-28T06:00:00.000Z";
const OBSERVED_AT = "2026-08-28T05:59:00.000Z";

function candidate(
  input: { coreCount?: number; partialCores?: boolean } = {},
): DnaCurrentStateCandidate {
  return {
    generationId: "11111111-1111-4111-8111-111111111111",
    observedAt: GENERATION_AT,
    families: {
      vault: { status: "complete", itemCount: 1 },
      cores: {
        status: input.partialCores === true ? "partial" : "complete",
        itemCount: input.coreCount ?? 2,
      },
      active_races: { status: "complete", itemCount: 0 },
      race_fills: { status: "complete", itemCount: 0 },
      tokens: { status: "complete", itemCount: 1 },
      splice_arena: { status: "complete", itemCount: 0 },
    },
  };
}

function coreBundle(sourceCoreId: number, observedAt = OBSERVED_AT) {
  return {
    racingStats: adaptDnaCoreRacingStats({
      observedAt,
      raw: {
        hid: sourceCoreId,
        hstats_bike: { starts: sourceCoreId },
        hstats_car: null,
        hstats_horse: null,
        ageing: null,
        is_maiden: false,
        tourney_profits: null,
      },
    }),
    power: adaptDnaCorePower({
      observedAt,
      raw: {
        hid: sourceCoreId,
        power: {
          bike: { power: 80, adjodds: 2, variance: 0.1, races_n: 5 },
          car: { power: null, adjodds: null, variance: null, races_n: 0 },
          horse: { power: null, adjodds: null, variance: null, races_n: 0 },
        },
        m_stats: null,
      },
    }),
    listing: adaptDnaCoreListingPrice({
      observedAt,
      raw: { hid: sourceCoreId },
    }),
    attachedAssets: adaptDnaCoreAttachedAssets({
      observedAt,
      raw: {
        hid: sourceCoreId,
        skino: { bike: null, car: null, horse: null },
        trailsmap: null,
      },
    }),
    owner: adaptDnaCoreOwner({
      observedAt,
      raw: { hid: sourceCoreId, vault: "0xsynthetic" },
    }),
    stamina: adaptDnaCoreStamina({
      observedAt,
      raw: {
        hid: sourceCoreId,
        stamina: {
          stamina: 4,
          max_stamina: 10,
          next_refill: null,
          last_event: null,
        },
        spstamina: null,
      },
    }),
    splicing: adaptDnaCoreSplicingInfo({
      observedAt,
      raw: {
        hid: sourceCoreId,
        parents: null,
        grand_parents: null,
        challenge_credit: 0,
        splice_core: null,
      },
    }),
  };
}

type MaterializationInput = Parameters<
  typeof createDnaSupplementalCoreMaterialization
>[0];

function materializationInput(): MaterializationInput {
  const first = coreBundle(101);
  const second = coreBundle(202, "2026-08-28T05:59:30Z");
  return {
    candidate: candidate(),
    sourceCoreIds: ["202", "101"],
    racingStats: [second.racingStats, first.racingStats],
    power: [second.power, first.power],
    listings: [second.listing, first.listing],
    attachedAssets: [second.attachedAssets, first.attachedAssets],
    owners: [second.owner, first.owner],
    stamina: [second.stamina, first.stamina],
    splicing: [second.splicing, first.splicing],
  };
}

describe("DNA Open Lab supplemental Core materialization", () => {
  it("creates one deterministic complete generation across all seven families", () => {
    const result = createDnaSupplementalCoreMaterialization(
      materializationInput(),
    );

    expect(result).toMatchObject({
      generationId: "11111111-1111-4111-8111-111111111111",
      generationObservedAt: GENERATION_AT,
      sourceCoreIds: ["101", "202"],
    });
    const families: readonly (keyof Pick<
      DnaSupplementalCoreMaterialization,
      | "racingStats"
      | "power"
      | "listings"
      | "attachedAssets"
      | "owners"
      | "stamina"
      | "splicing"
    >)[] = [
      "racingStats",
      "power",
      "listings",
      "attachedAssets",
      "owners",
      "stamina",
      "splicing",
    ];
    for (const family of families) {
      expect(result[family].map((row) => row.sourceCoreId)).toEqual([
        "101",
        "202",
      ]);
      expect(result[family][0]!.rawEvidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(result.power[0]).toMatchObject({
      observedAt: OBSERVED_AT,
      canonical: {
        sourceType: "core_power_snapshot",
        byMode: {
          bike: {
            powerSourceValue: 80,
            adjustedOddsSourceValue: 2,
            varianceSourceValue: 0.1,
            raceCount: 5,
          },
        },
      },
    });
    expect(result.power[0]!.canonical).not.toHaveProperty("rankingScore");
  });

  it("rejects any supplemental family that does not cover the complete owned-Core set", () => {
    const missing = materializationInput();
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...missing,
        stamina: missing.stamina.slice(0, 1),
      }),
    ).toThrow("stamina count must match the complete owned-Core set");

    const wrongCore = coreBundle(303);
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...missing,
        power: [missing.power[0]!, wrongCore.power],
      }),
    ).toThrow("power must cover every owned Core exactly once");
  });

  it("rejects duplicate owned IDs and a count that disagrees with the Core receipt", () => {
    const input = materializationInput();
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        sourceCoreIds: ["101", "101"],
      }),
    ).toThrow("owned Core IDs must be unique");

    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        candidate: candidate({ coreCount: 3 }),
      }),
    ).toThrow("owned Core IDs must match the complete Core family receipt");
  });

  it("rejects incomplete generations and observations after the generation cutoff", () => {
    const input = materializationInput();
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        candidate: candidate({ partialCores: true }),
      }),
    ).toThrow("generation is incomplete: cores");

    const late = coreBundle(202, "2026-08-28T06:00:01Z");
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        owners: [input.owners[1]!, late.owner],
      }),
    ).toThrow("owner observation cannot follow its generation");
  });

  it("rejects forged endpoint authority, entity keys and checksums", () => {
    const input = materializationInput();
    const wrongEndpoint = {
      ...input.power[0],
      endpoint: "cores.racing_stats",
    } as DnaOpenLabEvidence<CanonicalCorePowerSnapshot>;
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        power: [wrongEndpoint, input.power[1]!],
      }),
    ).toThrow("power evidence authority is invalid");

    const wrongEntity = {
      ...input.power[0],
      entityKey: "core:999",
    } as DnaOpenLabEvidence<CanonicalCorePowerSnapshot>;
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        power: [wrongEntity, input.power[1]!],
      }),
    ).toThrow("power entity key is invalid");

    const wrongChecksum = {
      ...input.power[0],
      rawEvidenceSha256: "not-a-checksum",
    } as DnaOpenLabEvidence<CanonicalCorePowerSnapshot>;
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        power: [wrongChecksum, input.power[1]!],
      }),
    ).toThrow("power.rawEvidenceSha256 must be a lowercase SHA-256");
  });

  it("rejects non-canonical numeric Core identity text", () => {
    const input = materializationInput();
    expect(() =>
      createDnaSupplementalCoreMaterialization({
        ...input,
        sourceCoreIds: ["0101", "202"],
      }),
    ).toThrow("sourceCoreId must be a canonical positive integer");
  });
});
