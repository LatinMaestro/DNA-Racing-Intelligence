import type { OwnedBikeFinish } from "@/domain/pro-league-owned-bike-pace";

const LEAGUE_DISTANCES = new Set([10, 12, 14, 16, 18, 20, 22]);

type HistoryPage = Readonly<{ page: number; rows: readonly unknown[] }>;

export type OwnedBikeHistory = Readonly<{
  coreId: string;
  allModeRows: number;
  bikeRows: number;
  outsideLeagueDistance: number;
  notFinished: number;
  finishes: readonly OwnedBikeFinish[];
}>;

/** Accepts only consecutive pages ending in an explicit empty terminal page. */
export function normalizeOwnedBikeHistory(input: {
  coreId: string;
  pages: readonly HistoryPage[];
}): OwnedBikeHistory {
  if (!/^[1-9]\d*$/u.test(input.coreId) || input.pages.length < 1) {
    throw new Error("Bike history identity or pages are invalid.");
  }
  const seen = new Set<string>();
  const finishes: OwnedBikeFinish[] = [];
  let allModeRows = 0;
  let bikeRows = 0;
  let outsideLeagueDistance = 0;
  let notFinished = 0;

  for (const [index, page] of input.pages.entries()) {
    if (
      page.page !== index + 1 ||
      !Array.isArray(page.rows) ||
      page.rows.length > 50
    ) {
      throw new Error(
        "Bike history page is missing, out of order or oversized.",
      );
    }
    if (index === input.pages.length - 1 && page.rows.length !== 0) {
      throw new Error("Bike history requires an explicit empty terminal page.");
    }
    if (index < input.pages.length - 1 && page.rows.length === 0) {
      throw new Error("Bike history has rows after its terminal page.");
    }
    for (const value of page.rows) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Bike history entry is invalid.");
      }
      const row = value as Record<string, unknown>;
      if (String(row.hid) !== input.coreId) {
        throw new Error(
          "Bike history entry does not belong to the owned Core.",
        );
      }
      allModeRows += 1;
      if (row.rvmode !== "bike") continue;
      bikeRows += 1;
      if (row.status !== "finished") {
        notFinished += 1;
        continue;
      }
      if (
        !(
          typeof row.rid === "number" &&
          Number.isSafeInteger(row.rid) &&
          row.rid > 0
        ) &&
        !(typeof row.rid === "string" && /^[1-9]\d*$/u.test(row.rid))
      ) {
        throw new Error("Finished Bike race identity is invalid.");
      }
      const raceId = String(row.rid);
      if (!raceId || seen.has(raceId)) {
        throw new Error("Finished Bike race identity is duplicate or empty.");
      }
      seen.add(raceId);
      const cb =
        typeof row.cb === "number"
          ? row.cb
          : typeof row.cb === "string" &&
              /^(10|12|14|16|18|20|22)$/u.test(row.cb)
            ? Number(row.cb)
            : null;
      if (cb === null || !LEAGUE_DISTANCES.has(cb)) {
        outsideLeagueDistance += 1;
        continue;
      }
      const elapsedSeconds = row.time;
      const completedAt = row.end_time;
      if (
        typeof elapsedSeconds !== "number" ||
        !Number.isFinite(elapsedSeconds) ||
        elapsedSeconds <= 0 ||
        typeof completedAt !== "string" ||
        !Number.isFinite(Date.parse(completedAt))
      ) {
        throw new Error(
          "Finished Bike race has invalid elapsed time or completion date.",
        );
      }
      const elapsedTimeMilliseconds = Math.round(elapsedSeconds * 1000);
      if (
        !Number.isSafeInteger(elapsedTimeMilliseconds) ||
        elapsedTimeMilliseconds < 1
      ) {
        throw new Error("Finished Bike race elapsed milliseconds are invalid.");
      }
      finishes.push(
        Object.freeze({
          distanceMetres: cb * 100,
          elapsedTimeMilliseconds,
          completedAt: new Date(completedAt).toISOString(),
          source: "bike_history" as const,
        }),
      );
    }
  }
  return Object.freeze({
    coreId: input.coreId,
    allModeRows,
    bikeRows,
    outsideLeagueDistance,
    notFinished,
    finishes: Object.freeze(finishes),
  });
}
