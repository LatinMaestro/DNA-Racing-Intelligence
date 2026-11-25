import { describe, expect, it } from "vitest";

import { scanVerifiedOpenRaceOpportunities } from "@/domain/open-race-live-opportunity-scanner";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";

const time = "2026-11-20T10:00:00.000Z";
const row = <T>(sourceRaceId: string, canonical: T, observedAt = time) => ({
  sourceRaceId,
  observedAt,
  rawEvidenceSha256: "a".repeat(64),
  canonical,
});
const active: CanonicalActiveRaceSnapshot = {
  sourceType: "active_race_snapshot",
  sourceRaceId: "race-1",
  status: "open",
  displayName: "Test qualifying race",
  mode: "horse",
  format: "normal",
  raceClassSourceValue: 2,
  fixedFeesByAsset: { HLX: 5 },
  entryFeeUsd: 5,
  paymentAsset: "HLX",
  startAt: null,
  endAt: null,
};
const fill: CanonicalRaceFillSnapshot = {
  sourceType: "race_fill_snapshot",
  sourceRaceId: "race-1",
  status: "open",
  gateCount: 6,
  filledGateCount: 3,
  entrantCoreIds: ["10", "11", "12"],
  entryConfirmationsBySourceKey: {},
};
const document: CanonicalRaceDocumentMetadata = {
  sourceType: "race_document",
  sourceRaceId: "race-1",
  status: "open",
  mode: "horse",
  format: "normal",
  raceClassSourceValue: 2,
  distanceMetres: 1600,
  gateCount: 6,
  filledGateCount: 3,
  entrantCoreIds: ["10", "11", "12"],
  fixedFeesByAsset: { HLX: 5 },
  entryFeeUsd: 5,
  paymentAsset: "HLX",
  payoutSourceValue: "top two",
  prizeSourceValue: 18,
  prizeUsdSourceValue: 18,
  prizeDistributionSourceValue: { first: 12, second: 6 },
};
function scan(
  overrides: Partial<
    Parameters<typeof scanVerifiedOpenRaceOpportunities>[0]
  > = {},
) {
  return scanVerifiedOpenRaceOpportunities({
    evaluatedAt: time,
    maximumAgeMinutes: 5,
    activeRaces: [row("race-1", active)],
    fills: [row("race-1", fill)],
    documents: [row("race-1", document)],
    ownedCoreIds: ["10457", "42"],
    ...overrides,
  });
}
describe("Open Lab live race opportunity scanner (no game entry)", () => {
  it("identifies only a supported half-full race and preserves opponent identities", () => {
    expect(scan()).toMatchObject({
      opportunities: [
        {
          raceId: "race-1",
          distanceMetres: 1600,
          gateCount: 6,
          vacantGates: 3,
          enteredOpponentCoreIds: ["10", "11", "12"],
          economics: {
            fixedFeesByAsset: {
              value: { HLX: 5 },
              evidenceStatus: "source_supported",
            },
            paymentAsset: {
              value: "HLX",
              evidenceStatus: "source_supported",
            },
            payoutDescription: {
              value: "top two",
              evidenceStatus: "source_supported",
            },
            prize: { value: 18, evidenceStatus: "source_supported" },
          },
          entryLink: null,
          entryLinkEvidenceStatus: "unavailable",
          eligibility: "needs_owner_core_restriction_check",
          rank: "not_evaluated",
          gameEntryAllowed: false,
        },
      ],
      excluded: [],
      gameEntryAllowed: false,
    });
  });
  it("rejects changed fee evidence before recommendation", () => {
    expect(
      scan({
        documents: [
          row("race-1", {
            ...document,
            fixedFeesByAsset: { HLX: 6 },
          }),
        ],
      }).excluded[0]?.reason,
    ).toBe("conflicting_economics");
  });
  it("preserves source-supported economics when only one read operation publishes them", () => {
    const result = scan({
      activeRaces: [
        row("race-1", {
          ...active,
          fixedFeesByAsset: undefined,
          entryFeeUsd: undefined,
          paymentAsset: undefined,
        }),
      ],
    });
    expect(result.opportunities[0]?.economics).toMatchObject({
      fixedFeesByAsset: {
        value: { HLX: 5 },
        evidenceStatus: "source_supported",
      },
      entryFeeUsd: { value: 5, evidenceStatus: "source_supported" },
      paymentAsset: {
        value: "HLX",
        evidenceStatus: "source_supported",
      },
    });
  });
  it("rounds odd gate thresholds upward and rejects underfilled races", () => {
    const three = {
      ...fill,
      gateCount: 5,
      filledGateCount: 2,
      entrantCoreIds: ["10", "11"],
    };
    expect(
      scan({
        fills: [row("race-1", three)],
        documents: [
          row("race-1", {
            ...document,
            gateCount: 5,
            filledGateCount: 2,
            entrantCoreIds: ["10", "11"],
          }),
        ],
      }).excluded[0]?.reason,
    ).toBe("field_not_half_filled");
  });
  it("rejects races containing any owned Core even if a gate remains vacant", () => {
    const three = { ...fill, entrantCoreIds: ["10", "10457", "12"] };
    expect(
      scan({
        fills: [row("race-1", three)],
        documents: [
          row("race-1", {
            ...document,
            entrantCoreIds: three.entrantCoreIds,
          }),
        ],
      }).excluded[0]?.reason,
    ).toBe("owned_core_already_entered");
  });
  it("refuses stale races, closed races, full races, and unknown statuses", () => {
    expect(
      scan({
        activeRaces: [row("race-1", active, "2026-11-20T09:50:00Z")],
      }).excluded[0]?.reason,
    ).toBe("stale_or_invalid_evidence");
    expect(
      scan({
        activeRaces: [row("race-1", { ...active, status: "finished" })],
      }).excluded[0]?.reason,
    ).toBe("not_open");
    expect(
      scan({
        activeRaces: [row("race-1", { ...active, status: "mystery" })],
      }).excluded[0]?.reason,
    ).toBe("not_open");
    const full = {
      ...fill,
      filledGateCount: 6,
      entrantCoreIds: ["10", "11", "12", "13", "14", "15"],
    };
    expect(scan({ fills: [row("race-1", full)] }).excluded[0]?.reason).toBe(
      "field_incomplete_or_full",
    );
  });
  it("rejects missing race detail, distance, conflicting opponent list and fill status", () => {
    const { distanceMetres: omittedDistance, ...documentWithoutDistance } =
      document;
    expect(omittedDistance).toBe(1600);
    expect(scan({ documents: [] }).excluded[0]?.reason).toBe(
      "missing_or_incomplete_document",
    );
    expect(
      scan({
        documents: [row("race-1", documentWithoutDistance)],
      }).excluded[0]?.reason,
    ).toBe("missing_or_incomplete_document");
    expect(
      scan({
        documents: [
          row("race-1", {
            ...document,
            entrantCoreIds: ["10", "12", "11"],
          }),
        ],
      }).excluded[0]?.reason,
    ).toBe("missing_or_incomplete_document");
    expect(
      scan({
        fills: [row("race-1", { ...fill, status: "running" })],
      }).excluded[0]?.reason,
    ).toBe("missing_or_conflicting_fill");
  });
  it("rejects duplicate race IDs and invalid owned-core identities", () => {
    expect(() =>
      scan({
        activeRaces: [row("race-1", active), row("race-1", active)],
      }),
    ).toThrow("duplicate");
    expect(() => scan({ ownedCoreIds: ["10457", "10457"] })).toThrow(
      "owned-Core",
    );
  });
});
