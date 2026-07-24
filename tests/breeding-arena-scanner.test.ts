import { describe, expect, it } from "vitest";

import {
  scanBreedingArena,
  type BreedingArenaScanInput,
  type BreedingArenaSnapshotInput,
} from "../domain/breeding-arena-scanner";

function snapshot(
  overrides: Partial<BreedingArenaSnapshotInput> = {},
): BreedingArenaSnapshotInput {
  return {
    snapshotId: "arena-1",
    selected: true,
    status: "accepted",
    dataCurrentThrough: "2026-07-22T00:00:00Z",
    lastImported: "2026-07-22T01:00:00Z",
    freshness: "current",
    listings: [
      {
        listingId: "listing-1",
        sourceCoreId: "core-1",
        identityStatus: "exact",
        exactUsdPrice: "3.2500",
        remainingSplices: 2,
        expiresAt: "2026-07-25T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingArenaScanInput> = {},
): BreedingArenaScanInput {
  return {
    evaluatedAt: "2026-07-23T00:00:00Z",
    snapshots: [snapshot()],
    ...overrides,
  };
}

describe("breeding Arena scanner", () => {
  it("returns historical candidates from one current accepted snapshot", () => {
    const result = scanBreedingArena(input());
    expect(result.status).toBe("ready_for_review");
    expect(result.listings[0]).toEqual(
      expect.objectContaining({
        sourceCoreId: "core-1",
        exactUsdPrice: "3.25",
        status: "historical_candidate",
        liveConfirmationRequired: true,
      }),
    );
    expect(result.liveStateClaimed).toBe(false);
    expect(result.incomeInferred).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("does not substitute a newer quarantined snapshot", () => {
    const result = scanBreedingArena(
      input({
        snapshots: [
          snapshot(),
          snapshot({
            snapshotId: "arena-2",
            selected: false,
            status: "quarantined",
            lastImported: "2026-07-22T12:00:00Z",
          }),
        ],
      }),
    );
    expect(result.snapshot?.snapshotId).toBe("arena-1");
  });

  it("returns not available without one selected accepted snapshot", () => {
    const result = scanBreedingArena(
      input({ snapshots: [snapshot({ selected: false })] }),
    );
    expect(result.status).toBe("not_available");
    expect(result.warnings).toContain("NO_SELECTED_ACCEPTED_SNAPSHOT");
  });

  it("rejects multiple current accepted snapshots", () => {
    expect(() =>
      scanBreedingArena(
        input({
          snapshots: [snapshot(), snapshot({ snapshotId: "arena-2" })],
        }),
      ),
    ).toThrow("Only one accepted");
  });

  it("holds unresolved identity without inferring by name", () => {
    const result = scanBreedingArena(
      input({
        snapshots: [
          snapshot({
            listings: [
              {
                listingId: "listing-1",
                sourceCoreId: null,
                identityStatus: "unmatched",
                exactUsdPrice: "3.25",
                remainingSplices: 2,
                expiresAt: "2026-07-25T00:00:00Z",
              },
            ],
          }),
        ],
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.listings[0]?.status).toBe("review_required");
    expect(result.warnings).toContain("IDENTITY_UNRESOLVED");
  });

  it("keeps expiry and capacity explicit", () => {
    const expired = scanBreedingArena(
      input({
        snapshots: [
          snapshot({
            listings: [
              {
                listingId: "listing-1",
                sourceCoreId: "core-1",
                identityStatus: "exact",
                exactUsdPrice: "3.25",
                remainingSplices: 0,
                expiresAt: "2026-07-22T00:00:00Z",
              },
            ],
          }),
        ],
      }),
    );
    expect(expired.listings[0]?.status).toBe("expired");
    expect(expired.warnings).toContain("LISTING_EXPIRED");

    const unknown = scanBreedingArena(
      input({
        snapshots: [
          snapshot({
            listings: [
              {
                listingId: "listing-1",
                sourceCoreId: "core-1",
                identityStatus: "exact",
                exactUsdPrice: "3.25",
                remainingSplices: null,
                expiresAt: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(unknown.warnings).toEqual(
      expect.arrayContaining([
        "SPLICE_CAPACITY_UNKNOWN",
        "LISTING_EXPIRY_UNKNOWN",
      ]),
    );
  });

  it("fails closed on stale snapshot evidence", () => {
    const result = scanBreedingArena(
      input({ snapshots: [snapshot({ freshness: "stale" })] }),
    );
    expect(result.status).toBe("review_required");
    expect(result.warnings).toContain("SNAPSHOT_STALE");
  });

  it("rejects duplicate listing IDs and inconsistent identity", () => {
    const listing = snapshot().listings[0]!;
    expect(() =>
      scanBreedingArena(
        input({
          snapshots: [snapshot({ listings: [listing, { ...listing }] })],
        }),
      ),
    ).toThrow("unique");
    expect(() =>
      scanBreedingArena(
        input({
          snapshots: [
            snapshot({
              listings: [{ ...listing, identityStatus: "ambiguous" }],
            }),
          ],
        }),
      ),
    ).toThrow("Only an exact");
  });

  it("preserves exact price semantics", () => {
    for (const exactUsdPrice of ["-1", "NaN", "1.1234567890123456789"]) {
      expect(() =>
        scanBreedingArena(
          input({
            snapshots: [
              snapshot({
                listings: [{ ...snapshot().listings[0]!, exactUsdPrice }],
              }),
            ],
          }),
        ),
      ).toThrow("exact decimal");
    }
  });

  it("keeps current-through and last-imported ordered and separate", () => {
    expect(() =>
      scanBreedingArena(
        input({
          snapshots: [
            snapshot({
              dataCurrentThrough: "2026-07-22T02:00:00Z",
              lastImported: "2026-07-22T01:00:00Z",
            }),
          ],
        }),
      ),
    ).toThrow("cannot precede");
  });
});
