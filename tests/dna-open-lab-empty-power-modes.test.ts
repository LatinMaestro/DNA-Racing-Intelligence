import { describe, expect, it } from "vitest";

import { adaptDnaCorePower } from "@/lib/dna-open-lab-v1-adapters";

describe("DNA Open Lab empty Core power-mode evidence", () => {
  it("preserves an authoritative empty mode map without inventing zero-valued modes", () => {
    const adapted = adaptDnaCorePower({
      raw: {
        hid: 42,
        power: {},
        m_stats: {},
      },
      observedAt: "2026-09-22T09:48:00.000Z",
    });

    expect(adapted.canonical).toEqual({
      sourceType: "core_power_snapshot",
      sourceCoreId: "42",
      byMode: {},
      aggregateStatsSourceValue: {},
    });
    expect(adapted.canonical.byMode).not.toHaveProperty("bike");
    expect(adapted.canonical.byMode).not.toHaveProperty("car");
    expect(adapted.canonical.byMode).not.toHaveProperty("horse");
  });
});
