import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

/**
 * TEMPORARY / DO NOT MERGE.
 * Owner-authorized 5 Sep 2026 read-only breeding analysis.
 *
 * This test performs only DNA Open Lab READ requests. It does not write to R2,
 * Neon, Vercel, Cloudflare Workers or the game. It emits only sanitized derived
 * Core/Arena attributes needed for private breeding analysis.
 */

const enabled = process.env.TEMP_CURRENT_ARENA_BREEDING_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const REQUESTS_PER_MINUTE = 120;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 10;
const CORE_BATCH_SIZE = 20;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function hid(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function flattenScalars(value: unknown, prefix = "", out: AnyRecord = {}): AnyRecord {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenScalars(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (typeof value !== "object") {
    out[prefix] = value;
    return out;
  }
  for (const [key, entry] of Object.entries(value as AnyRecord)) {
    const next = prefix ? `${prefix}.${key}` : key;
    flattenScalars(entry, next, out);
  }
  return out;
}

function lineageIds(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(lineageIds))];
  const direct = hid(value);
  if (direct !== null) return [direct];
  if (typeof value !== "object") return [];
  const row = value as AnyRecord;
  for (const key of [
    "hid", "id", "core_id", "coreId", "token_id", "tokenId",
    "father_id", "fatherId", "mother_id", "motherId",
  ]) {
    const ids = lineageIds(row[key]);
    if (ids.length > 0) return ids;
  }
  return [...new Set(Object.values(row).flatMap(lineageIds))];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size) as T[]);
  return out;
}

