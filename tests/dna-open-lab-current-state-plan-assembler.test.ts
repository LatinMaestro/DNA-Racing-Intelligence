import { describe, expect, it } from "vitest";

import {
  assembleDnaCurrentStateSyncPlan,
  type DnaCurrentStateIdentityObservation,
} from "@/lib/dna-open-lab-current-state-plan-assembler";
import type { DnaCurrentStateRequest } from "@/lib/dna-open-lab-current-state-sync-plan";
import type {
  DnaActiveRace,
  DnaOpenLabResponse,
  DnaRaceMode,
  DnaSpliceArenaCore,
  DnaSpliceArenaResult,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

const observedAt = "2026-08-28T13:00:00Z";

function response(result: unknown): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function observation(
  request: DnaCurrentStateRequest,
  result: unknown,
): DnaCurrentStateIdentityObservation {
  return Object.freeze({ request, response: response(result), observedAt });
}

function ownership(cores: readonly DnaVaultCore[]) {
  return observation(
    Object.freeze({
      scope: "vault",
      endpoint: "vault.cores_full",
      payload: Object.freeze({ vault: "owner-vault" }),
    }),
    cores,
  );
}

function vaultCore(hid: number): DnaVaultCore {
  return Object.freeze({
    hid,
    name: `Core ${hid}`,
    type: "Genesis",
    element: "Fire",
    gender: hid % 2 === 0 ? "Female" : "Male",
    fno: 12,
  });
}

function activeRace(rid: string): DnaActiveRace {
  return Object.freeze({
    rid,
    status: "open",
    race_name: `Race ${rid}`,
    format: "DU",
    class: "G-6",
    cb: null,
    rgate: 12,
    hs_in: 3,
    fee_fixed: Object.freeze({ DEZ: 10 }),
    feeusd: 1,
    paytoken: "DEZ",
    start_time: "2026-08-28T14:00:00Z",
    end_time: null,
    version: 1,
    rvmode: "bike",
  });
}

function active(races: readonly DnaActiveRace[]) {
  return observation(
    Object.freeze({
      scope: "races",
      endpoint: "races.active",
      payload: Object.freeze({}),
    }),
    races,
  );
}

function arenaCore(hid: number): DnaSpliceArenaCore {
  return Object.freeze({
    hid,
    name: `Arena ${hid}`,
    type: "Bike",
    gender: hid % 2 === 0 ? "Female" : "Male",
    element: "Earth",
    color: "Green",
    hex_code: "#00ff00",
    fno: 8,
    price_usd: 2.5,
  });
}

function arena(input: {
  mode: DnaRaceMode;
  page: number;
  hasMore: boolean;
  coreIds?: readonly number[];
  returnedPage?: number;
  limit?: number;
}) {
  const result: DnaSpliceArenaResult = Object.freeze({
    cores: Object.freeze((input.coreIds ?? []).map(arenaCore)),
    has_more: input.hasMore,
    limit: input.limit ?? 20,
    page: input.returnedPage ?? input.page,
  });
  return observation(
    Object.freeze({
      scope: "splice",
      endpoint: "splice.arena",
      payload: Object.freeze({
        filter: Object.freeze({ rvmode: input.mode }),
        page: input.page,
      }),
    }),
    result,
  );
}

function base() {
  return [
    ownership([vaultCore(9), vaultCore(2)]),
    active([activeRace("race-b"), activeRace("race-a")]),
  ];
}

describe("DNA Open Lab dynamic current-state plan assembly", () => {
  it("requests exactly the next page for each incomplete Arena mode", () => {
    const assembled = assembleDnaCurrentStateSyncPlan({
      vault: "owner-vault",
      spliceModes: ["bike", "car"],
      observations: [
        ...base(),
        arena({ mode: "bike", page: 1, hasMore: true }),
      ],
    });

    expect(assembled.status).toBe("needs_continuation");
    expect(assembled.ownedCoreIds).toEqual([2, 9]);
    expect(assembled.activeRaceIds).toEqual(["race-a", "race-b"]);
    expect(assembled.arenaPageNumbersByMode).toEqual({ bike: [1] });
    expect(
      assembled.continuationRequests.map((entry) => entry.payload),
    ).toEqual([
      { filter: { rvmode: "bike" }, page: 2 },
      { filter: { rvmode: "car" }, page: 1 },
    ]);
    expect(assembled.plan).toBeNull();
  });

  it("emits one deterministic complete plan after all modes terminate", () => {
    const assembled = assembleDnaCurrentStateSyncPlan({
      vault: "owner-vault",
      spliceModes: ["bike", "car"],
      observations: [
        ...base(),
        arena({ mode: "bike", page: 2, hasMore: false, coreIds: [22] }),
        arena({ mode: "car", page: 1, hasMore: false, coreIds: [] }),
        arena({ mode: "bike", page: 1, hasMore: true, coreIds: [11] }),
      ],
    });

    expect(assembled.status).toBe("ready");
    expect(assembled.continuationRequests).toEqual([]);
    expect(
      assembled.plan?.bootstrap
        .filter((entry) => entry.endpoint === "splice.arena")
        .map((entry) => entry.payload),
    ).toEqual([
      { filter: { rvmode: "bike" }, page: 1 },
      { filter: { rvmode: "bike" }, page: 2 },
      { filter: { rvmode: "car" }, page: 1 },
    ]);
    expect(
      assembled.plan?.hydrate.find(
        (entry) => entry.endpoint === "cores.info_bulk",
      )?.payload.hids,
    ).toEqual([2, 9]);
    expect(
      assembled.plan?.hydrate.find((entry) => entry.endpoint === "races.fills")
        ?.payload.rids,
    ).toEqual(["race-a", "race-b"]);
  });

  it("rejects missing or conflicting ownership and active-race authority", () => {
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: [],
        observations: [active([])],
      }),
    ).toThrow("vault.cores_full requires exactly one observation");
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: [],
        observations: [ownership([vaultCore(2), vaultCore(2)]), active([])],
      }),
    ).toThrow("repeats an owned Core identity");
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: [],
        observations: [
          ownership([]),
          active([activeRace("r"), activeRace("r")]),
        ],
      }),
    ).toThrow("repeats a race identity");
  });

  it("rejects gaps, response-page drift and pages after a terminal page", () => {
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: ["bike"],
        observations: [
          ...base(),
          arena({ mode: "bike", page: 2, hasMore: false }),
        ],
      }),
    ).toThrow("pages must be contiguous from page 1");
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: ["bike"],
        observations: [
          ...base(),
          arena({ mode: "bike", page: 1, returnedPage: 2, hasMore: false }),
        ],
      }),
    ).toThrow("response page does not match its request");
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: ["bike"],
        observations: [
          ...base(),
          arena({ mode: "bike", page: 1, hasMore: false }),
          arena({ mode: "bike", page: 2, hasMore: false }),
        ],
      }),
    ).toThrow("page after its terminal page");
  });

  it("rejects changing page limits and repeated Arena Cores", () => {
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: ["bike"],
        observations: [
          ...base(),
          arena({ mode: "bike", page: 1, hasMore: true, limit: 20 }),
          arena({ mode: "bike", page: 2, hasMore: false, limit: 10 }),
        ],
      }),
    ).toThrow("page limit changed during acquisition");
    expect(() =>
      assembleDnaCurrentStateSyncPlan({
        vault: "owner-vault",
        spliceModes: ["bike"],
        observations: [
          ...base(),
          arena({ mode: "bike", page: 1, hasMore: true, coreIds: [11] }),
          arena({ mode: "bike", page: 2, hasMore: false, coreIds: [11] }),
        ],
      }),
    ).toThrow("repeats a Core across pages");
  });
});
