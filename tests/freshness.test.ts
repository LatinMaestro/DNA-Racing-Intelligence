import { describe, expect, it } from "vitest";
import { deriveFreshness } from "@/domain/freshness";

const now = new Date("2026-07-22T00:00:00.000Z");

describe("historical snapshot freshness", () => {
  it("keeps missing imports unknown", () =>
    expect(deriveFreshness(null, now)).toBe("unknown"));
  it("uses current, ageing and stale thresholds", () => {
    expect(deriveFreshness(new Date("2026-07-19T00:00:00.000Z"), now)).toBe(
      "current",
    );
    expect(deriveFreshness(new Date("2026-07-16T00:00:00.000Z"), now)).toBe(
      "ageing",
    );
    expect(deriveFreshness(new Date("2026-07-14T00:00:00.000Z"), now)).toBe(
      "stale",
    );
  });
});
