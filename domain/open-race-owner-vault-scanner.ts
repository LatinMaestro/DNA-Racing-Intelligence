import {
  scanVerifiedOpenRaceOpportunities,
  type OpenRaceScanResult,
} from "@/domain/open-race-live-opportunity-scanner";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabServingCurrentRaces,
  DnaOpenLabServingOwnedCore,
} from "@/lib/neon-dna-open-lab-sync-publication";

const GENERATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type OwnerVaultOpenRaceScan = Readonly<{
  sourceGenerationId: string;
  ownedCoreCount: number;
  enteredOpponentCount: number;
  scan: OpenRaceScanResult;
  ownerCoreUniverse: "complete_serving_generation";
  gameEntryAllowed: false;
}>;

/**
 * Connects the complete owner-scoped serving Vault generation to the ordinary
 * Open Race advisory scanner. The scanner therefore checks every entered field
 * against the whole current owned-Core set rather than a caller-selected
 * subset. Generation mismatch, duplicate ownership or an empty Vault fails
 * closed before any race is evaluated.
 */
export function scanOwnerVaultOpenRaceOpportunities(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    ownedCores: readonly DnaOpenLabServingOwnedCore[];
    currentRaces: DnaOpenLabServingCurrentRaces;
    documents: readonly DnaCurrentRaceMaterializationRow<CanonicalRaceDocumentMetadata>[];
  }>,
): OwnerVaultOpenRaceScan {
  const generationId = input.currentRaces.generationId;
  if (generationId === null || !GENERATION_ID.test(generationId)) {
    throw new Error("Open Race owner-Vault generation is unavailable.");
  }
  if (input.ownedCores.length < 1 || input.ownedCores.length > 10_000) {
    throw new Error("Open Race owner-Vault serving set is unavailable.");
  }
  const ownedCoreIds = input.ownedCores.map((row) => {
    if (row.generationId !== generationId) {
      throw new Error("Open Race owner-Vault generation does not match races.");
    }
    return row.canonical.sourceCoreId;
  });
  if (new Set(ownedCoreIds).size !== ownedCoreIds.length) {
    throw new Error(
      "Open Race owner-Vault serving set contains duplicate Cores.",
    );
  }

  const scan = scanVerifiedOpenRaceOpportunities({
    evaluatedAt: input.evaluatedAt,
    maximumAgeMinutes: input.maximumAgeMinutes,
    activeRaces: input.currentRaces.activeRaces,
    fills: input.currentRaces.raceFills,
    documents: input.documents,
    ownedCoreIds,
  });
  return Object.freeze({
    sourceGenerationId: generationId,
    ownedCoreCount: ownedCoreIds.length,
    enteredOpponentCount: scan.opportunities.reduce(
      (count, opportunity) => count + opportunity.enteredOpponentCoreIds.length,
      0,
    ),
    scan,
    ownerCoreUniverse: "complete_serving_generation",
    gameEntryAllowed: false,
  });
}
