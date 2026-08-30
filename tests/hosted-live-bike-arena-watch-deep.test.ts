import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_LIVE_ARENA_WATCH_DEEP === "1";
const describeConnected = enabled ? describe : describe.skip;

const TARGETS = [
  { hid: 2799, name: "Dough", distances: [1000] },
  { hid: 23062, name: "Phantom Breaker", distances: [1200, 1600, 1800, 2200] },
  { hid: 17739, name: "Swinging Sea", distances: [1200, 1600] },
  { hid: 618, name: "Brains", distances: [1400] },
  { hid: 13423, name: "Mario Kart", distances: [1400, 2200] },
  { hid: 24247, name: "Last Shot", distances: [1600] },
  { hid: 20686, name: "Cheap Challenger", distances: [1600] },
  { hid: 15466, name: "Mjölnir", distances: [1800] },
  { hid: 24799, name: "Playground", distances: [1800] },
  { hid: 8174, name: "Low on Dough", distances: [2200] },
] as const;

type AnyRecord = Record<string, any>;
type Row = Readonly<{ hid: number; distanceMetres: number; elapsedSeconds: number; speed: number; observedAt: string | null; rid: string; page: number }>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("quantile requires values");
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const w = position - lower;
  return sorted[lower]! * (1 - w) + sorted[upper]! * w;
}
function canonicalDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function normalize(hid: number, row: AnyRecord, page: number): Row | null {
  if (String(row.rvmode ?? "").toLowerCase() !== "bike") return null;
  const cb = Number(row.cb ?? 0);
  const distanceMetres = cb >= 100 ? cb : cb * 100;
  const elapsedSeconds = Number(row.time ?? row.rtime ?? row.elapsed ?? 0);
  if (!Number.isFinite(distanceMetres) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  return {
    hid,
    distanceMetres,
    elapsedSeconds,
    speed: distanceMetres / elapsedSeconds,
    observedAt: canonicalDate(row.start_time),
    rid: String(row.rid ?? row.rhid ?? `${hid}:${row.start_time ?? ""}:${distanceMetres}:${elapsedSeconds}`),
    page,
  };
}
function summarize(rows: readonly Row[]) {
  if (rows.length === 0) return null;
  const speeds = rows.map((row) => row.speed);
  const times = rows.map((row) => row.elapsedSeconds);
  const dates = rows.map((row) => row.observedAt).filter((x): x is string => x !== null).sort();
  return {
    n: rows.length,
    medianSeconds: quantile(times, 0.5),
    q20Seconds: quantile(times, 0.2),
    q80Seconds: quantile(times, 0.8),
    bestSeconds: Math.min(...times),
    worstSeconds: Math.max(...times),
    medianSpeed: quantile(speeds, 0.5),
    upperTailSpeed: quantile(speeds, 0.8),
    bestSpeed: Math.max(...speeds),
    earliest: dates[0] ?? null,
    latest: dates.at(-1) ?? null,
  };
}

describeConnected("deep live Bike Arena watch validation", () => {
  it("backfills complete reachable Bike history for the strongest Arena WATCH candidates", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let last = 0;
    let calls = 0;
    const paced = async <T>(fn: () => Promise<T>) => {
      const wait = 2100 - (Date.now() - last);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const value = await fn();
      last = Date.now();
      calls++;
      return value;
    };
    const history = async (hid: number, page: number) => paced(async () => {
      const response = await fetch("https://api.dnaracing.run/fbike/i/hraces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hid, page }),
      });
      const body: any = await response.json();
      if (!body || !Array.isArray(body.result)) throw new Error(`hraces ${hid}/${page} malformed`);
      return body.result as AnyRecord[];
    });

    const ids = TARGETS.map((x) => x.hid);
    const stats = (await paced(() => client.coreRacingStatsBulk(ids))).result;
    const powers = (await paced(() => client.corePowerBulk(ids))).result;
    const statsMap = new Map(stats.map((x: any) => [Number(x.hid), x]));
    const powerMap = new Map(powers.map((x: any) => [Number(x.hid), x]));

    const results = [] as AnyRecord[];
    for (const target of TARGETS) {
      const all: Row[] = [];
      const seen = new Set<string>();
      let pagesFetched = 0;
      for (let page = 1; page <= 30; page++) {
        const raw = await history(target.hid, page);
        pagesFetched = page;
        for (const row of raw) {
          const value = normalize(target.hid, row, page);
          if (!value) continue;
          const key = `${value.hid}|${value.rid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(value);
        }
        if (raw.length < 50) break;
      }
      const statsRow: any = statsMap.get(target.hid) ?? {};
      const bike: any = powerMap.get(target.hid)?.power?.bike ?? {};
      const metric = (v: any) => Number(v?.fill?.per ?? v?.per ?? v?.val ?? 0);
      const distances = target.distances.map((distanceMetres) => {
        const rows = all.filter((row) => row.distanceMetres === distanceMetres).sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));
        const canonicalCount = Number(statsRow?.hstats_bike?.[String(distanceMetres / 100)]?.races_n ?? 0);
        return {
          distanceMetres,
          canonicalCareerCount: Number.isFinite(canonicalCount) ? canonicalCount : 0,
          retrievedCount: rows.length,
          recentPageOne: summarize(rows.filter((row) => row.page === 1)),
          recentUpToFivePages: summarize(rows.filter((row) => row.page <= 5)),
          fullRetrieved: summarize(rows),
          rows: rows.map((row) => ({ page: row.page, elapsedSeconds: row.elapsedSeconds, observedAt: row.observedAt, rid: row.rid })),
        };
      });
      results.push({
        hid: target.hid,
        name: target.name,
        pagesFetched,
        totalBikeRowsRetrieved: all.length,
        power: metric(bike.power),
        adjustedOdds: metric(bike.adjodds),
        variance: metric(bike.variance),
        distances,
      });
    }

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/live-bike-arena-watch-deep.json", JSON.stringify({ schemaVersion: 1, fetchedAt: new Date().toISOString(), apiCalls: calls, results }), "utf8");
    expect(results.length).toBe(TARGETS.length);
  }, 20 * 60_000);
});
