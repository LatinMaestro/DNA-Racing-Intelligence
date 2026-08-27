import { describe, expect, it } from "vitest";

import {
  safeDnaOpenLabRateLimitEvidence,
  summarizeDnaOpenLabShape,
} from "../lib/dna-open-lab-discovery-evidence";

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
});
