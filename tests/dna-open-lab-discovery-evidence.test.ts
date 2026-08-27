import { describe, expect, it } from "vitest";

import {
  buildDnaOpenLabPairCandidates,
  hasProvenDnaOpenLabIndependentRateBuckets,
  planDnaOpenLabHistoryWindows,
  safeDnaOpenLabRateLimitEvidence,
  summarizeDnaOpenLabHistoryWindow,
  summarizeDnaOpenLabShape,
  type DnaOpenLabConnectedProbeEvidence,
} from "../lib/dna-open-lab-discovery-evidence";

function authEvidence(
  laneId: "key-1" | "key-2" | "key-3",
  endpoint: "test_auth.initial" | "test_auth.repeat",
  remaining: number,
): DnaOpenLabConnectedProbeEvidence {
  return {
    endpoint,
    scope: "vault",
    laneId,
    outcome: "success",
    httpStatus: 200,
    errorKind: null,
    rateLimit: {
      limit: 150,
      remaining,
      resetSeconds: 40,
      rateClass: "api_key",
      retryAfterSeconds: null,
    },
    shape: null,
  };
}

describe("DNA Open Lab discovery evidence", () => {
  it("summarizes field structure without retaining scalar values or dynamic ids", () => {
    const summary = summarizeDnaOpenLabShape({
      hid: 12345,
      owner: "0x1111111111111111111111111111111111111111",
      entries: {
        "12345": true,
        stable_field: "private-value",
      },
      nested: [{ rid: 9988, result: null }],
    });

    expect(summary.paths).toContainEqual({ path: "$.hid", kinds: ["number"] });
    expect(summary.paths).toContainEqual({
      path: "$.owner",
      kinds: ["string"],
    });
    expect(summary.paths).toContainEqual({
      path: "$.entries.*",
      kinds: ["boolean"],
    });
    expect(summary.paths).toContainEqual({
      path: "$.entries.stable_field",
      kinds: ["string"],
    });
    expect(summary.paths).toContainEqual({
      path: "$.nested[].rid",
      kinds: ["number"],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("produces the same fingerprint for different values with the same observed shape", () => {
    const left = summarizeDnaOpenLabShape({
      race: { rid: 1, status: "open" },
      values: [1, 2, 3],
    });
    const right = summarizeDnaOpenLabShape({
      race: { rid: 999999, status: "finished" },
      values: [10, 20],
    });

    expect(left.sha256).toBe(right.sha256);
    expect(left.paths).toEqual(right.paths);
  });

  it("changes the fingerprint when the observed schema changes", () => {
    const left = summarizeDnaOpenLabShape({ race: { rid: 1 } });
    const right = summarizeDnaOpenLabShape({
      race: { rid: 1, finish_time: 12.5 },
    });

    expect(left.sha256).not.toBe(right.sha256);
  });

  it("records heterogeneous array item kinds without array values", () => {
    const summary = summarizeDnaOpenLabShape({ values: [1, "two", null] });
    expect(summary.paths).toContainEqual({
      path: "$.values[]",
      kinds: ["null", "number", "string"],
    });
  });

  it("fails closed on non-JSON values, cycles and unsafe bounds", () => {
    expect(() => summarizeDnaOpenLabShape({ value: Number.NaN })).toThrow(
      "non-finite",
    );
    expect(() => summarizeDnaOpenLabShape({ value: undefined })).toThrow(
      "JSON-compatible",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => summarizeDnaOpenLabShape(cyclic)).toThrow("cyclic");

    expect(() => summarizeDnaOpenLabShape({}, { maximumDepth: 0 })).toThrow(
      "maximumDepth",
    );
    expect(() =>
      summarizeDnaOpenLabShape({ a: 1, b: 2 }, { maximumPaths: 1 }),
    ).toThrow("shape path bound");
  });

  it("keeps only bounded rate-limit metadata", () => {
    expect(
      safeDnaOpenLabRateLimitEvidence({
        limit: 30,
        remaining: 29,
        resetSeconds: 20,
        rateClass: "api_key",
        retryAfterSeconds: null,
      }),
    ).toEqual({
      limit: 30,
      remaining: 29,
      resetSeconds: 20,
      rateClass: "api_key",
      retryAfterSeconds: null,
    });

    expect(
      safeDnaOpenLabRateLimitEvidence({
        limit: null,
        remaining: null,
        resetSeconds: null,
        rateClass: "x".repeat(65),
        retryAfterSeconds: null,
      }).rateClass,
    ).toBe("redacted");
  });

  it("proves three independent API-key counters from paired auth observations", () => {
    const evidence = (["key-1", "key-2", "key-3"] as const).flatMap(
      (laneId) => [
        authEvidence(laneId, "test_auth.initial", 149),
        authEvidence(laneId, "test_auth.repeat", 148),
      ],
    );

    expect(hasProvenDnaOpenLabIndependentRateBuckets(evidence)).toBe(true);
    expect(
      hasProvenDnaOpenLabIndependentRateBuckets([
        ...evidence.slice(0, 2),
        authEvidence("key-2", "test_auth.initial", 147),
        authEvidence("key-2", "test_auth.repeat", 146),
        ...evidence.slice(4),
      ]),
    ).toBe(false);
  });

  it("plans fixed redacted history bands and retains no observed timestamps", () => {
    const plans = planDnaOpenLabHistoryWindows(
      new Date("2026-08-27T12:00:00.000Z"),
    );

    expect(plans.map(({ windowId, limit }) => ({ windowId, limit }))).toEqual([
      { windowId: "recent_0_7d", limit: 200 },
      { windowId: "historical_30_90d", limit: 1 },
      { windowId: "historical_90_365d", limit: 1 },
      { windowId: "historical_365_730d", limit: 1 },
      { windowId: "historical_730_1095d", limit: 1 },
    ]);

    const evidence = summarizeDnaOpenLabHistoryWindow({
      plan: plans[2]!,
      races: [
        {
          rid: "private-race-id",
          start_time: "2026-01-15T12:00:00.000Z",
        },
      ],
    });

    expect(evidence).toEqual({
      windowId: "historical_90_365d",
      resultCountClass: "at_request_limit",
      timestampVerification: "verified_within_window",
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("private-race-id");
    expect(serialized).not.toContain("2026-01-15");
  });

  it("classifies empty, missing, invalid, and out-of-window history evidence", () => {
    const plan = planDnaOpenLabHistoryWindows(
      new Date("2026-08-27T12:00:00.000Z"),
    )[0]!;

    expect(summarizeDnaOpenLabHistoryWindow({ plan, races: [] })).toEqual({
      windowId: "recent_0_7d",
      resultCountClass: "zero",
      timestampVerification: "not_applicable",
    });
    expect(
      summarizeDnaOpenLabHistoryWindow({
        plan,
        races: [{ rid: 1, start_time: null }],
      }).timestampVerification,
    ).toBe("unverified_missing_timestamp");
    expect(
      summarizeDnaOpenLabHistoryWindow({
        plan,
        races: [{ rid: 1, start_time: "not-a-timestamp" }],
      }).timestampVerification,
    ).toBe("invalid_timestamp");
    expect(
      summarizeDnaOpenLabHistoryWindow({
        plan,
        races: [{ rid: 1, start_time: "2020-01-01T00:00:00.000Z" }],
      }).timestampVerification,
    ).toBe("outside_requested_window");
    expect(() =>
      summarizeDnaOpenLabHistoryWindow({
        plan: { ...plan, limit: 1 },
        races: [{ rid: 1 }, { rid: 2 }],
      }),
    ).toThrow("exceeds request limit");
  });

  it("builds a bounded pair search with current cross-source candidates first", () => {
    const candidates = buildDnaOpenLabPairCandidates({
      owned: [
        { hid: 1, gender: "Male" },
        { hid: 2, gender: "Female" },
      ],
      arena: [
        { hid: 3, gender: "Male" },
        { hid: 4, gender: "Female" },
      ],
      maximum: 4,
    });

    expect(candidates).toEqual([
      { fatherCoreId: 1, motherCoreId: 4 },
      { fatherCoreId: 3, motherCoreId: 2 },
      { fatherCoreId: 1, motherCoreId: 2 },
      { fatherCoreId: 3, motherCoreId: 4 },
    ]);
    expect(() =>
      buildDnaOpenLabPairCandidates({
        owned: [{ hid: 0, gender: "Male" }],
        arena: [],
        maximum: 1,
      }),
    ).toThrow("candidate identity is invalid");
  });
});
