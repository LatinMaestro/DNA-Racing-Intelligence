import { describe, expect, it } from "vitest";

import { scanOwnerVaultOpenRaceOpportunities } from "@/domain/open-race-owner-vault-scanner";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";
import type { DnaOpenLabServingOwnedCore } from "@/lib/neon-dna-open-lab-sync-publication";

const generationId = "11111111-1111-4111-8111-111111111111";
const observedAt = "2026-11-21T07:59:00.000Z";
const hash = "a".repeat(64);

function row<T>(sourceRaceId: string, canonical: T) {
  return {
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: hash,
    canonical,
  } satisfies DnaCurrentRaceMaterializationRow<T>;
}

function active(
  raceId: string,
): DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot> {
  return row(raceId, {
    sourceType: "active_race_snapshot",
    sourceRaceId: raceId,
    status: "open",
    displayName: `Open Horse ${raceId}`,
    mode: "horse",
    format: "normal",
    raceClassSourceValue: 2,
    startAt: null,
    endAt: null,
  });
}

function fill(
  raceId: string,
  entrantCoreIds: readonly string[],
): DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot> {
  return row(raceId, {
    sourceType: "race_fill_snapshot",
    sourceRaceId: raceId,
    status: "open",
    gateCount: 6,
    filledGateCount: entrantCoreIds.length,
    entrantCoreIds,
    entryConfirmationsBySourceKey: {},
  });
}

function document(
  raceId: string,
  entrantCoreIds: readonly string[],
): DnaCurrentRaceMaterializationRow<CanonicalRaceDocumentMetadata> {
  return row(raceId, {
    sourceType: "race_document",
    sourceRaceId: raceId,
    status: "open",
    mode: "horse",
    format: "normal",
    raceClassSourceValue: 2,
    distanceMetres: 1600,
    gateCount: 6,
    filledGateCount: entrantCoreIds.length,
    entrantCoreIds,
  });
}

function ownedCore(sourceCoreId: string): DnaOpenLabServingOwnedCore {
  return {
    generationId,
    observedAt,
    rawEvidenceSha256: hash,
    canonical: {
      sourceType: "core_details",
      sourceCoreId,
      displayName: `Owned ${sourceCoreId}`,
      coreClass: "Freak",
      element: "Water",
      fNumber: 1,
      sex: "female",
      colorSourceValue: null,
      fatherSourceCoreId: null,
      fatherNameSourceValue: null,
      motherSourceCoreId: null,
      motherNameSourceValue: null,
    },
  };
}

const ownedCores = [
  ...Array.from({ length: 213 }, (_, index) => ownedCore(String(index + 1))),
  ownedCore("10457"),
];

function scan(
  overrides: Partial<
    Parameters<typeof scanOwnerVaultOpenRaceOpportunities>[0]
  > = {},
) {
  const openOpponents = ["9001", "9002", "9003"];
  const occupiedByOwner = ["9004", "10457", "9005"];
  return scanOwnerVaultOpenRaceOpportunities({
    evaluatedAt: "2026-11-21T08:00:00.000Z",
    maximumAgeMinutes: 5,
    ownedCores,
    currentRaces: {
      generationId,
      activeRaces: [active("race-open"), active("race-owned")],
      raceFills: [
        fill("race-open", openOpponents),
        fill("race-owned", occupiedByOwner),
      ],
    },
    documents: [
      document("race-open", openOpponents),
      document("race-owned", occupiedByOwner),
    ],
    ...overrides,
  });
}

describe("Open Race scanner complete owner-Vault serving integration", () => {
  it("checks all 214 owned Cores and preserves the qualifying opponent field", () => {
    const result = scan();
    expect(result).toMatchObject({
      ownedCoreCount: 214,
      enteredOpponentCount: 3,
      ownerCoreUniverse: "complete_serving_generation",
      gameEntryAllowed: false,
      scan: {
        opportunities: [
          {
            raceId: "race-open",
            enteredOpponentCoreIds: ["9001", "9002", "9003"],
            rank: "not_evaluated",
            gameEntryAllowed: false,
          },
        ],
        gameEntryAllowed: false,
      },
    });
  });

  it("rejects a field containing any Core from the complete owned set", () => {
    expect(resultReason(scan(), "race-owned")).toBe(
      "owned_core_already_entered",
    );
  });

  it("fails closed on generation mismatch and duplicate owned Cores", () => {
    expect(() =>
      scan({
        ownedCores: [
          {
            ...ownedCores[0]!,
            generationId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      }),
    ).toThrow("does not match races");
    expect(() =>
      scan({ ownedCores: [ownedCore("42"), ownedCore("42")] }),
    ).toThrow("duplicate Cores");
  });

  it("never turns a qualifying advisory race into a recommendation or entry", () => {
    const opportunity = scan().scan.opportunities[0]!;
    expect(opportunity.eligibility).toBe("needs_owner_core_restriction_check");
    expect(opportunity.rank).toBe("not_evaluated");
    expect(opportunity.gameEntryAllowed).toBe(false);
  });
});

function resultReason(result: ReturnType<typeof scan>, raceId: string) {
  return result.scan.excluded.find((item) => item.raceId === raceId)?.reason;
}
