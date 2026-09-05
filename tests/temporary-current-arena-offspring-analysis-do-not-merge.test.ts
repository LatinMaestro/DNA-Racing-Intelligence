import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only current Arena offspring evidence scan. */
const enabled = process.env.TEMP_CURRENT_ARENA_OFFSPRING_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const RPM = 120;
const INTERVAL = Math.ceil(60_000 / RPM) + 10;
const BATCH = 20;
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
function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size) as T[]);
  return out;
}
function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : {};
}
function flatten(value: unknown, prefix = "", out: AnyRecord = {}): AnyRecord {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (typeof value !== "object") { out[prefix] = value; return out; }
  for (const [key, entry] of Object.entries(value as AnyRecord)) {
    flatten(entry, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

describeConnected("TEMPORARY Arena offspring analysis - DO NOT MERGE", () => {
  it("reads current stud offspring stats without writes", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let last = 0;
    let requestCount = 0;
    let retries = 0;
    const paced = async <T>(op: () => Promise<DnaOpenLabResponse<T>>): Promise<DnaOpenLabResponse<T>> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const wait = INTERVAL - (Date.now() - last);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        last = Date.now(); requestCount++;
        try { return await op(); }
        catch (error) {
          if (error instanceof DnaOpenLabApiError && attempt < 4 &&
              (error.kind === "rate_limited" || (error.httpStatus !== null && error.httpStatus >= 500))) {
            retries++;
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          throw error;
        }
      }
      throw new Error("request retries exhausted");
    };

    const arena: AnyRecord[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = await paced(() => client.spliceArena({ filter: { rvmode: "bike", use_powerstats: true }, page }));
      arena.push(...response.result.cores as readonly AnyRecord[]);
      if (!response.result.has_more) break;
    }
    const arenaById = new Map<number, AnyRecord>();
    for (const row of arena) { const id = hid(row.hid); if (id !== null) arenaById.set(id, row); }
    const arenaIds = [...arenaById.keys()].sort((a,b) => a-b);

    const splicingById = new Map<number, AnyRecord>();
    for (const batch of chunks(arenaIds, BATCH)) {
      const response = await paced(() => client.coreSplicingInfoBulk(batch));
      for (const row of response.result as readonly AnyRecord[]) {
        const id = hid(row.hid); if (id !== null) splicingById.set(id, row);
      }
    }

    const offspringByParent = new Map<number, number[]>();
    const offspringIds = new Set<number>();
    for (const parentId of arenaIds) {
      const splice = flatten(record(splicingById.get(parentId)?.splice_core));
      const children = Object.entries(splice)
        .filter(([key]) => /^life_splices\[\d+\]$/u.test(key))
        .map(([,value]) => hid(value))
        .filter((value): value is number => value !== null);
      offspringByParent.set(parentId, [...new Set(children)]);
      children.forEach((id) => offspringIds.add(id));
    }

    const childInfo = new Map<number, AnyRecord>();
    const childStats = new Map<number, AnyRecord>();
    const childIds = [...offspringIds].sort((a,b) => a-b);
    for (const batch of chunks(childIds, BATCH)) {
      try {
        const [info, stats] = await Promise.all([
          paced(() => client.coreInfoBulk(batch)),
          paced(() => client.coreRacingStatsBulk(batch)),
        ]);
        for (const row of info.result as readonly AnyRecord[]) { const id=hid(row.hid); if (id!==null) childInfo.set(id,row); }
        for (const row of stats.result as readonly AnyRecord[]) { const id=hid(row.hid); if (id!==null) childStats.set(id,row); }
      } catch {
        for (const id of batch) {
          try {
            const [info, stats] = await Promise.all([
              paced(() => client.coreInfoBulk([id])),
              paced(() => client.coreRacingStatsBulk([id])),
            ]);
            for (const row of info.result as readonly AnyRecord[]) { const rid=hid(row.hid); if (rid!==null) childInfo.set(rid,row); }
            for (const row of stats.result as readonly AnyRecord[]) { const rid=hid(row.hid); if (rid!==null) childStats.set(rid,row); }
          } catch { /* missing/burnt API row remains unavailable */ }
        }
      }
    }

    const parents = arenaIds.map((parentId) => {
      const arenaRow = arenaById.get(parentId) ?? {};
      const children = (offspringByParent.get(parentId) ?? []).map((childId) => {
        const info = childInfo.get(childId) ?? {};
        const stats = flatten(childStats.get(childId) ?? {});
        return {
          hid: childId,
          name: String(info.name ?? ""),
          type: String(info.type ?? ""),
          element: String(info.element ?? ""),
          gender: String(info.gender ?? ""),
          fno: Number(info.fno ?? 0),
          bikeStatsScalars: Object.fromEntries(Object.entries(stats).filter(([key]) => key.startsWith("hstats_bike.") || key === "ageing.bike")),
        };
      });
      return {
        hid: parentId,
        name: String(arenaRow.name ?? ""),
        type: String(arenaRow.type ?? ""),
        element: String(arenaRow.element ?? ""),
        gender: String(arenaRow.gender ?? ""),
        fno: Number(arenaRow.fno ?? 0),
        arenaPriceUsd: Number(arenaRow.price_usd ?? 0),
        recordedOffspringCount: (offspringByParent.get(parentId) ?? []).length,
        availableOffspringCount: children.filter((child) => child.name !== "").length,
        offspring: children,
      };
    });

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/temporary-current-arena-offspring-analysis.json", JSON.stringify({
      temporaryBranchOnly: true,
      doNotMergeIntoMain: true,
      readOnlyApiScan: true,
      generatedAt: new Date().toISOString(),
      requestCount,
      retries,
      arenaCoreCount: arenaIds.length,
      uniqueOffspringCount: childIds.length,
      availableOffspringCount: childInfo.size,
      parents,
    }), "utf8");

    expect(arenaIds.length).toBeGreaterThan(0);
  }, 30 * 60 * 1000);
});
