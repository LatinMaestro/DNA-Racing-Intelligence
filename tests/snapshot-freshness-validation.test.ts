import { describe, expect, it } from "vitest";

import {
  validateSnapshotFreshness,
  type SnapshotFreshnessInput,
} from "../domain/snapshot-freshness-validation";

function input(
  overrides: Partial<SnapshotFreshnessInput> = {},
): SnapshotFreshnessInput {
  return {
    snapshotId: "snapshot-1",
    source: "race_merge",
    dataCurrentThrough: "2026-07-21T00:00:00Z",
    lastImportedAt: "2026-07-21T02:00:00Z",
    aggregateRefreshedAt: "2026-07-21T02:30:00Z",
    evaluatedAt: "2026-07-24T00:00:00Z",
    currentMaximumAgeDays: 3,
    ageingMaximumAgeDays: 7,
    ...overrides,
  };
}

describe("snapshot freshness validation", () => {
  it("keeps coverage, import and aggregate timestamps separate", () => {
    expect(validateSnapshotFreshness(input())).toMatchObject({
      freshness: "current",
      aggregateStatus: "refreshed",
      confidenceTreatment: "no_freshness_penalty",
      historicalSnapshot: true,
      liveStateClaimAllowed: false,
      acceptedHistoricalFactsChanged: false,
    });
  });

  it("applies current, ageing and stale boundaries exactly", () => {
    expect(
      validateSnapshotFreshness(input({ evaluatedAt: "2026-07-24T00:00:00Z" }))
        .freshness,
    ).toBe("current");
    expect(
      validateSnapshotFreshness(
        input({ evaluatedAt: "2026-07-24T00:00:00.001Z" }),
      ).freshness,
    ).toBe("ageing");
    expect(
      validateSnapshotFreshness(
        input({ evaluatedAt: "2026-07-28T00:00:00.001Z" }),
      ).freshness,
    ).toBe("stale");
  });

  it("preserves unknown coverage without inventing recency", () => {
    const result = validateSnapshotFreshness(
      input({ dataCurrentThrough: null }),
    );
    expect(result.freshness).toBe("unknown");
    expect(result.ageMilliseconds).toBeNull();
    expect(result.confidenceTreatment).toBe("unknown_age");
  });

  it("represents a never-imported source distinctly", () => {
    const result = validateSnapshotFreshness(
      input({
        dataCurrentThrough: null,
        lastImportedAt: null,
        aggregateRefreshedAt: null,
      }),
    );
    expect(result).toMatchObject({
      freshness: "not_imported",
      aggregateStatus: "not_available",
      confidenceTreatment: "unavailable",
    });
  });

  it("discloses pending aggregate refresh independently of freshness", () => {
    const result = validateSnapshotFreshness(
      input({ aggregateRefreshedAt: null }),
    );
    expect(result.freshness).toBe("current");
    expect(result.aggregateStatus).toBe("pending");
    expect(result.warnings).toContain(
      "Derived aggregates have not completed refresh.",
    );
  });

  it("rejects impossible timestamp order and inconsistent missing imports", () => {
    expect(() =>
      validateSnapshotFreshness(
        input({ dataCurrentThrough: "2026-07-22T00:00:00Z" }),
      ),
    ).toThrow("cannot postdate");
    expect(() =>
      validateSnapshotFreshness(
        input({ aggregateRefreshedAt: "2026-07-21T01:00:00Z" }),
      ),
    ).toThrow("must follow import");
    expect(() =>
      validateSnapshotFreshness(input({ lastImportedAt: null })),
    ).toThrow("cannot have coverage");
  });

  it("requires ordered non-negative freshness thresholds", () => {
    expect(() =>
      validateSnapshotFreshness(input({ currentMaximumAgeDays: -1 })),
    ).toThrow("non-negative");
    expect(() =>
      validateSnapshotFreshness(
        input({ currentMaximumAgeDays: 8, ageingMaximumAgeDays: 7 }),
      ),
    ).toThrow("cannot be below");
  });
});
