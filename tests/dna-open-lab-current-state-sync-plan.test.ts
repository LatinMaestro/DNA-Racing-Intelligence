import { describe, expect, it } from "vitest";

import { createDnaCurrentStateSyncPlan } from "../lib/dna-open-lab-current-state-sync-plan";

describe("DNA Open Lab current-state sync plan", () => {
  it("builds the required bootstrap without telemetry semantics", () => {
    const plan = createDnaCurrentStateSyncPlan({ vault: "owner-vault" });

    expect(plan.bootstrap.map((entry) => entry.endpoint)).toEqual([
      "vault.info",
      "vault.cores_full",
      "vault.tier_badge",
      "vault.recent_races",
      "races.active",
      "tokens.prices",
      "splice.arena",
      "splice.arena",
      "splice.arena",
    ]);
    expect(
      plan.bootstrap
        .filter((entry) => entry.endpoint === "splice.arena")
        .map((entry) => entry.payload),
    ).toEqual([
      { filter: { rvmode: "bike" } },
      { filter: { rvmode: "car" } },
      { filter: { rvmode: "horse" } },
    ]);
    expect(plan.hydrate).toEqual([]);
    expect(plan.deferredUntilP3).toEqual([
      "cores.telemetry",
      "cores.telemetry_bulk",
      "cores.telemetry_benchmark",
    ]);
  });

  it("hydrates owned Cores in deterministic batches of at most twenty", () => {
    const plan = createDnaCurrentStateSyncPlan({
      vault: "owner-vault",
      ownedCoreIds: Array.from({ length: 45 }, (_, index) => index + 1),
      spliceModes: [],
    });

    const coreRequests = plan.hydrate.filter((entry) => entry.scope === "cores");
    expect(coreRequests).toHaveLength(24);
    expect(coreRequests.slice(0, 8).map((entry) => entry.endpoint)).toEqual([
      "cores.info_bulk",
      "cores.racing_stats_bulk",
      "cores.power_bulk",
      "cores.listing_price_bulk",
      "cores.attached_assets_bulk",
      "cores.owner_bulk",
      "cores.stamina_bulk",
      "cores.splicing_info_bulk",
    ]);
    expect(coreRequests[0]?.payload.hids).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(coreRequests[8]?.payload.hids).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
    expect(coreRequests[16]?.payload.hids).toEqual([41, 42, 43, 44, 45]);
    expect(
      coreRequests.some((entry) => entry.endpoint.includes("telemetry")),
    ).toBe(false);
  });

  it("hydrates active race fills in batches of at most twenty", () => {
    const plan = createDnaCurrentStateSyncPlan({
      vault: "owner-vault",
      activeRaceIds: Array.from({ length: 41 }, (_, index) => `race-${index + 1}`),
      spliceModes: [],
    });

    const fillRequests = plan.hydrate.filter(
      (entry) => entry.endpoint === "races.fills",
    );
    expect(fillRequests).toHaveLength(3);
    expect((fillRequests[0]?.payload.rids as readonly string[]).length).toBe(20);
    expect((fillRequests[1]?.payload.rids as readonly string[]).length).toBe(20);
    expect(fillRequests[2]?.payload.rids).toEqual(["race-41"]);
  });

  it("deduplicates observed identities and keeps pair work explicitly bounded", () => {
    const plan = createDnaCurrentStateSyncPlan({
      vault: " owner-vault ",
      ownedCoreIds: [9, 9, 10],
      activeRaceIds: [1, "1", 2, 2],
      spliceModes: ["bike", "bike"],
      splicePairs: [
        { fatherCoreId: 9, motherCoreId: 10 },
        { fatherCoreId: 9, motherCoreId: 10 },
        { fatherCoreId: 11, motherCoreId: 12 },
      ],
    });

    expect(
      plan.bootstrap.filter((entry) => entry.endpoint === "splice.arena"),
    ).toHaveLength(1);
    expect(
      plan.hydrate.find((entry) => entry.endpoint === "cores.info_bulk")?.payload
        .hids,
    ).toEqual([9, 10]);
    expect(
      plan.hydrate.find((entry) => entry.endpoint === "races.fills")?.payload.rids,
    ).toEqual([1, 2]);
    expect(
      plan.hydrate.filter((entry) => entry.endpoint.startsWith("splice.pair_")),
    ).toHaveLength(4);
  });

  it("fails closed on invalid current-state identities", () => {
    expect(() => createDnaCurrentStateSyncPlan({ vault: "  " })).toThrow(
      "vault is invalid",
    );
    expect(() =>
      createDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        ownedCoreIds: [0],
      }),
    ).toThrow("core id must be a positive safe integer");
    expect(() =>
      createDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        activeRaceIds: ["   "],
      }),
    ).toThrow("race id is invalid");
    expect(() =>
      createDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        splicePairs: [{ fatherCoreId: 1, motherCoreId: 0 }],
      }),
    ).toThrow("motherCoreId must be a positive safe integer");
  });
});
