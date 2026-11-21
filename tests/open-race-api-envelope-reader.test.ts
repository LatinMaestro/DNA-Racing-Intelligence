import { describe, expect, it } from "vitest";

import { readOpenRaceApiEnvelope } from "@/lib/open-race-api-envelope-reader";
import type {
  DnaActiveRace,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceFill,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

function response<T>(
  result: T,
  rateLimit: Partial<DnaOpenLabResponse<T>["rateLimit"]> = {},
): DnaOpenLabResponse<T> {
  return {
    result,
    httpStatus: 200,
    rateLimit: {
      limit: 30,
      remaining: rateLimit.remaining ?? 29,
      resetSeconds: 60,
      rateClass: "tier-1",
      retryAfterSeconds: rateLimit.retryAfterSeconds ?? null,
    },
  };
}

const vaultCores: readonly DnaVaultCore[] = Array.from(
  { length: 214 },
  (_, index) => ({
    hid: index === 213 ? 10457 : index + 1,
    name: `Owned ${index + 1}`,
    type: "Genesis",
    element: "Metal",
    gender: "Female",
    fno: 1,
  }),
);
const activeRace: DnaActiveRace = {
  rid: "race-open",
  status: "open",
  race_name: "Open Bike race-open",
  format: "normal",
  class: 2,
  cb: 1600,
  rgate: 6,
  hs_in: 3,
  start_time: null,
  end_time: null,
  version: 1,
  rvmode: "bike",
};
const fill: DnaRaceFill = {
  rid: "race-open",
  status: "open",
  rgate: 6,
  hs_in: 3,
  hids: [9001, 9002, 9003],
  entry_txns_confirmed: {},
};
const document: DnaRaceDocument = {
  rid: "race-open",
  status: "open",
  race_name: "Open Bike race-open",
  format: "normal",
  class: 2,
  cb: 1600,
  rgate: 6,
  hs_in: 3,
  version: 1,
  rvmode: "bike",
  hids: [9001, 9002, 9003],
};

function client(overrides: Record<string, unknown> = {}) {
  return {
    vaultCoresFull: async () => response(vaultCores),
    racesActive: async () => response([activeRace]),
    raceFills: async () => response([fill]),
    raceDocs: async () => response([document]),
    ...overrides,
  };
}

function read(
  overrides: Partial<Parameters<typeof readOpenRaceApiEnvelope>[0]> = {},
) {
  return readOpenRaceApiEnvelope({
    client: client(),
    sourceStatus: "offline_replay",
    vault: "owner-vault",
    generationId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-11-21T11:59:00.000Z",
    maximumAgeMinutes: 5,
    maximumActiveRaces: 100,
    maximumRequests: 12,
    ...overrides,
  });
}

describe("Open Race bounded API envelope reader", () => {
  it("reads four documented endpoints and returns canonical scanner input", async () => {
    const result = await read();
    expect(result).toMatchObject({
      status: "ready",
      sourceStatus: "offline_replay",
      requestCount: 4,
      activeRaceCount: 1,
      detailRaceCount: 1,
      prefilteredRaceCount: 0,
      ownedCoreCount: 214,
      envelope: {
        currentRaces: {
          activeRaces: [
            { canonical: { sourceRaceId: "race-open", mode: "bike" } },
          ],
          raceFills: [
            {
              canonical: {
                sourceRaceId: "race-open",
                entrantCoreIds: ["9001", "9002", "9003"],
              },
            },
          ],
        },
        documents: [
          {
            canonical: {
              sourceRaceId: "race-open",
              distanceMetres: 1600,
            },
          },
        ],
      },
      gameEntryAllowed: false,
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.envelope.ownedCores).toHaveLength(214);
    }
  });

  it("fails closed before detail reads when active inventory exceeds its cap", async () => {
    const result = await read({
      maximumActiveRaces: 1,
      client: client({
        racesActive: async () =>
          response([activeRace, { ...activeRace, rid: "race-2" }]),
      }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "active_race_limit_exceeded",
      requestCount: 2,
      envelope: null,
    });
  });

  it("fails closed when fill or document coverage does not match inventory", async () => {
    const result = await read({
      client: client({ raceDocs: async () => response([]) }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "incomplete_race_coverage",
      envelope: null,
    });
  });

  it("fails closed when its request budget cannot cover every batch", async () => {
    const races = Array.from({ length: 21 }, (_, index) => ({
      ...activeRace,
      rid: `race-${index + 1}`,
    }));
    const result = await read({
      maximumRequests: 4,
      client: client({ racesActive: async () => response(races) }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "request_budget_exceeded",
      requestCount: 2,
      envelope: null,
    });
  });

  it("stops before detail reads when provider allowance cannot cover the plan", async () => {
    const detailCalls: string[][] = [];
    const result = await read({
      client: client({
        racesActive: async () => response([activeRace], { remaining: 1 }),
        raceFills: async (raceIds: readonly (string | number)[]) => {
          detailCalls.push(raceIds.map(String));
          return response([fill]);
        },
        raceDocs: async (raceIds: readonly (string | number)[]) => {
          detailCalls.push(raceIds.map(String));
          return response([document]);
        },
      }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "provider_budget_unavailable",
      requestCount: 2,
      envelope: null,
    });
    expect(detailCalls).toEqual([]);
  });

  it("stops a multi-batch read when the provider lowers its allowance", async () => {
    const races = Array.from({ length: 21 }, (_, index) => ({
      ...activeRace,
      rid: `race-${index + 1}`,
    }));
    let documentCalls = 0;
    const result = await read({
      client: client({
        racesActive: async () => response(races, { remaining: 10 }),
        raceFills: async () => response([], { remaining: 2 }),
        raceDocs: async () => {
          documentCalls += 1;
          return response([]);
        },
      }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "provider_budget_unavailable",
      requestCount: 3,
      envelope: null,
    });
    expect(documentCalls).toBe(0);
  });

  it("uses active inventory to avoid detail reads for ordinary races below the threshold", async () => {
    const detailCalls: string[][] = [];
    const underfilled = Array.from({ length: 21 }, (_, index) => ({
      ...activeRace,
      rid: `underfilled-${index + 1}`,
      hs_in: 2,
    }));
    const result = await read({
      maximumRequests: 2,
      client: client({
        racesActive: async () => response(underfilled),
        raceFills: async (raceIds: readonly (string | number)[]) => {
          detailCalls.push(raceIds.map(String));
          return response([]);
        },
        raceDocs: async (raceIds: readonly (string | number)[]) => {
          detailCalls.push(raceIds.map(String));
          return response([]);
        },
      }),
    });
    expect(result).toMatchObject({
      status: "ready",
      requestCount: 2,
      activeRaceCount: 21,
      detailRaceCount: 0,
      prefilteredRaceCount: 21,
    });
    expect(detailCalls).toEqual([]);
  });

  it("fails closed when an open inventory row has invalid gate evidence", async () => {
    const result = await read({
      client: client({
        racesActive: async () =>
          response([{ ...activeRace, rgate: 0, hs_in: 0 }]),
      }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "source_unavailable",
      requestCount: 2,
      envelope: null,
    });
  });
});
