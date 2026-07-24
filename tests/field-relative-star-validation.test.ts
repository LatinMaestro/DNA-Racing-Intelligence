import { describe, expect, it } from "vitest";

import {
  validateFieldRelativeStars,
  type FieldRelativeStarObservation,
  type FieldRelativeStarState,
} from "../domain/field-relative-star-validation";

function observation(
  id: string,
  fieldQualityBand: FieldRelativeStarObservation["fieldQualityBand"],
  state: FieldRelativeStarState,
  competitiveTimeOutcome: boolean,
  overrides: Partial<FieldRelativeStarObservation> = {},
): FieldRelativeStarObservation {
  return {
    observationId: `observation-${id}`,
    eventId: `event-${id}`,
    coreId: `core-${id}`,
    eventAt: "2026-07-10T10:00:00Z",
    outcomeRecordedAt: "2026-07-10T10:05:00Z",
    featureCutoffAt: "2026-07-10T09:59:00Z",
    fieldQualityCutoffAt: "2026-07-10T09:58:00Z",
    mode: "bike",
    distanceMeters: 1000,
    gateCount: 6,
    fieldQualityBand,
    competitiveTimeOutcome,
    starDataStatus: "complete",
    goldState: state,
    blueState: state,
    ...overrides,
  };
}

function comparisonSet(): FieldRelativeStarObservation[] {
  return [
    observation("sr1", "strong", "received", true),
    observation("sr2", "strong", "received", true),
    observation("sn1", "strong", "not_received", false),
    observation("sn2", "strong", "not_received", false),
    observation("wr1", "weak", "received", true),
    observation("wr2", "weak", "received", true),
    observation("wn1", "weak", "not_received", false),
    observation("wn2", "weak", "not_received", false),
  ];
}

describe("field-relative star validation", () => {
  it("reports strong-field star and weak-field no-star associations", () => {
    const report = validateFieldRelativeStars(comparisonSet(), {
      minimumGroupObservations: 2,
      evidenceSource: "historical_holdout",
    });
    expect(report.overall.gold).toMatchObject({
      strongFieldReceived: {
        observationCount: 2,
        competitiveOutcomeCount: 2,
        competitiveOutcomeRate: 1,
      },
      strongFieldNotReceived: {
        observationCount: 2,
        competitiveOutcomeCount: 0,
        competitiveOutcomeRate: 0,
      },
      strongFieldRateDifference: 1,
      weakFieldNoStarRateDifference: -1,
      strongFieldStatus: "descriptive_ready",
      weakFieldStatus: "descriptive_ready",
      interpretation: "association_only",
    });
  });

  it("does not treat a no-assignment event as negative star evidence", () => {
    const report = validateFieldRelativeStars(
      [
        observation("not-assigned", "weak", "not_assigned", false),
        observation("not-received", "weak", "not_received", false),
      ],
      { minimumGroupObservations: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall.gold.weakFieldNotReceived.observationCount).toBe(1);
  });

  it("excludes Gold at three gates or fewer while retaining Blue evidence", () => {
    const report = validateFieldRelativeStars(
      [
        observation("small1", "strong", "received", true, {
          gateCount: 3,
          goldState: "excluded",
          blueState: "received",
        }),
        observation("small2", "strong", "not_received", false, {
          gateCount: 3,
          goldState: "excluded",
          blueState: "not_received",
        }),
      ],
      { minimumGroupObservations: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall.goldIneligibleObservationCount).toBe(2);
    expect(report.overall.gold.strongFieldReceived.observationCount).toBe(0);
    expect(report.overall.blue.strongFieldReceived.observationCount).toBe(1);
  });

  it("rejects analytical Gold evidence at an ineligible gate count", () => {
    expect(() =>
      validateFieldRelativeStars(
        [
          observation("invalid", "strong", "received", true, {
            gateCount: 3,
          }),
        ],
        { minimumGroupObservations: 2, evidenceSource: "synthetic" },
      ),
    ).toThrow("Gold must be excluded");
  });

  it("excludes partial observations and reports insufficient groups", () => {
    const report = validateFieldRelativeStars(
      [
        observation("complete", "strong", "received", true),
        observation("partial", "strong", "not_received", false, {
          starDataStatus: "partial",
        }),
      ],
      { minimumGroupObservations: 2, evidenceSource: "synthetic" },
    );
    expect(report.overall).toMatchObject({
      totalObservationCount: 2,
      completeObservationCount: 1,
      excludedObservationCount: 1,
    });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "PARTIAL_OR_INVALID_OBSERVATIONS_EXCLUDED",
        "INSUFFICIENT_STRONG_FIELD_COMPARISON",
        "INSUFFICIENT_WEAK_FIELD_COMPARISON",
      ]),
    );
  });

  it("requires pre-event field quality and feature cutoffs", () => {
    expect(() =>
      validateFieldRelativeStars(
        [
          observation("leak", "strong", "received", true, {
            fieldQualityCutoffAt: "2026-07-10T10:01:00Z",
          }),
        ],
        { minimumGroupObservations: 2, evidenceSource: "synthetic" },
      ),
    ).toThrow("chronology is invalid");
  });

  it("keeps mode and exact distance cells separate", () => {
    const report = validateFieldRelativeStars(
      [
        observation("bike", "strong", "received", true),
        observation("horse", "weak", "not_received", false, {
          mode: "horse",
          distanceMeters: 1800,
        }),
      ],
      { minimumGroupObservations: 2, evidenceSource: "synthetic" },
    );
    expect(
      report.exactCells.map(({ mode, distanceMeters }) => [
        mode,
        distanceMeters,
      ]),
    ).toEqual([
      ["bike", 1000],
      ["horse", 1800],
    ]);
  });

  it("rejects duplicate event-core evidence", () => {
    expect(() =>
      validateFieldRelativeStars(
        [
          observation("one", "strong", "received", true),
          observation("two", "weak", "not_received", false, {
            eventId: "event-one",
            coreId: "core-one",
          }),
        ],
        { minimumGroupObservations: 2, evidenceSource: "synthetic" },
      ),
    ).toThrow("unique by event and core");
  });

  it("cannot make causal, stop, burn or actionable claims", () => {
    const report = validateFieldRelativeStars(comparisonSet(), {
      minimumGroupObservations: 2,
      evidenceSource: "synthetic",
    });
    expect(report).toMatchObject({
      causalClaimAllowed: false,
      stopOrBurnDecisionAllowed: false,
      gateCStatus: "evidence_only",
      gateCPassed: false,
      actionableRecommendationsAllowed: false,
    });
    expect(report.warnings).toContain("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  });
});
