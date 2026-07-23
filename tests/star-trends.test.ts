import { describe, expect, it } from "vitest";
import {
  buildStarTrendResult,
  type StarTrendObservation,
  type StarTrendPeriod,
} from "@/domain/star-trends";

const periods: readonly StarTrendPeriod[] = [
  {
    periodId: "early",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-02-01T00:00:00Z",
  },
  {
    periodId: "later",
    startsAt: "2026-02-01T00:00:00Z",
    endsAt: "2026-03-01T00:00:00Z",
  },
];

function observation(
  eventId: string,
  eventAt: string,
  goldAssignmentState: StarTrendObservation["goldAssignmentState"],
  blueAssignmentState: StarTrendObservation["blueAssignmentState"],
  overrides: Partial<StarTrendObservation> = {},
): StarTrendObservation {
  return {
    eventId,
    eventAt,
    mode: "bike",
    distance: 1_000,
    goldEligible: true,
    goldAssignmentState,
    blueAssignmentState,
    ...overrides,
  };
}

const options = {
  minimumOpportunityCount: 2,
  absoluteRateChangeThreshold: 0.4,
} as const;

describe("star assignment trend candidates", () => {
  it("keeps mode and exact distance separate with explicit denominators", () => {
    const result = buildStarTrendResult(
      [
        observation(
          "bike-early",
          "2026-01-10T00:00:00Z",
          "assigned",
          "assigned",
        ),
        observation(
          "horse-early",
          "2026-01-11T00:00:00Z",
          "not_assigned",
          "assigned",
          { mode: "horse" },
        ),
        observation(
          "bike-1200",
          "2026-01-12T00:00:00Z",
          "assigned",
          "not_assigned",
          { distance: 1_200 },
        ),
      ],
      periods,
      options,
    );

    expect(result.summaries).toHaveLength(3);
    expect(
      result.summaries.map(({ mode, distance, gold }) => [
        mode,
        distance,
        gold.opportunityCount,
      ]),
    ).toEqual([
      ["bike", 1_000, 1],
      ["bike", 1_200, 1],
      ["horse", 1_000, 1],
    ]);
  });

  it("excludes Gold-ineligible and invalid evidence without affecting Blue", () => {
    const [summary] = buildStarTrendResult(
      [
        observation(
          "ineligible",
          "2026-01-10T00:00:00Z",
          "excluded",
          "assigned",
          { goldEligible: false },
        ),
        observation("excluded", "2026-01-11T00:00:00Z", "excluded", "excluded"),
      ],
      periods,
      options,
    ).summaries;

    expect(summary).toMatchObject({
      eventCount: 2,
      goldEligibleEventCount: 1,
      goldIneligibleEventCount: 1,
      gold: {
        assignedCount: 0,
        noAssignmentCount: 0,
        excludedCount: 2,
        opportunityCount: 0,
        assignmentRate: null,
      },
      blue: {
        assignedCount: 1,
        noAssignmentCount: 0,
        excludedCount: 1,
        opportunityCount: 1,
        assignmentRate: 1,
      },
    });
  });

  it("labels a configured rate shift as a candidate, not a confirmed era", () => {
    const result = buildStarTrendResult(
      [
        observation("e1", "2026-01-10T00:00:00Z", "assigned", "assigned"),
        observation("e2", "2026-01-11T00:00:00Z", "assigned", "assigned"),
        observation("l1", "2026-02-10T00:00:00Z", "not_assigned", "assigned"),
        observation("l2", "2026-02-11T00:00:00Z", "not_assigned", "assigned"),
      ],
      periods,
      options,
    );

    expect(result.changeCandidates).toContainEqual({
      mode: "bike",
      distance: 1_000,
      signal: "gold",
      priorPeriodId: "early",
      currentPeriodId: "later",
      priorOpportunityCount: 2,
      currentOpportunityCount: 2,
      priorAssignmentRate: 1,
      currentAssignmentRate: 0,
      absoluteRateChange: 1,
      status: "change_candidate",
      interpretation: "descriptive_only",
    });
    expect(
      result.changeCandidates.find(({ signal }) => signal === "blue"),
    ).toMatchObject({
      status: "stable_within_threshold",
      interpretation: "descriptive_only",
    });
  });

  it("requires the configured opportunity count on both sides", () => {
    const result = buildStarTrendResult(
      [
        observation("e1", "2026-01-10T00:00:00Z", "assigned", "assigned"),
        observation("l1", "2026-02-10T00:00:00Z", "not_assigned", "assigned"),
      ],
      periods,
      options,
    );

    expect(result.changeCandidates).toHaveLength(2);
    expect(
      result.changeCandidates.every(
        ({ status }) => status === "insufficient_evidence",
      ),
    ).toBe(true);
  });

  it("uses start-inclusive and end-exclusive periods and reports outside coverage", () => {
    const result = buildStarTrendResult(
      [
        observation("boundary", "2026-02-01T00:00:00Z", "assigned", "assigned"),
        observation("outside", "2026-03-01T00:00:00Z", "assigned", "assigned"),
      ],
      periods,
      options,
    );

    expect(result.summaries[0]!.periodId).toBe("later");
    expect(result.outsideConfiguredPeriodsCount).toBe(1);
  });

  it("rejects invalid periods, duplicate events and Gold-ineligible assignments", () => {
    expect(() =>
      buildStarTrendResult([], [periods[1]!, periods[0]!], options),
    ).toThrow(/Invalid star trend period/);

    const duplicate = observation(
      "duplicate",
      "2026-01-10T00:00:00Z",
      "assigned",
      "assigned",
    );
    expect(() =>
      buildStarTrendResult([duplicate, duplicate], periods, options),
    ).toThrow(/Duplicate star trend event/);

    expect(() =>
      buildStarTrendResult(
        [
          observation(
            "invalid-gold",
            "2026-01-10T00:00:00Z",
            "assigned",
            "assigned",
            { goldEligible: false },
          ),
        ],
        periods,
        options,
      ),
    ).toThrow(/Invalid star trend observation/);
  });

  it("is deterministic across observation order", () => {
    const values = [
      observation("e1", "2026-01-10T00:00:00Z", "assigned", "assigned"),
      observation("e2", "2026-01-11T00:00:00Z", "not_assigned", "assigned"),
      observation("l1", "2026-02-10T00:00:00Z", "assigned", "not_assigned"),
      observation("l2", "2026-02-11T00:00:00Z", "assigned", "assigned"),
    ];

    expect(
      buildStarTrendResult([...values].reverse(), periods, options),
    ).toEqual(buildStarTrendResult(values, periods, options));
  });
});
