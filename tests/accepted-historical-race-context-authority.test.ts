import { describe, expect, it, vi } from "vitest";

import {
  acceptedHistoricalRaceContextRowSha256,
  createAcceptedHistoricalRaceContextAuthority,
  type AcceptedHistoricalRaceContextStoredRow,
  type AcceptedHistoricalRaceContextStoredSelection,
} from "@/lib/accepted-historical-race-context-authority";
import type { AcceptedHistoricalRaceContextPointer } from "@/lib/selected-core-open-race-history-boundary";

const generation = "a".repeat(64);
const observations = "b".repeat(64);
const identity = "c".repeat(64);
const evidence = "d".repeat(64);
const cutoff = "2026-10-18T00:00:00.000Z";

const pointer: AcceptedHistoricalRaceContextPointer = {
  historyGenerationVersion: generation,
  observationSetSha256: observations,
  historicalAggregateVersion: "aggregate-v7",
  contextSourceIdentitySha256: identity,
};

function row(
  eventId: string,
  change: Partial<AcceptedHistoricalRaceContextStoredRow> = {},
): AcceptedHistoricalRaceContextStoredRow {
  const value = {
    eventId,
    competition: "normal" as const,
    element: { status: "not_applicable" as const, value: null },
    evidenceSha256: evidence,
    ...change,
  };
  return {
    ...value,
    rowSha256:
      change.rowSha256 ?? acceptedHistoricalRaceContextRowSha256(value),
  };
}

function selection(
  change: Partial<AcceptedHistoricalRaceContextStoredSelection> = {},
): AcceptedHistoricalRaceContextStoredSelection {
  return {
    authenticatedOwnerId: "owner-1",
    ...pointer,
    evidenceCutoff: cutoff,
    publicationState: "accepted",
    requestedEventIds: ["race-1", "race-2"],
    truncated: false,
    rows: [row("race-1"), row("race-2")],
    ...change,
  };
}

function harness(
  stored: AcceptedHistoricalRaceContextStoredSelection | null = selection(),
) {
  const readActivePointerByOwner = vi.fn(async () => pointer);
  const readPublishedContextsByOwner = vi.fn(async () => stored);
  const authority = createAcceptedHistoricalRaceContextAuthority({
    configuredOwnerId: "owner-1",
    repository: {
      readActivePointerByOwner,
      readPublishedContextsByOwner,
    },
  });
  const request = {
    historyGenerationVersion: generation,
    observationSetSha256: observations,
    historicalAggregateVersion: "aggregate-v7",
    evidenceCutoff: cutoff,
    requestedEventIds: ["race-1", "race-2"],
  };
  return {
    authority,
    request,
    readActivePointerByOwner,
    readPublishedContextsByOwner,
  };
}

describe("accepted historical Race context authority", () => {
  it("returns only digest-verified accepted rows bound to the active aggregate", async () => {
    const test = harness();
    await expect(
      test.authority.loadAcceptedRaceContextsByOwner("owner-1", test.request),
    ).resolves.toEqual({
      authenticatedOwnerId: "owner-1",
      historyGenerationVersion: generation,
      observationSetSha256: observations,
      historicalAggregateVersion: "aggregate-v7",
      evidenceCutoff: cutoff,
      contextSourceIdentitySha256: identity,
      state: "accepted",
      requestedEventIds: ["race-1", "race-2"],
      contexts: [
        {
          eventId: "race-1",
          competition: "normal",
          element: { status: "not_applicable", value: null },
          evidenceSha256: evidence,
        },
        {
          eventId: "race-2",
          competition: "normal",
          element: { status: "not_applicable", value: null },
          evidenceSha256: evidence,
        },
      ],
    });
    expect(test.readPublishedContextsByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ maximumRows: 2 }),
    );
    expect(test.readActivePointerByOwner).toHaveBeenCalledTimes(2);
  });

  it("keeps incomplete or unknown publication coverage non-analytical", async () => {
    const partial = harness(
      selection({ publicationState: "accepted", rows: [row("race-1")] }),
    );
    await expect(
      partial.authority.loadAcceptedRaceContextsByOwner(
        "owner-1",
        partial.request,
      ),
    ).resolves.toMatchObject({
      state: "partial",
      contexts: [{ eventId: "race-1" }],
    });

    const unknown = harness(
      selection({ publicationState: "unknown", rows: [] }),
    );
    await expect(
      unknown.authority.loadAcceptedRaceContextsByOwner(
        "owner-1",
        unknown.request,
      ),
    ).resolves.toMatchObject({ state: "unknown", contexts: [] });
  });

  it("rejects tampered rows, truncation and cross-owner access", async () => {
    const tampered = harness(
      selection({ rows: [row("race-1", { rowSha256: "e".repeat(64) })] }),
    );
    await expect(
      tampered.authority.loadAcceptedRaceContextsByOwner(
        "owner-1",
        tampered.request,
      ),
    ).rejects.toThrow("authority is unavailable");

    const truncated = harness(selection({ truncated: true }));
    await expect(
      truncated.authority.loadAcceptedRaceContextsByOwner(
        "owner-1",
        truncated.request,
      ),
    ).rejects.toThrow("authority is unavailable");

    const owner = harness();
    await expect(
      owner.authority.loadAcceptedRaceContextsByOwner("owner-2", owner.request),
    ).rejects.toThrow("authority is unavailable");
    expect(owner.readActivePointerByOwner).not.toHaveBeenCalled();
  });

  it("returns unavailable when the active pointer changes before or after the read", async () => {
    const before = harness();
    await expect(
      before.authority.loadAcceptedRaceContextsByOwner("owner-1", {
        ...before.request,
        historicalAggregateVersion: "aggregate-v8",
      }),
    ).resolves.toBeNull();
    expect(before.readPublishedContextsByOwner).not.toHaveBeenCalled();

    const after = harness();
    after.readActivePointerByOwner
      .mockResolvedValueOnce(pointer)
      .mockResolvedValueOnce({
        ...pointer,
        contextSourceIdentitySha256: "f".repeat(64),
      });
    await expect(
      after.authority.loadAcceptedRaceContextsByOwner("owner-1", after.request),
    ).resolves.toBeNull();
  });
});
