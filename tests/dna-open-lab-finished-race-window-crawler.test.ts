import { describe, expect, it, vi } from "vitest";

import {
  crawlDnaFinishedRaceWindows,
  DNA_FINISHED_RACE_WINDOW_LIMIT,
  type DnaFinishedRaceWindowFetch,
} from "../lib/dna-open-lab-finished-race-window-crawler";
import type { DnaRaceDocument } from "../lib/dna-open-lab-v1-client";

function race(
  rid: number,
  extra: Record<string, unknown> = {},
): DnaRaceDocument {
  return { rid, ...extra };
}

function saturated(): readonly DnaRaceDocument[] {
  return Array.from({ length: DNA_FINISHED_RACE_WINDOW_LIMIT }, (_, index) =>
    race(index + 1),
  );
}

describe("DNA Open Lab finished-race window crawler", () => {
  it("accepts a non-saturated window as complete in one request", async () => {
    const fetchWindow = vi.fn(async () => [race(10), race(2)]);

    const result = await crawlDnaFinishedRaceWindows({
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-02T00:00:00Z",
      fetchWindow,
    });

    expect(fetchWindow).toHaveBeenCalledTimes(1);
    expect(fetchWindow).toHaveBeenCalledWith({
      startTime: "2026-08-01T00:00:00.000Z",
      endTime: "2026-08-02T00:00:00.000Z",
      limit: 200,
    });
    expect(result.races.map((entry) => entry.rid)).toEqual([2, 10]);
    expect(result.requestCount).toBe(1);
    expect(result.splitCount).toBe(0);
    expect(result.completedWindows).toHaveLength(1);
  });

  it("splits a saturated window and deduplicates the deliberate midpoint overlap", async () => {
    const rootStart = "2026-08-01T00:00:00.000Z";
    const midpoint = "2026-08-01T00:00:05.000Z";
    const rootEnd = "2026-08-01T00:00:10.000Z";
    const fetchWindow = vi.fn(async (window) => {
      if (window.startTime === rootStart && window.endTime === rootEnd) {
        return saturated();
      }
      if (window.startTime === rootStart && window.endTime === midpoint) {
        return [race(1), race(2, { stable: true })];
      }
      if (window.startTime === midpoint && window.endTime === rootEnd) {
        return [race(2, { stable: true }), race(3)];
      }
      throw new Error(
        `unexpected window ${window.startTime} ${window.endTime}`,
      );
    }) as DnaFinishedRaceWindowFetch;

    const result = await crawlDnaFinishedRaceWindows({
      startTime: rootStart,
      endTime: rootEnd,
      fetchWindow,
    });

    expect(result.requestCount).toBe(3);
    expect(result.splitCount).toBe(1);
    expect(result.races.map((entry) => entry.rid)).toEqual([1, 2, 3]);
    expect(result.completedWindows).toEqual([
      { startTime: rootStart, endTime: midpoint },
      { startTime: midpoint, endTime: rootEnd },
    ]);
  });

  it("recursively splits saturated child windows until every accepted window is below the cap", async () => {
    const fetchWindow = vi.fn(async (window) => {
      const width = Date.parse(window.endTime) - Date.parse(window.startTime);
      if (width > 2_500) return saturated();
      return [
        race(Math.floor(Date.parse(window.startTime) / 1_000) + 1, {
          window: window.startTime,
        }),
      ];
    }) as DnaFinishedRaceWindowFetch;

    const result = await crawlDnaFinishedRaceWindows({
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-01T00:00:10Z",
      fetchWindow,
    });

    expect(result.splitCount).toBe(3);
    expect(result.requestCount).toBe(7);
    expect(result.completedWindows).toHaveLength(4);
    expect(result.races).toHaveLength(4);
  });

  it("subdivides a recoverably unreadable window without omitting its surrounding races", async () => {
    const rootStart = "2026-08-01T00:00:00.000Z";
    const midpoint = "2026-08-01T00:00:05.000Z";
    const rootEnd = "2026-08-01T00:00:10.000Z";
    const recoverable = new Error("private malformed envelope");
    const fetchWindow = vi.fn(async (window) => {
      if (window.startTime === rootStart && window.endTime === rootEnd) {
        throw recoverable;
      }
      if (window.endTime === midpoint) return [race(1), race(2)];
      return [race(2), race(3)];
    }) as DnaFinishedRaceWindowFetch;

    const result = await crawlDnaFinishedRaceWindows({
      startTime: rootStart,
      endTime: rootEnd,
      fetchWindow,
      splitOnFetchError: (error) => error === recoverable,
    });

    expect(fetchWindow).toHaveBeenCalledTimes(3);
    expect(result.requestCount).toBe(3);
    expect(result.splitCount).toBe(1);
    expect(result.races.map((entry) => entry.rid)).toEqual([1, 2, 3]);
    expect(result.completedWindows).toEqual([
      { startTime: rootStart, endTime: midpoint },
      { startTime: midpoint, endTime: rootEnd },
    ]);
  });

  it("does not subdivide an unclassified fetch failure", async () => {
    const failure = new Error("do not retry");
    const fetchWindow = vi.fn(async () => {
      throw failure;
    }) as DnaFinishedRaceWindowFetch;

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00Z",
        endTime: "2026-08-01T00:00:10Z",
        fetchWindow,
        splitOnFetchError: () => false,
      }),
    ).rejects.toBe(failure);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a recoverably unreadable window cannot be subdivided", async () => {
    const fetchWindow = vi.fn(async () => {
      throw new Error("private malformed envelope");
    }) as DnaFinishedRaceWindowFetch;

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:00.001Z",
        minimumWindowMilliseconds: 1,
        fetchWindow,
        splitOnFetchError: () => true,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceWindowCrawlerError",
      kind: "unprovable_fetch_failure",
    });
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });

  it("fails closed if the source exceeds its documented 200-row response limit", async () => {
    const fetchWindow = vi.fn(async () =>
      Array.from({ length: 201 }, (_, index) => race(index + 1)),
    ) as DnaFinishedRaceWindowFetch;

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00Z",
        endTime: "2026-08-01T00:01:00Z",
        fetchWindow,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceWindowCrawlerError",
      kind: "source_limit_breach",
    });
  });

  it("fails closed with a typed error when a finished-race row has no stable identifier", async () => {
    const fetchWindow = vi.fn(async () => [
      { rid: null } as unknown as DnaRaceDocument,
    ]);

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00Z",
        endTime: "2026-08-02T00:00:00Z",
        fetchWindow,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceWindowCrawlerError",
      kind: "invalid_record",
    });
  });

  it("counts identity-conflicted leaf observations conservatively when explicitly requested", async () => {
    const fetchWindow = vi.fn(async () => [
      race(7),
      { rid: null } as unknown as DnaRaceDocument,
      { value: "unidentified" } as unknown as DnaRaceDocument,
    ]);

    const result = await crawlDnaFinishedRaceWindows({
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-02T00:00:00Z",
      fetchWindow,
      invalidRecordHandling: "count_as_unresolved_observation",
    });

    expect(result.races.map((entry) => entry.rid)).toEqual([7]);
    expect(result.unresolvedIdentityObservationUpperBound).toBe(2);
  });

  it("fails closed when a minimum-width window is still saturated", async () => {
    const fetchWindow = vi.fn(async () =>
      saturated(),
    ) as DnaFinishedRaceWindowFetch;

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:00.001Z",
        minimumWindowMilliseconds: 1,
        fetchWindow,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceWindowCrawlerError",
      kind: "unprovable_saturation",
    });
  });

  it("fails closed if overlapping windows return conflicting payloads for the same race id", async () => {
    const rootStart = "2026-08-01T00:00:00.000Z";
    const midpoint = "2026-08-01T00:00:05.000Z";
    const rootEnd = "2026-08-01T00:00:10.000Z";
    const fetchWindow = vi.fn(async (window) => {
      if (window.startTime === rootStart && window.endTime === rootEnd) {
        return saturated();
      }
      if (window.endTime === midpoint) return [race(7, { version: "left" })];
      return [race(7, { version: "right" })];
    }) as DnaFinishedRaceWindowFetch;

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: rootStart,
        endTime: rootEnd,
        fetchWindow,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceWindowCrawlerError",
      kind: "conflicting_duplicate",
      message: expect.stringContaining("race 7"),
    });
  });

  it("rejects invalid chronology and minimum-window configuration before any fetch", async () => {
    const fetchWindow = vi.fn(async () => [] as readonly DnaRaceDocument[]);

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-02T00:00:00Z",
        endTime: "2026-08-01T00:00:00Z",
        fetchWindow,
      }),
    ).rejects.toMatchObject({ kind: "invalid_window" });

    await expect(
      crawlDnaFinishedRaceWindows({
        startTime: "2026-08-01T00:00:00Z",
        endTime: "2026-08-02T00:00:00Z",
        minimumWindowMilliseconds: 0,
        fetchWindow,
      }),
    ).rejects.toMatchObject({ kind: "invalid_window" });

    expect(fetchWindow).not.toHaveBeenCalled();
  });
});
