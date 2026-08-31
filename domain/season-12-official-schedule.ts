import type { TournamentMode } from "@/domain/tournament-configuration";

export const season12DistanceCodes = [10, 12, 14, 16, 18, 20, 22] as const;
export type Season12DistanceCode = (typeof season12DistanceCodes)[number];

export type Season12DistanceAuthority =
  | Readonly<{ kind: "all" }>
  | Readonly<{
      kind: "listed";
      publishedCodes: readonly Season12DistanceCode[];
      metres: readonly number[];
    }>
  | Readonly<{ kind: "unspecified" }>;

export type Season12Eligibility = "all" | "spliced" | "unspecified";
export type Season12PublishedDay = "Mon" | "Thurs";

export type Season12OfficialScheduleEntry = Readonly<{
  date: string;
  publishedDay: Season12PublishedDay;
  event: string;
  mode: TournamentMode | null;
  distances: Season12DistanceAuthority;
  eligibility: Season12Eligibility;
}>;

export const season12OfficialScheduleAuthority = Object.freeze({
  season: 12,
  year: 2026,
  status: "official_owner_supplied_image" as const,
  receivedAt: "2026-08-31",
  sourceImageSha256:
    "c6d9c1f38bff8cab308a119c89e1899215dcb74dd86a2de5e2bfc70f6f734516",
  yearAuthority:
    "Current Season 12 context plus exact agreement between every published date and weekday.",
  scope:
    "Calendar date, published weekday, event name, mode, distance notation and eligibility only.",
  configurationBoundary:
    "This schedule does not establish gate counts, entry fees, qualification windows, leaderboard groups, scoring or Side Event rules.",
});

const distanceCodeSet = new Set<number>(season12DistanceCodes);
const publishedDayByUtcDay = new Map<number, Season12PublishedDay>([
  [1, "Mon"],
  [4, "Thurs"],
]);

function listed(
  ...publishedCodes: readonly Season12DistanceCode[]
): Season12DistanceAuthority {
  return Object.freeze({
    kind: "listed",
    publishedCodes: Object.freeze([...publishedCodes]),
    metres: Object.freeze(publishedCodes.map((code) => code * 100)),
  });
}

function defineEntry(
  entry: Season12OfficialScheduleEntry,
): Season12OfficialScheduleEntry {
  const date = new Date(`${entry.date}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== entry.date ||
    date.getUTCFullYear() !== season12OfficialScheduleAuthority.year
  ) {
    throw new Error(`Season 12 schedule date is invalid: ${entry.date}.`);
  }
  if (publishedDayByUtcDay.get(date.getUTCDay()) !== entry.publishedDay) {
    throw new Error(
      `Season 12 schedule weekday does not match ${entry.date}: ${entry.publishedDay}.`,
    );
  }
  if (entry.event.trim() === "") {
    throw new Error("Season 12 schedule event is required.");
  }
  if (entry.distances.kind === "listed") {
    if (
      entry.distances.publishedCodes.length === 0 ||
      new Set(entry.distances.publishedCodes).size !==
        entry.distances.publishedCodes.length ||
      entry.distances.publishedCodes.some((code) => !distanceCodeSet.has(code))
    ) {
      throw new Error(
        `Season 12 schedule distances are invalid for ${entry.event}.`,
      );
    }
    const expectedMetres = entry.distances.publishedCodes.map(
      (code) => code * 100,
    );
    if (
      JSON.stringify(entry.distances.metres) !== JSON.stringify(expectedMetres)
    ) {
      throw new Error(
        `Season 12 normalized distances do not match ${entry.event}.`,
      );
    }
  }
  return Object.freeze(entry);
}

export const season12OfficialSchedule = Object.freeze([
  defineEntry({
    date: "2026-09-14",
    publishedDay: "Mon",
    event: "Splice 1",
    mode: "car",
    distances: Object.freeze({ kind: "all" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-09-17",
    publishedDay: "Thurs",
    event: "Spin Battles",
    mode: "horse",
    distances: listed(10, 16, 20),
    eligibility: "spliced",
  }),
  defineEntry({
    date: "2026-09-21",
    publishedDay: "Mon",
    event: "Spin Battles",
    mode: "car",
    distances: listed(12, 18, 22),
    eligibility: "spliced",
  }),
  defineEntry({
    date: "2026-09-24",
    publishedDay: "Thurs",
    event: "Side Event",
    mode: null,
    distances: Object.freeze({ kind: "unspecified" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-09-28",
    publishedDay: "Mon",
    event: "Spin Battles",
    mode: "bike",
    distances: listed(10, 18, 22),
    eligibility: "all",
  }),
  defineEntry({
    date: "2026-10-01",
    publishedDay: "Thurs",
    event: "Side Event",
    mode: null,
    distances: Object.freeze({ kind: "unspecified" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-10-05",
    publishedDay: "Mon",
    event: "Splice 2",
    mode: "horse",
    distances: Object.freeze({ kind: "all" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-10-08",
    publishedDay: "Thurs",
    event: "1v1 Wars",
    mode: "car",
    distances: listed(12, 16, 20),
    eligibility: "all",
  }),
  defineEntry({
    date: "2026-10-12",
    publishedDay: "Mon",
    event: "1v1 Wars",
    mode: "bike",
    distances: listed(10, 16, 22),
    eligibility: "spliced",
  }),
  defineEntry({
    date: "2026-10-15",
    publishedDay: "Thurs",
    event: "Side Event",
    mode: null,
    distances: Object.freeze({ kind: "unspecified" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-10-19",
    publishedDay: "Mon",
    event: "1v1 Wars",
    mode: "horse",
    distances: listed(10, 14, 22),
    eligibility: "all",
  }),
  defineEntry({
    date: "2026-10-22",
    publishedDay: "Thurs",
    event: "Side Event",
    mode: null,
    distances: Object.freeze({ kind: "unspecified" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-10-26",
    publishedDay: "Mon",
    event: "Splice 3",
    mode: "bike",
    distances: Object.freeze({ kind: "all" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-10-29",
    publishedDay: "Thurs",
    event: "Double Up",
    mode: "car",
    distances: listed(12, 16, 20),
    eligibility: "spliced",
  }),
  defineEntry({
    date: "2026-11-02",
    publishedDay: "Mon",
    event: "Double Up",
    mode: "horse",
    distances: listed(12, 16, 22),
    eligibility: "all",
  }),
  defineEntry({
    date: "2026-11-05",
    publishedDay: "Thurs",
    event: "Side Event",
    mode: null,
    distances: Object.freeze({ kind: "unspecified" }),
    eligibility: "unspecified",
  }),
  defineEntry({
    date: "2026-11-09",
    publishedDay: "Mon",
    event: "Double Up",
    mode: "bike",
    distances: listed(10, 14, 20),
    eligibility: "all",
  }),
] satisfies readonly Season12OfficialScheduleEntry[]);

/** Entries with enough published calendar detail to prefill mode, distance and eligibility review. */
export const season12DetailedCompetitionEntries = Object.freeze(
  season12OfficialSchedule.filter(
    (entry) =>
      entry.mode !== null &&
      entry.distances.kind === "listed" &&
      entry.eligibility !== "unspecified",
  ),
);
