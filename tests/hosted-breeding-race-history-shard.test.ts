import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const enabled = process.env.DNA_BREEDING_RACE_HISTORY_BACKFILL === "1";
const describeConnected = enabled ? describe : describe.skip;
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const TOTAL_REQUESTS_PER_MINUTE = 148;
const DEFAULT_SHARD_COUNT = 4;
const MAX_PAGES_PER_CORE = 100;
const PAGE_SIZE = 50;
const WORKERS_PER_SHARD = 4;

type AnyRecord = Record<string, unknown>;
type HistoryRecord = {
  hid: number;
  rid: string;
  rvmode: "bike" | "car" | "horse";
  distanceMetres: number;
  elapsedSeconds: number;
  speedMetresPerSecond: number;
  gate: number | null;
  startTime: string | null;
  raceName: string | null;
  format: string | null;
  position: number | null;
  star: unknown;
  raw: AnyRecord;
};

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} invalid`);
  return value;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(hid: number, row: AnyRecord): HistoryRecord | null {
  const rvmode = String(row.rvmode ?? "").toLowerCase();
  if (rvmode !== "bike" && rvmode !== "car" && rvmode !== "horse") return null;
  const cb = numberOrNull(row.cb);
  if (cb === null || cb <= 0) return null;
  const distanceMetres = cb >= 100 ? cb : cb * 100;
  const elapsedSeconds = numberOrNull(row.time ?? row.rtime ?? row.elapsed);
  if (elapsedSeconds === null || elapsedSeconds <= 0 || distanceMetres <= 0)
    return null;
  const position = numberOrNull(
    row.position ?? row.pos ?? row.rank ?? row.place ?? row.finish_pos,
  );
  return {
    hid,
    rid: String(
      row.rid ??
        row.rhid ??
        `${hid}:${row.start_time ?? ""}:${distanceMetres}:${elapsedSeconds}`,
    ),
    rvmode,
    distanceMetres,
    elapsedSeconds,
    speedMetresPerSecond: distanceMetres / elapsedSeconds,
    gate: numberOrNull(row.rgate ?? row.gate),
    startTime: canonicalTimestamp(row.start_time ?? row.startTime),
    raceName: typeof row.race_name === "string" ? row.race_name : null,
    format: typeof row.format === "string" ? row.format : null,
    position,
    star: row.star ?? null,
    raw: row,
  };
}

describeConnected("sharded historical race result backfill", () => {
  it(
    "pulls every reachable result page for this shard while preserving Bike/Car/Horse separation",
    async () => {
      const now = new Date().toISOString();
      if (Date.parse(now) >= Date.parse(RESEARCH_EXPIRES_AT)) {
        throw new Error(
          "Temporary August high-rate research authority has expired.",
        );
      }

      const shardIndex = integerEnv("HISTORY_SHARD_INDEX", 0);
      const shardCount = integerEnv("HISTORY_SHARD_COUNT", DEFAULT_SHARD_COUNT);
      if (shardCount < 1 || shardIndex >= shardCount)
        throw new Error("invalid shard configuration");
      const perShardRequestsPerMinute = Math.floor(
        TOTAL_REQUESTS_PER_MINUTE / shardCount,
      );
      const intervalMs = Math.ceil(60_000 / perShardRequestsPerMinute) + 10;

      const inventoryPath =
        process.env.BREEDING_INVENTORY_PATH ??
        "artifacts/inventory/breeding-universe-inventory.json";
      const inventory = JSON.parse(
        await readFile(inventoryPath, "utf8"),
      ) as AnyRecord;
      const allHids = (inventory?.universe?.hids ?? [])
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isSafeInteger(value) && value > 0)
        .sort((a: number, b: number) => a - b);
      const hids = allHids.filter(
        (hid: number) => hid % shardCount === shardIndex,
      );

      let permitTail: Promise<void> = Promise.resolve();
      let lastStartAt = 0;
      let requestCount = 0;
      let rateLimitedCount = 0;
      const errors: AnyRecord[] = [];
      const truncatedHids: number[] = [];
      const pageCounts: Record<string, number> = {};
      const recordsByKey = new Map<string, HistoryRecord>();

      const acquire = async () => {
        const previous = permitTail;
        let release: (() => void) | undefined;
        permitTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          const wait = intervalMs - (Date.now() - lastStartAt);
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          lastStartAt = Date.now();
        } finally {
          release?.();
        }
      };

      const requestPage = async (
        hid: number,
        page: number,
      ): Promise<AnyRecord[]> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          await acquire();
          requestCount++;
          const response = await fetch(
            "https://api.dnaracing.run/fbike/i/hraces",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ hid, page }),
            },
          );
          if (response.status === 429 && attempt < 4) {
            rateLimitedCount++;
            const retry = Number(response.headers.get("retry-after") ?? 2);
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(1, retry) * 1_000),
            );
            continue;
          }
          if (!response.ok)
            throw new Error(`hraces ${hid}/${page} HTTP ${response.status}`);
          const body = (await response.json()) as AnyRecord;
          if (!body || !Array.isArray(body.result))
            throw new Error(`hraces ${hid}/${page} malformed`);
          return body.result as AnyRecord[];
        }
        throw new Error(`hraces ${hid}/${page} exhausted retries`);
      };

      let nextHidIndex = 0;
      const worker = async () => {
        while (true) {
          const index = nextHidIndex++;
          if (index >= hids.length) return;
          const hid = hids[index]!;
          try {
            let lastPageLength = 0;
            for (let page = 1; page <= MAX_PAGES_PER_CORE; page++) {
              const rows = await requestPage(hid, page);
              pageCounts[String(hid)] = page;
              lastPageLength = rows.length;
              for (const row of rows) {
                const normalized = normalize(hid, row);
                if (!normalized) continue;
                const key = `${hid}|${normalized.rvmode}|${normalized.rid}`;
                const existing = recordsByKey.get(key);
                if (!existing) recordsByKey.set(key, normalized);
                else if (
                  JSON.stringify(existing.raw) !==
                  JSON.stringify(normalized.raw)
                ) {
                  errors.push({
                    hid,
                    page,
                    kind: "conflicting_duplicate",
                    key,
                  });
                }
              }
              if (rows.length < PAGE_SIZE) break;
            }
            if (
              lastPageLength >= PAGE_SIZE &&
              pageCounts[String(hid)] === MAX_PAGES_PER_CORE
            ) {
              truncatedHids.push(hid);
            }
          } catch (error) {
            errors.push({
              hid,
              kind: "history_pull_failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };

      await Promise.all(
        Array.from({ length: WORKERS_PER_SHARD }, () => worker()),
      );

      const records = [...recordsByKey.values()].sort(
        (left, right) =>
          left.hid - right.hid ||
          (left.startTime ?? "").localeCompare(right.startTime ?? "") ||
          left.rid.localeCompare(right.rid),
      );
      const modeCounts = records.reduce<Record<string, number>>(
        (out, record) => {
          out[record.rvmode] = (out[record.rvmode] ?? 0) + 1;
          return out;
        },
        {},
      );

      await mkdir("artifacts/history", { recursive: true });
      const outputPath = `artifacts/history/breeding-race-history-${shardIndex}.json`;
      await writeFile(
        outputPath,
        JSON.stringify({
          schemaVersion: 1,
          fetchedAt: now,
          shardIndex,
          shardCount,
          perShardRequestsPerMinute,
          requestCount,
          rateLimitedCount,
          coreCount: hids.length,
          pageCounts,
          recordCount: records.length,
          modeCounts,
          truncatedHids,
          errors,
          records,
        }),
        "utf8",
      );

      expect(hids.length).toBeGreaterThan(0);
      expect(requestCount).toBeGreaterThan(0);
      expect(records.length).toBeGreaterThan(0);
    },
    350 * 60_000,
  );
});
