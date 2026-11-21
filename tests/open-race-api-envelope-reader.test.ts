import { describe, expect, it } from "vitest";

import { readOpenRaceApiEnvelope } from "@/lib/open-race-api-envelope-reader";
import type {
  DnaActiveRace,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceFill,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

function response<T>(result: T): DnaOpenLabResponse<T> {
  return {
    result,
    httpStatus: 200,
    rateLimit: {
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "tier-1",
      retryAfterSeconds: null,
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
  ...activeRace,
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
});
