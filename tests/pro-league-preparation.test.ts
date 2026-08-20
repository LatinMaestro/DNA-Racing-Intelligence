import { describe, expect, it } from "vitest";

import {
  buildProLeaguePreparation,
  type ProLeaguePreparationCore,
} from "@/domain/pro-league-preparation";
import type { Element } from "@/domain/game-rules";

function core(
  id: string,
  element: Element,
  overrides: Partial<ProLeaguePreparationCore> = {},
): ProLeaguePreparationCore {
  return {
    coreId: id,
    displayName: id,
    coreClass: "Morphed",
    element,
    sex: "male",
    fNumber: 10,
    bikeProfiles: [],
    ...overrides,
  };
}

function bike(distanceMetres = 1_200) {
  return [
    {
      distanceMetres,
      raceCount: 10,
      sampleStatus: "minimally_analytical" as const,
      freshness: "current" as const,
      dataCurrentThrough: "2026-08-19T00:00:00.000Z",
    },
  ];
}

describe("Pro League preparation", () => {
  it("excludes the mint and separates DNA Racing Bike evidence from Esports performance", () => {
    const result = buildProLeaguePreparation([core("m1", "Metal")]);
    expect(result.mintStrategy).toBe("no_additional_genesis_mint");
    expect(result.dnaRacingBikeEvidenceStatus).toBe(
      "prior_only_not_esports_performance",
    );
    expect(result.genesisInterpretationStatus).toBe("working_interpretation");
  });

  it("detects non-Genesis depth needed under the provisional per-element Genesis cap", () => {
    const result = buildProLeaguePreparation([
      core("m1", "Metal", { coreClass: "Genesis" }),
      core("m2", "Metal", { coreClass: "Genesis" }),
      core("m3", "Metal", { coreClass: "Genesis" }),
      core("m4", "Metal", { coreClass: "Genesis" }),
      core("m5", "Metal"),
    ]);
    const metal = result.elements.find(({ element }) => element === "Metal");
    expect(metal).toMatchObject({
      rosterFloorGap: 0,
      nonGenesisDepthGap: 2,
      breedingPriority: "critical",
    });
    expect(result.selectableUnderGenesisCaps).toBe(3);
  });

  it("uses under-tested scarce-role cores for Discovery while ranking Bike-ready cores first for team review", () => {
    const result = buildProLeaguePreparation([
      core("development", "Water", {
        sex: "female",
        fNumber: 18,
        bikeProfiles: [
          {
            distanceMetres: 1_400,
            raceCount: 4,
            sampleStatus: "hypothesis_only",
            freshness: "ageing",
            dataCurrentThrough: "2026-08-15T00:00:00.000Z",
          },
        ],
      }),
      core("ready", "Water", { bikeProfiles: bike() }),
    ]);
    expect(result.discoveryQueue[0]).toMatchObject({
      coreId: "development",
      discoveryPriority: "high",
      bikePriorStatus: "developing",
    });
    expect(result.teamCandidatePools.Water[0]?.coreId).toBe("ready");
  });

  it("does not breed merely because an otherwise adequate pool needs more Bike testing", () => {
    const elements: readonly Element[] = ["Metal", "Fire", "Earth", "Water"];
    const pool: ProLeaguePreparationCore[] = [];
    let sequence = 0;
    for (const element of elements) {
      for (let index = 0; index < 5; index += 1) {
        sequence += 1;
        pool.push(
          core(`${element}-${index}`, element, {
            sex: sequence <= 8 ? "female" : "male",
            fNumber: sequence <= 5 ? 15 + sequence : 10,
            bikeProfiles: index < 4 ? bike(1_000 + index * 100) : [],
          }),
        );
      }
    }
    const result = buildProLeaguePreparation(pool);
    expect(
      result.elements.every(
        ({ breedingPriority }) => breedingPriority === "maintain",
      ),
    ).toBe(true);
    expect(
      result.elements.every(({ bikePriorDepthGap }) => bikePriorDepthGap === 1),
    ).toBe(true);
  });

  it("keeps female outcomes non-targetable and uses the confirmed parent-sum threshold for F15+", () => {
    const result = buildProLeaguePreparation([core("one", "Fire")]);
    expect(result.breeding.femaleOutcomeTargetable).toBe(false);
    expect(result.breeding.minimumParentFSumForF15).toBe(15);
    expect(result.breeding.genesisMintExcluded).toBe(true);
  });
});
