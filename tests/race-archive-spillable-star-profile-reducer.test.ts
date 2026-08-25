import { describe, expect, it } from "vitest";

import {
  refreshStarProfiles,
  type CoreStarProfile,
  type StarProfileEvent,
} from "../domain/star-signals";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import {
  decodeRaceArchiveStarProfileContributionLine,
  encodeRaceArchiveStarProfileContribution,
  spillableStarProfilesFromEvents,
} from "../lib/race-archive-spillable-star-profile-reducer";

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records: source }) {
      if (runs.has(runId)) throw new Error("test run conflict");
      const values: T[] = [];
      for await (const value of source) values.push(value);
      if (values.length < 1) throw new Error("test run cannot be empty");
      runs.set(runId, Object.freeze(values));
    },
    readRun({ runId }) {
      const values = runs.get(runId);
      if (values === undefined) throw new Error("test run unavailable");
      return records(values);
    },
    async deleteRun({ runId }) {
      runs.delete(runId);
    },
  });
  return { store, runs };
}

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

const EVENTS = Object.freeze<readonly StarProfileEvent[]>([
  Object.freeze({
    eventId: "event-001",
    eventAt: "2026-08-01T00:00:00Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    entries: Object.freeze([
      Object.freeze({
        coreId: "core-a",
        goldStar: true,
        blueStar: true,
        starDataStatus: "complete",
      }),
      Object.freeze({
        coreId: "core-b",
        goldStar: false,
        blueStar: false,
        starDataStatus: "complete",
      }),
    ]),
  }),
  Object.freeze({
    eventId: "event-002",
    eventAt: "2026-08-02T00:00:00Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    entries: Object.freeze([
      Object.freeze({
        coreId: "core-a",
        goldStar: false,
        blueStar: false,
        starDataStatus: "complete",
      }),
      Object.freeze({
        coreId: "core-b",
        goldStar: true,
        blueStar: true,
        starDataStatus: "complete",
      }),
    ]),
  }),
  Object.freeze({
    eventId: "event-003",
    eventAt: "2026-08-03T00:00:00Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    entries: Object.freeze([
      Object.freeze({
        coreId: "core-a",
        goldStar: true,
        blueStar: false,
        starDataStatus: "complete",
      }),
      Object.freeze({
        coreId: "core-b",
        goldStar: true,
        blueStar: true,
        starDataStatus: "complete",
      }),
    ]),
  }),
  Object.freeze({
    eventId: "event-004",
    eventAt: "2026-08-04T00:00:00Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    entries: Object.freeze([
      Object.freeze({
        coreId: "core-a",
        goldStar: null,
        blueStar: null,
        starDataStatus: "missing",
      }),
      Object.freeze({
        coreId: "core-b",
        goldStar: false,
        blueStar: false,
        starDataStatus: "partial",
      }),
    ]),
  }),
  Object.freeze({
    eventId: "event-005",
    eventAt: "2026-08-05T00:00:00Z",
    mode: "car",
    distance: 1200,
    gateCount: 3,
    entries: Object.freeze([
      Object.freeze({
        coreId: "core-a",
        goldStar: true,
        blueStar: true,
        starDataStatus: "complete",
      }),
      Object.freeze({
        coreId: "core-c",
        goldStar: false,
        blueStar: false,
        starDataStatus: "complete",
      }),
    ]),
  }),
]);

