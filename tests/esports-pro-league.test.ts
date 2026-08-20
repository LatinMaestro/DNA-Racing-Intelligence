import { describe, expect, it } from "vitest";

import {
  esportsProLeagueRosterRequirements,
  prepareEsportsProLeague,
  validateSelectedEsportsRoster,
  type EsportsRosterCandidateInput,
} from "@/domain/esports-pro-league";
import type { Element } from "@/domain/game-rules";

function core(
  id: string,
  element: Element,
  overrides: Partial<EsportsRosterCandidateInput> = {},
): EsportsRosterCandidateInput {
  return {
    coreId: id,
    displayName: `Core ${id}`,
    coreClass: "Morphed",
    element,
    fNumber: 10,
    sex: "male",
    bikeProfiles: [],
    ...overrides,
  };
}

function analyticalBike(distanceMetres = 1_200) {
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

describe("DNA Pro Esports roster preparation", () => {
  it("keeps the published structural rules explicit and the Genesis mint excluded", () => {
    const preparation = prepareEsportsProLeague([
      core("metal-1", "Metal", { coreClass: "Genesis" }),
      core("metal-2", "Metal", { coreClass: "Genesis" }),
      core("metal-3", "Metal"),
      core("fire-1", "Fire"),
      core("earth-1", "Earth"),
      core("water-1", "Water"),
    ]);

    expect(preparation.requirements).toEqual(
      esportsProLeagueRosterRequirements,
    );
    expect(preparation.ownerStrategy).toEqual({
      specialGenesisMintPlanned: false,
      acquisitionStrategy: "existing_vault_plus_breeding",
    });
    expect(preparation.performanceEvidenceStatus).toBe(
      "dna_racing_bike_history_is_prior_only",
    );
    expect(preparation.structuralPoolChecksPass).toBe(false);
    expect(preparation.breedingPlan.genesisMintExcluded).toBe(true);
    expect(
      preparation.elementPools.find(({ element }) => element === "Metal")
        ?.deterministicOffspringElementGuidance,
    ).toContain("Metal × Metal");
  });

  it("identifies non-Genesis depth required by the working two-Genesis-per-element cap", () => {
    const preparation = prepareEsportsProLeague([
      core("m1", "Metal", { coreClass: "Genesis" }),
      core("m2", "Metal", { coreClass: "Genesis" }),
      core("m3", "Metal", { coreClass: "Genesis" }),
      core("m4", "Metal", { coreClass: "Genesis" }),
      core("m5", "Metal", { coreClass: "Morphed" }),
    ]);
    const metal = preparation.elementPools.find(
      ({ element }) => element === "Metal",
    );
    expect(metal).toMatchObject({
      totalOwned: 5,
      nonGenesisOwned: 1,
      rosterFloorGap: 0,
      nonGenesisDepthGap: 2,
      breedingPriority: "critical",
    });
    expect(preparation.selectableCoreCountUnderGenesisCaps).toBe(3);
  });

  it("prioritises targeted Bike Discovery for structurally useful under-tested cores", () => {
    const preparation = prepareEsportsProLeague([
      core("female-f15", "Water", {
        fNumber: 18,
        sex: "female",
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
      core("ready", "Water", { bikeProfiles: analyticalBike() }),
    ]);
    const priority = preparation.discoveryQueue[0]!;
    expect(priority.coreId).toBe("female-f15");
    expect(priority.discoveryPriority).toBe("high");
    expect(priority.discoveryReasons.join(" ")).toContain("Female");
    expect(priority.discoveryReasons.join(" ")).toContain("F15+");
    expect(priority.teamSelectionTier).toBe("bike_prior_developing");
    expect(preparation.teamCandidatePools.Water[0]?.coreId).toBe("ready");
  });

  it("does not turn an evidence-only Bike gap into a breeding shortage", () => {
    const elements: readonly Element[] = ["Metal", "Fire", "Earth", "Water"];
    const pool: EsportsRosterCandidateInput[] = [];
    let sequence = 0;
    for (const element of elements) {
      for (let index = 0; index < 5; index += 1) {
        sequence += 1;
        pool.push(
          core(`${element.toLowerCase()}-${index + 1}`, element, {
            sex: sequence <= 8 ? "female" : "male",
            fNumber: sequence <= 5 ? 15 + sequence : 10,
            bikeProfiles: analyticalBike(1_000 + index * 100),
          }),
        );
      }
    }
    pool.push(
      core("metal-development", "Metal", {
        bikeProfiles: [
          {
            distanceMetres: 1_800,
            raceCount: 3,
            sampleStatus: "hypothesis_only",
            freshness: "current",
            dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          },
        ],
      }),
    );

    const preparation = prepareEsportsProLeague(pool);
    const development = preparation.candidates.find(
      ({ coreId }) => coreId === "metal-development",
    );
    expect(development?.discoveryPriority).toBe("medium");
    expect(
      preparation.elementPools.every(
        ({ breedingPriority }) => breedingPriority === "maintain",
      ),
    ).toBe(true);
  });

  it("validates an exact 25-core roster against element, female, F15 and Genesis constraints", () => {
    const roster: EsportsRosterCandidateInput[] = [];
    const distribution: readonly [Element, number][] = [
      ["Metal", 7],
      ["Fire", 6],
      ["Earth", 6],
      ["Water", 6],
    ];
    let index = 0;
    for (const [element, count] of distribution) {
      for (let elementIndex = 0; elementIndex < count; elementIndex += 1) {
        index += 1;
        roster.push(
          core(`core-${index}`, element, {
            coreClass: elementIndex === 0 ? "Genesis" : "Morphed",
            sex: index <= 10 ? "female" : "male",
            fNumber: index <= 7 ? 15 + index : 10,
          }),
        );
      }
    }

    const validation = validateSelectedEsportsRoster(roster);
    expect(validation.selectedCount).toBe(25);
    expect(validation.femaleCount).toBeGreaterThanOrEqual(8);
    expect(validation.f15PlusCount).toBeGreaterThanOrEqual(5);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("fails a selected roster when a published structural rule is breached", () => {
    const roster = Array.from({ length: 25 }, (_, index) =>
      core(`core-${index + 1}`, index < 20 ? "Metal" : "Fire", {
        coreClass: index < 3 ? "Genesis" : "Morphed",
        sex: "male",
        fNumber: 8,
      }),
    );
    const validation = validateSelectedEsportsRoster(roster);
    expect(validation.valid).toBe(false);
    expect(validation.issues.join(" ")).toContain("Genesis count exceeds");
    expect(validation.issues.join(" ")).toContain("Earth roster count");
    expect(validation.issues.join(" ")).toContain("Female roster count");
    expect(validation.issues.join(" ")).toContain("F15+ roster count");
  });

  it("keeps female breeding requirements non-deterministic while allowing deterministic F15 planning", () => {
    const preparation = prepareEsportsProLeague([
      core("only-core", "Fire", { fNumber: 14, sex: "male" }),
    ]);
    expect(
      preparation.breedingPlan.femaleOutcomeIsNotDeterministicallyTargetable,
    ).toBe(true);
    expect(preparation.breedingPlan.minimumParentFSumForF15Target).toBe(15);
    expect(preparation.breedingPlan.f15BreedingRule).toBe(
      "offspring_f_number_is_parent_sum",
    );
  });
});
