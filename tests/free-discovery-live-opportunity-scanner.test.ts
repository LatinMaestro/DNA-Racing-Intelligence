import { describe, expect, it } from "vitest";

import {
  scanFreeDiscoveryLiveOpportunities,
  type FreeDiscoveryLiveScanExclusion,
} from "@/domain/free-discovery-live-opportunity-scanner";
import type { FreeDiscoveryCampaignCell } from "@/domain/race-entry-bot";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";

const observedAt = "2026-11-21T02:59:00.000Z";
const hash = "a".repeat(64);

const campaign: FreeDiscoveryCampaignCell = {
  campaignId: "horse-free-1600",
  cellId: "10457-horse-1600",
  selectedCoreId: "10457",
  mode: "horse",
  distanceMetres: 1600,
  raceClassSourceValue: 90,
  gateCount: 4,
  format: "normal",
  targetNewRaces: 5,
  reconciledCompletedNewRaces: 1,
  reservedOrSubmittedNewRaces: 1,
  pairing: { status: "single_core" },
};

function row<T>(sourceRaceId: string, canonical: T) {
  return {
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: hash,
    canonical,
  } satisfies DnaCurrentRaceMaterializationRow<T>;
}

function active(
  raceId = "race-free-1",
  displayName = "Free Horse",
): DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot> {
  return row(raceId, {
    sourceType: "active_race_snapshot",
    sourceRaceId: raceId,
    status: "open",
    displayName,
    mode: "horse",
    format: "normal",
    raceClassSourceValue: 90,
    startAt: null,
    endAt: null,
  });
}

function fill(
  raceId = "race-free-1",
): DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot> {
  return row(raceId, {
    sourceType: "race_fill_snapshot",
    sourceRaceId: raceId,
    status: "open",
    gateCount: 4,
    filledGateCount: 1,
    entrantCoreIds: ["9001"],
    entryConfirmationsBySourceKey: { "9001": true },
  });
}

function document(
  raceId = "race-free-1",
): DnaCurrentRaceMaterializationRow<CanonicalRaceDocumentMetadata> {
  return row(raceId, {
    sourceType: "race_document",
    sourceRaceId: raceId,
    status: "open",
    displayName: "Free Horse",
    mode: "horse",
    format: "normal",
    raceClassSourceValue: 90,
    distanceMetres: 1600,
    gateCount: 4,
    filledGateCount: 1,
    entrantCoreIds: ["9001"],
  });
}

function scan(input: {
  activeRaces?: ReturnType<typeof active>[];
  fills?: ReturnType<typeof fill>[];
  documents?: ReturnType<typeof document>[];
}) {
  return scanFreeDiscoveryLiveOpportunities({
    evaluatedAt: "2026-11-21T03:00:00.000Z",
    maximumAgeMinutes: 5,
    campaign,
    currentOwnedCoreIds: ["10457", "42"],
    activeRaces: input.activeRaces ?? [active()],
    fills: input.fills ?? [fill()],
    documents: input.documents ?? [document()],
  });
}

describe("Free Discovery canonical Open Lab scanner integration", () => {
  it("passes a one-of-four authoritative Free race without the ordinary half-filled rule", () => {
    const result = scan({});
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({
      raceId: "race-free-1",
      plannedOwnedCoreIds: ["10457"],
      enteredOpponentCoreIds: ["9001"],
      vacantGates: 3,
      raceTypeSourceValue: "Free",
      queueStatus: "not_queued",
      gameEntryAllowed: false,
    });
    expect(result.newRaceBudgetRemaining).toBe(3);
    expect(result.queueAllowed).toBe(false);
    expect(result.gameEntryAllowed).toBe(false);
  });

  it("uses the accepted standalone race-name token and never zero fee inference", () => {
    const result = scan({
      activeRaces: [active("race-free-1", "Freedom Cup")],
    });
    expect(result.opportunities).toEqual([]);
    expect(result.excluded).toContainEqual({
      raceId: "race-free-1",
      reason: "not_authoritative_standalone_free",
    });
  });

  it("fails closed when fill or hydrated document evidence is missing", () => {
    expect(scan({ fills: [] }).excluded).toContainEqual({
      raceId: "race-free-1",
      reason:
        "missing_or_conflicting_fill" satisfies FreeDiscoveryLiveScanExclusion,
    });
    expect(scan({ documents: [] }).excluded).toContainEqual({
      raceId: "race-free-1",
      reason:
        "missing_or_incomplete_document" satisfies FreeDiscoveryLiveScanExclusion,
    });
  });

  it("rejects a document whose field no longer matches the current fill", () => {
    const mismatched = {
      ...document(),
      canonical: {
        ...document().canonical,
        filledGateCount: 2,
        entrantCoreIds: ["9001", "9002"],
      },
    };
    expect(scan({ documents: [mismatched] }).excluded[0]?.reason).toBe(
      "missing_or_incomplete_document",
    );
  });

  it("preserves the campaign selector and current owned-Core guard", () => {
    const wrongDistance = {
      ...document(),
      canonical: { ...document().canonical, distanceMetres: 1800 },
    };
    expect(scan({ documents: [wrongDistance] }).excluded[0]?.reason).toBe(
      "campaign_selector_mismatch",
    );

    const ownedFill = {
      ...fill(),
      canonical: {
        ...fill().canonical,
        entrantCoreIds: ["10457"],
      },
    };
    const ownedDocument = {
      ...document(),
      canonical: {
        ...document().canonical,
        entrantCoreIds: ["10457"],
      },
    };
    expect(
      scan({ fills: [ownedFill], documents: [ownedDocument] }).excluded[0]
        ?.reason,
    ).toBe("owned_core_already_entered");
  });
});
