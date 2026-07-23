import { describe, expect, it } from "vitest";

import {
  buildStarConversionDiagnostics,
  type StarConversionObservation,
} from "../domain/star-conversion-diagnostics";

function observation(
  eventId: string,
  goldFinish: number | null,
  blueFinish: number | null,
  overrides: Partial<StarConversionObservation> = {},
): StarConversionObservation {
  return {
    eventId,
    eventAt: "2026-07-10T10:00:00Z",
    starObservedAt: "2026-07-10T09:59:00Z",
    resultRecordedAt: "2026-07-10T10:05:00Z",
    mode: "bike",
    distanceMeters: 1000,
    gateCount: 6,
    eraId: "era-1",
    starDataStatus: "complete",
    gold:
      goldFinish === null
        ? { status: "not_assigned", assignedCoreFinishPosition: null }
        : { status: "assigned", assignedCoreFinishPosition: goldFinish },
    blue:
      blueFinish === null
        ? { status: "not_assigned", assignedCoreFinishPosition: null }
        : { status: "assigned", assignedCoreFinishPosition: blueFinish },
    ...overrides,
  };
}

describe("Gold and Blue conversion diagnostics", () => {
  it("reports Gold top-three and Blue win conversion with exact denominators", () => {
    const report = buildStarConversionDiagnostics(
      [observation("one", 2, 1), observation("two", 4, 3)],
      { minimumAssignedEvents: 2, evidenceSource: "historical_holdout" },
    );
    expect(report.overall).toMatchObject({
      eventCount: 2,
      goldTopThree: {
        assignedCount: 2,
        convertedCount: 1,
        rate: 0.5,
        evidenceStatus: "descriptive_ready",
      },
      blueWin: {
        assignedCount: 2,
        convertedCount: 1,
        rate: 0.5,
      },
      blueTopThree: {
        assignedCount: 2,
        convertedCount: 2,
        rate: 1,
      },
      interpretation: "descriptive_only",
    });
  });

  it("excludes all Gold conversion evidence at three gates or fewer", () => {
    const report = buildStarConversionDiagnostics(
      [
        observation("ineligible", 1, 1, {
          gateCount: 3,
        }),
        observation("eligible", 2, 1),
      ],
      { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall).toMatchObject({
      goldEligibleEventCount: 1,
      goldIneligibleEventCount: 1,
      ineligibleGoldAnomalyCount: 1,
      goldTopThree: {
        assignedCount: 1,
        convertedCount: 1,
      },
      blueWin: {
        assignedCount: 2,
        convertedCount: 2,
      },
    });
    expect(report.warnings).toContain("INELIGIBLE_GOLD_ASSIGNMENT_ANOMALY");
  });

  it("keeps missing assignment separate from failed conversion", () => {
    const report = buildStarConversionDiagnostics(
      [observation("none", null, null), observation("assigned", 4, 2)],
      { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall.goldTopThree).toMatchObject({
      assignedCount: 1,
      convertedCount: 0,
      rate: 0,
      evidenceStatus: "insufficient_sample",
    });
  });

  it("excludes partial and invalid source evidence rather than treating it as failure", () => {
    const report = buildStarConversionDiagnostics(
      [
        observation("complete", 2, 1),
        observation("partial", 6, 6, { starDataStatus: "partial" }),
      ],
      { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall).toMatchObject({
      eventCount: 2,
      completeEventCount: 1,
      excludedEventCount: 1,
      goldTopThree: { assignedCount: 1, convertedCount: 1 },
    });
    expect(report.warnings).toContain(
      "PARTIAL_OR_INVALID_STAR_EVENTS_EXCLUDED",
    );
  });

  it("keeps mode, exact distance, gate count and era separate", () => {
    const report = buildStarConversionDiagnostics(
      [
        observation("bike", 2, 1),
        observation("horse", 3, 2, {
          mode: "horse",
          distanceMeters: 1800,
          gateCount: 8,
          eraId: "era-2",
        }),
      ],
      { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
    );
    expect(
      report.exactCells.map(({ mode, distanceMeters, gateCount, eraId }) => [
        mode,
        distanceMeters,
        gateCount,
        eraId,
      ]),
    ).toEqual([
      ["bike", 1000, 6, "era-1"],
      ["horse", 1800, 8, "era-2"],
    ]);
  });

  it("requires stars to predate the result and validates finish positions", () => {
    expect(() =>
      buildStarConversionDiagnostics(
        [
          observation("late", 2, 1, {
            starObservedAt: "2026-07-10T10:06:00Z",
          }),
        ],
        { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
      ),
    ).toThrow("times are invalid");
    expect(() =>
      buildStarConversionDiagnostics([observation("finish", 7, 1)], {
        minimumAssignedEvents: 2,
        evidenceSource: "synthetic",
      }),
    ).toThrow("finish position is invalid");
  });

  it("rejects duplicate events and inconsistent unassigned states", () => {
    const duplicate = observation("duplicate", 2, 1);
    expect(() =>
      buildStarConversionDiagnostics([duplicate, duplicate], {
        minimumAssignedEvents: 2,
        evidenceSource: "synthetic",
      }),
    ).toThrow("event IDs must be unique");
    expect(() =>
      buildStarConversionDiagnostics(
        [
          observation("bad", null, 1, {
            gold: {
              status: "not_assigned",
              assignedCoreFinishPosition: 2,
            },
          }),
        ],
        { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
      ),
    ).toThrow("cannot contain a finish");
  });

  it("never converts diagnostics into a predictive or actionable claim", () => {
    const report = buildStarConversionDiagnostics(
      [observation("one", 1, 1), observation("two", 1, 1)],
      { minimumAssignedEvents: 2, evidenceSource: "synthetic" },
    );
    expect(report).toMatchObject({
      predictiveFeatureCreated: false,
      gateCStatus: "evidence_only",
      gateCPassed: false,
      actionableRecommendationsAllowed: false,
    });
    expect(report.warnings).toContain("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  });
});