describe("spillable Race archive star-profile reducer", () => {
  it("matches resident event validations and lifetime Core profiles across forced spill/merge runs", async () => {
    const expected = refreshStarProfiles(EVENTS);
    const scratch = memoryStore<CoreStarProfile>();
    const validations: unknown[] = [];
    const spillable = await spillableStarProfilesFromEvents({
      events: records(EVENTS),
      store: scratch.store,
      runPrefix: "test/star-profiles",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
      maximumContributions: 100,
      maximumRunObjects: 100,
      maximumProfiles: 20,
      onEventValidation(validation) {
        validations.push(validation);
      },
    });

    expect(spillable.validatedEventCount).toBe(EVENTS.length);
    expect(spillable.contributionCount).toBe(
      EVENTS.reduce(
        (count, event) =>
          count + new Set(event.entries.map(({ coreId }) => coreId)).size,
        0,
      ),
    );
    expect(spillable.initialRunCount).toBeGreaterThan(1);
    expect(validations).toEqual(expected.eventValidations);
    expect(await collect(spillable.readProfiles())).toEqual(expected.profiles);
    expect(scratch.runs.size).toBe(0);
  });

  it("round-trips a single-event contribution exactly", () => {
    const contribution = refreshStarProfiles([EVENTS[0]!]).profiles[0]!;
    const encoded = encodeRaceArchiveStarProfileContribution(contribution);
    expect(new TextDecoder().decode(encoded).endsWith("\n")).toBe(true);
    expect(
      decodeRaceArchiveStarProfileContributionLine(
        new TextDecoder().decode(encoded).trimEnd(),
      ),
    ).toEqual(contribution);
  });

  it("rejects duplicate or unordered events before publishing profiles", async () => {
    for (const fixture of [
      [EVENTS[0]!, EVENTS[0]!],
      [EVENTS[1]!, EVENTS[0]!],
    ]) {
      const scratch = memoryStore<CoreStarProfile>();
      await expect(
        spillableStarProfilesFromEvents({
          events: records(fixture),
          store: scratch.store,
          runPrefix: "test/star-order",
          maximumRecordsInMemory: 1,
          mergeFanIn: 2,
          maximumEvents: 10,
          maximumEntriesPerEvent: 20,
          maximumContributions: 100,
          maximumRunObjects: 100,
          maximumProfiles: 20,
        }),
      ).rejects.toThrow(
        "Race archive star events are duplicated or not ordered.",
      );
      expect(scratch.runs.size).toBe(0);
    }
  });

  it("enforces event, per-event contribution and final-profile bounds with cleanup", async () => {
    const eventScratch = memoryStore<CoreStarProfile>();
    await expect(
      spillableStarProfilesFromEvents({
        events: records(EVENTS.slice(0, 2)),
        store: eventScratch.store,
        runPrefix: "test/star-event-bound",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumEvents: 1,
        maximumEntriesPerEvent: 20,
        maximumContributions: 100,
        maximumRunObjects: 100,
        maximumProfiles: 20,
      }),
    ).rejects.toThrow("Race archive star event bound was exceeded.");
    expect(eventScratch.runs.size).toBe(0);

    const entryScratch = memoryStore<CoreStarProfile>();
    await expect(
      spillableStarProfilesFromEvents({
        events: records([EVENTS[0]!]),
        store: entryScratch.store,
        runPrefix: "test/star-entry-bound",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumEvents: 10,
        maximumEntriesPerEvent: 1,
        maximumContributions: 100,
        maximumRunObjects: 100,
        maximumProfiles: 20,
      }),
    ).rejects.toThrow("Race archive star event-entry bound was exceeded.");
    expect(entryScratch.runs.size).toBe(0);

    const contributionScratch = memoryStore<CoreStarProfile>();
    await expect(
      spillableStarProfilesFromEvents({
        events: records([EVENTS[0]!]),
        store: contributionScratch.store,
        runPrefix: "test/star-contribution-bound",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumEvents: 10,
        maximumEntriesPerEvent: 20,
        maximumContributions: 1,
        maximumRunObjects: 100,
        maximumProfiles: 20,
      }),
    ).rejects.toThrow("Race archive star contribution bound was exceeded.");
    expect(contributionScratch.runs.size).toBe(0);

    const profileScratch = memoryStore<CoreStarProfile>();
    const source = await spillableStarProfilesFromEvents({
      events: records(EVENTS),
      store: profileScratch.store,
      runPrefix: "test/star-profile-bound",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
      maximumContributions: 100,
      maximumRunObjects: 100,
      maximumProfiles: 1,
    });
    await expect(collect(source.readProfiles())).rejects.toThrow(
      "Race archive star profile bound was exceeded.",
    );
    expect(profileScratch.runs.size).toBe(0);
  });

  it("cleans sorted contributions when the consumer terminates early", async () => {
    const scratch = memoryStore<CoreStarProfile>();
    const source = await spillableStarProfilesFromEvents({
      events: records(EVENTS),
      store: scratch.store,
      runPrefix: "test/star-early-return",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
      maximumContributions: 100,
      maximumRunObjects: 100,
      maximumProfiles: 20,
    });
    const iterator = source.readProfiles()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.();
    expect(scratch.runs.size).toBe(0);
  });

  it("rejects contribution codec drift in count and rate evidence", () => {
    const contribution = refreshStarProfiles([EVENTS[0]!]).profiles[0]!;
    expect(() =>
      decodeRaceArchiveStarProfileContributionLine(
        JSON.stringify({ ...contribution, raceCount: 2 }),
      ),
    ).toThrow(
      "Race archive star contribution must describe exactly one event.",
    );
    expect(() =>
      decodeRaceArchiveStarProfileContributionLine(
        JSON.stringify({
          ...contribution,
          goldReceivedRate: {
            ...contribution.goldReceivedRate,
            numerator: 999,
          },
        }),
      ),
    ).toThrow("Race archive star contribution rate evidence changed.");
  });
});
