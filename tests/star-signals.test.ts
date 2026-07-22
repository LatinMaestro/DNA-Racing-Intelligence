import { describe, expect, it } from "vitest";
import { isGoldStarEligible } from "@/domain/game-rules";
import {
  isNegativeGoldOpportunity,
  normalizeStarValue,
  refreshStarProfiles,
  validateEventStarAssignments,
  validateEventStars,
} from "@/domain/star-signals";

const completeEntry = (
  coreId: string,
  goldStar: boolean | null,
  blueStar: boolean | null,
) => ({ coreId, goldStar, blueStar, starDataStatus: "complete" as const });

describe("Gold and Blue signal foundations", () => {
  it.each([1, 2, 3])("marks %i gates as Gold-ineligible", (gateCount) => {
    expect(isGoldStarEligible(gateCount)).toBe(false);
  });

  it("marks more than three gates as Gold-eligible", () => {
    expect(isGoldStarEligible(4)).toBe(true);
  });

  it("keeps false distinct from missing and invalid source values", () => {
    expect(normalizeStarValue("FALSE")).toMatchObject({
      value: false,
      status: "complete",
    });
    expect(normalizeStarValue("")).toMatchObject({
      value: null,
      status: "missing",
    });
    expect(normalizeStarValue("not-known")).toMatchObject({
      value: null,
      status: "invalid",
    });
  });

  it("retains and flags a source Gold assignment in an ineligible event", () => {
    expect(
      validateEventStars(3, [completeEntry("synthetic-1", true, false)]),
    ).toContain("GOLD_INELIGIBLE_ASSIGNMENT");
  });

  it("surfaces multiple assignments and supports the same core receiving both", () => {
    expect(
      validateEventStars(6, [completeEntry("synthetic-1", true, true)]),
    ).toEqual([]);
    expect(
      validateEventStars(6, [
        completeEntry("synthetic-1", true, false),
        completeEntry("synthetic-2", true, true),
      ]),
    ).toContain("MULTIPLE_GOLD_ASSIGNMENTS");
  });

  it("never treats an ineligible or unassigned event as negative Gold evidence", () => {
    expect(
      isNegativeGoldOpportunity({
        gateCount: 3,
        eventAssignedGold: true,
        entryGoldStar: false,
      }),
    ).toBe(false);
    expect(
      isNegativeGoldOpportunity({
        gateCount: 6,
        eventAssignedGold: false,
        entryGoldStar: false,
      }),
    ).toBe(false);
    expect(
      isNegativeGoldOpportunity({
        gateCount: 6,
        eventAssignedGold: true,
        entryGoldStar: false,
      }),
    ).toBe(true);
  });

  it("preserves ambiguous assignments without selecting a false winner", () => {
    expect(
      validateEventStarAssignments(6, [
        completeEntry("synthetic-b", true, false),
        completeEntry("synthetic-a", true, true),
      ]),
    ).toMatchObject({
      goldAssignedCoreIds: ["synthetic-a", "synthetic-b"],
      uniqueGoldCoreId: null,
      goldAssignmentOpportunity: false,
      uniqueBlueCoreId: "synthetic-a",
      blueAssignmentOpportunity: true,
      status: "invalid",
      warningCodes: ["MULTIPLE_GOLD_ASSIGNMENTS"],
    });
  });

  it("excludes only the incomplete signal from assignment denominators", () => {
    expect(
      validateEventStarAssignments(8, [
        completeEntry("synthetic-a", true, false),
        {
          coreId: "synthetic-b",
          goldStar: null,
          blueStar: false,
          starDataStatus: "partial",
        },
      ]),
    ).toMatchObject({
      goldAssignmentCount: 1,
      goldAssignmentOpportunity: false,
      blueAssignmentOpportunity: false,
      status: "warning",
      warningCodes: ["INCOMPLETE_STAR_DATA"],
    });

    expect(
      validateEventStarAssignments(8, [
        {
          coreId: "synthetic-a",
          goldStar: null,
          blueStar: true,
          starDataStatus: "partial",
        },
        completeEntry("synthetic-b", false, false),
      ]),
    ).toMatchObject({
      goldAssignmentOpportunity: false,
      blueAssignmentOpportunity: true,
      goldDataCounts: { complete: 1, missing: 1, invalid: 0 },
      blueDataCounts: { complete: 2, missing: 0, invalid: 0 },
    });
  });

  it("refreshes exact mode-distance profiles with explicit denominators", () => {
    const refresh = refreshStarProfiles([
      {
        eventId: "event-eligible-assigned",
        eventAt: "2026-07-22T01:00:00Z",
        mode: "bike",
        distance: 1000,
        gateCount: 6,
        entries: [
          completeEntry("core-a", true, false),
          completeEntry("core-b", false, true),
        ],
      },
      {
        eventId: "event-ineligible-anomaly",
        eventAt: "2026-07-22T02:00:00Z",
        mode: "bike",
        distance: 1000,
        gateCount: 3,
        entries: [
          completeEntry("core-a", true, false),
          completeEntry("core-b", false, false),
        ],
      },
      {
        eventId: "event-no-assignment",
        eventAt: "2026-07-22T03:00:00Z",
        mode: "bike",
        distance: 1000,
        gateCount: 6,
        entries: [
          completeEntry("core-a", false, false),
          completeEntry("core-b", false, false),
        ],
      },
      {
        eventId: "event-other-distance",
        eventAt: "2026-07-22T04:00:00Z",
        mode: "bike",
        distance: 2000,
        gateCount: 6,
        entries: [
          completeEntry("core-a", true, true),
          completeEntry("core-b", false, false),
        ],
      },
    ]);

    expect(refresh.profiles).toHaveLength(4);
    expect(
      refresh.profiles.find(
        ({ coreId, mode, distance }) =>
          coreId === "core-a" && mode === "bike" && distance === 1000,
      ),
    ).toMatchObject({
      dataCurrentThrough: "2026-07-22T03:00:00Z",
      raceCount: 3,
      goldEligibleRaceCount: 2,
      goldAssignmentOpportunityCount: 1,
      goldReceivedCount: 1,
      goldNegativeOpportunityCount: 0,
      goldEligibleNoAssignmentCount: 1,
      goldIneligibleAssignmentCount: 1,
      goldReceivedRate: { numerator: 1, denominator: 1 },
      blueAssignmentOpportunityCount: 1,
      blueReceivedCount: 0,
      blueNegativeOpportunityCount: 1,
      blueNoAssignmentCount: 2,
    });
    expect(
      refresh.profiles.find(
        ({ coreId, distance }) => coreId === "core-b" && distance === 1000,
      ),
    ).toMatchObject({
      goldAssignmentOpportunityCount: 1,
      goldReceivedCount: 0,
      goldNegativeOpportunityCount: 1,
      blueReceivedCount: 1,
    });
    expect(
      refresh.profiles.find(
        ({ coreId, distance }) => coreId === "core-a" && distance === 2000,
      ),
    ).toMatchObject({
      raceCount: 1,
      sameCoreReceivedBothCount: 1,
    });
  });

  it("is deterministic across replay and input ordering", () => {
    const events = [
      {
        eventId: "event-b",
        eventAt: "2026-07-22T02:00:00Z",
        mode: "horse" as const,
        distance: 800,
        gateCount: 4,
        entries: [completeEntry("core-b", false, true)],
      },
      {
        eventId: "event-a",
        eventAt: "2026-07-22T01:00:00Z",
        mode: "horse" as const,
        distance: 800,
        gateCount: 4,
        entries: [completeEntry("core-b", true, false)],
      },
    ];

    expect(refreshStarProfiles(events)).toEqual(
      refreshStarProfiles([...events].reverse()),
    );
    expect(() => refreshStarProfiles([events[0]!, events[0]!])).toThrow(
      "Duplicate event in star-profile refresh",
    );
  });
});
