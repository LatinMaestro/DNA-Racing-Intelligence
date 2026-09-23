import { describe, expect, it } from "vitest";

import { normalizeOwnedBikeHistory } from "@/domain/pro-league-owned-bike-history";

const race = {
  hid: 101,
  rid: 9001,
  rvmode: "bike",
  status: "finished",
  cb: 12,
  time: 62.127,
  end_time: "2026-09-23T00:00:00.000Z",
};

describe("owned Bike history reconciliation", () => {
  it("keeps every completed Bike finish at a league distance and measures exclusions", () => {
    const result = normalizeOwnedBikeHistory({
      coreId: "101",
      pages: [
        {
          page: 1,
          rows: [
            race,
            { ...race, rid: 9002, rvmode: "horse" },
            { ...race, rid: 9003, cb: 13 },
            { ...race, rid: 9004, status: "pending" },
            { ...race, rid: 9005, cb: "12" },
          ],
        },
        { page: 2, rows: [] },
      ],
    });
    expect(result).toMatchObject({
      coreId: "101",
      allModeRows: 5,
      bikeRows: 4,
      outsideLeagueDistance: 1,
      notFinished: 1,
      finishes: [
        {
          distanceMetres: 1200,
          elapsedTimeMilliseconds: 62127,
          source: "bike_history",
        },
        {
          distanceMetres: 1200,
          elapsedTimeMilliseconds: 62127,
          source: "bike_history",
        },
      ],
    });
  });

  it("fails closed on incomplete pages, wrong ownership, duplicate races or invalid time", () => {
    const pages = (rows: readonly unknown[]) => [
      { page: 1, rows },
      { page: 2, rows: [] },
    ];
    expect(() =>
      normalizeOwnedBikeHistory({
        coreId: "101",
        pages: [{ page: 1, rows: [race] }],
      }),
    ).toThrow("terminal");
    expect(() =>
      normalizeOwnedBikeHistory({
        coreId: "101",
        pages: pages([{ ...race, hid: 102 }]),
      }),
    ).toThrow("owned Core");
    expect(() =>
      normalizeOwnedBikeHistory({ coreId: "101", pages: pages([race, race]) }),
    ).toThrow("duplicate");
    expect(() =>
      normalizeOwnedBikeHistory({
        coreId: "101",
        pages: pages([{ ...race, time: -1 }]),
      }),
    ).toThrow("elapsed time");
    expect(() =>
      normalizeOwnedBikeHistory({
        coreId: "101",
        pages: pages([{ ...race, time: 0.00001 }]),
      }),
    ).toThrow("milliseconds");
  });
});