describeConnected("TEMPORARY current Arena breeding scan - DO NOT MERGE", () => {
  it("reads current Bike Arena and sanitized Core evidence only", async () => {
    const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
    const client = createDnaOpenLabV1Client({ apiKey });

    let lastStartAt = 0;
    let requestCount = 0;
    let retryCount = 0;
    let minimumObservedRemaining: number | null = null;
    let maximumObservedLimit: number | null = null;

    const paced = async <T>(op: () => Promise<DnaOpenLabResponse<T>>): Promise<DnaOpenLabResponse<T>> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStartAt = Date.now();
        requestCount++;
        try {
          const response = await op();
          if (response.rateLimit.limit !== null)
            maximumObservedLimit = Math.max(maximumObservedLimit ?? 0, response.rateLimit.limit);
          if (response.rateLimit.remaining !== null)
            minimumObservedRemaining = Math.min(minimumObservedRemaining ?? response.rateLimit.remaining, response.rateLimit.remaining);
          return response;
        } catch (error) {
          if (
            error instanceof DnaOpenLabApiError &&
            attempt < 4 &&
            (error.kind === "rate_limited" || (error.httpStatus !== null && error.httpStatus >= 500))
          ) {
            retryCount++;
            const seconds = error.rateLimit?.retryAfterSeconds ?? error.rateLimit?.resetSeconds ?? Math.min(20, 2 ** attempt);
            await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000));
            continue;
          }
          throw error;
        }
      }
      throw new Error("request retries exhausted");
    };

    const ownerRows = (await paced(() => client.vaultCoresFull(OWNER_VAULT))).result;
    const ownerIds = new Set(ownerRows.map((row) => Number(row.hid)));

    const arenaRows: AnyRecord[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = await paced(() =>
        client.spliceArena({ filter: { rvmode: "bike", use_powerstats: true }, page }),
      );
      arenaRows.push(...(response.result.cores as readonly AnyRecord[]));
      if (!response.result.has_more) break;
    }

    const uniqueArena = new Map<number, AnyRecord>();
    for (const row of arenaRows) {
      const id = hid(row.hid);
      if (id !== null) uniqueArena.set(id, row);
    }
    const arenaIds = [...uniqueArena.keys()].sort((a, b) => a - b);

    const infoById = new Map<number, AnyRecord>();
    const statsById = new Map<number, AnyRecord>();
    const powerById = new Map<number, AnyRecord>();
    const spliceById = new Map<number, AnyRecord>();
    const failed: { family: string; hid: number }[] = [];

    async function adaptive(
      family: string,
      batch: readonly number[],
      op: (ids: readonly number[]) => Promise<DnaOpenLabResponse<readonly AnyRecord[]>>,
      target: Map<number, AnyRecord>,
    ): Promise<void> {
      try {
        const response = await paced(() => op(batch));
        for (const row of response.result) {
          const id = hid(row.hid);
          if (id !== null) target.set(id, row);
        }
      } catch (error) {
        if (batch.length === 1) {
          failed.push({ family, hid: batch[0]! });
          return;
        }
        const mid = Math.ceil(batch.length / 2);
        await adaptive(family, batch.slice(0, mid), op, target);
        await adaptive(family, batch.slice(mid), op, target);
      }
    }

    for (const batch of chunks(arenaIds, CORE_BATCH_SIZE)) {
      await adaptive("info", batch, (ids) => client.coreInfoBulk(ids), infoById);
      await adaptive("stats", batch, (ids) => client.coreRacingStatsBulk(ids), statsById);
      await adaptive("power", batch, (ids) => client.corePowerBulk(ids), powerById);
      await adaptive("splicing", batch, (ids) => client.coreSplicingInfoBulk(ids), spliceById);
    }

    const sanitized = arenaIds.map((id) => {
      const arena = uniqueArena.get(id) ?? {};
      const info = infoById.get(id) ?? {};
      const stats = statsById.get(id) ?? {};
      const power = powerById.get(id) ?? {};
      const splicing = spliceById.get(id) ?? {};
      const statsScalars = flattenScalars(stats);
      const powerScalars = flattenScalars(power);
      const spliceCore = record(splicing.splice_core);
      const spliceScalars = flattenScalars(spliceCore);
      return {
        hid: id,
        ownedByTargetVault: ownerIds.has(id),
        name: String(info.name ?? arena.name ?? ""),
        type: String(info.type ?? arena.type ?? ""),
        gender: String(info.gender ?? arena.gender ?? ""),
        element: String(info.element ?? arena.element ?? ""),
        fno: Number(info.fno ?? arena.fno ?? 0),
        arenaPriceUsd: Number(arena.price_usd ?? 0),
        arenaAdditiveScalarKeys: Object.keys(flattenScalars(arena)).sort(),
        bikePower: powerScalars["power.bike.power"] ?? null,
        bikeAdjOdds: powerScalars["power.bike.adjodds"] ?? null,
        bikeVariance: powerScalars["power.bike.variance"] ?? null,
        bikePowerRaces: powerScalars["power.bike.races_n"] ?? null,
        bikeStatsScalars: Object.fromEntries(
          Object.entries(statsScalars).filter(([key]) => key.startsWith("hstats_bike.") || key.startsWith("ageing.bike") || key === "is_maiden"),
        ),
        parentIds: lineageIds(splicing.parents),
        grandParentIds: lineageIds(splicing.grand_parents),
        cycleSplices: spliceScalars["cycle_splices_n"] ?? null,
        maxCycleSplices: spliceScalars["mxcycle_splices_n"] ?? null,
        lifeSplices: spliceScalars["life_splices_n"] ?? null,
        maxLifeSplices: spliceScalars["mxlife_splices_n"] ?? null,
        cycleResets: spliceScalars["cycle_resets"] ?? null,
        inStud: spliceScalars["in_stud"] ?? null,
      };
    });

    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/temporary-current-arena-breeding-analysis.json",
      JSON.stringify({
        temporaryBranchOnly: true,
        doNotMergeIntoMain: true,
        readOnlyApiScan: true,
        generatedAt: new Date().toISOString(),
        ownerVault: OWNER_VAULT,
        requestCount,
        retryCount,
        maximumObservedLimit,
        minimumObservedRemaining,
        ownerCoreCount: ownerIds.size,
        arenaRowCount: arenaRows.length,
        uniqueArenaCoreCount: arenaIds.length,
        externalArenaCoreCount: sanitized.filter((row) => !row.ownedByTargetVault).length,
        failedReadCount: failed.length,
        failed,
        cores: sanitized,
      }),
      "utf8",
    );

    expect(arenaIds.length).toBeGreaterThan(0);
    expect(sanitized.length).toBe(arenaIds.length);
  }, 30 * 60 * 1000);
});
