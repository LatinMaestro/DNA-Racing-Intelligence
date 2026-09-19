import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import {
  createDnaOpenLabV1Client,
  type DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";

const enabled = process.env.PRO_LEAGUE_LIVE_REFRESH === "1";
const vault = process.env.DNA_OPEN_LAB_VAULT ?? "";
const apiKey = process.env.DNA_OPEN_LAB_API_KEY_1 ?? "";

const FREE_TEST_CORE_IDS = [
  20292, 25574, 9926, 23260, 14186, 15184, 8888, 23269, 23282, 17785,
  14541, 8431, 22164, 23467, 20827, 20382, 23388, 23271, 9216, 10457,
  20274, 20524, 20777, 13540, 20365, 14798,
] as const;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)]);
  return out;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function raceId(value: unknown): DnaRaceIdentifier | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : null;
}

function numberIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0,
  );
}

describe.runIf(enabled)("temporary Pro League live refresh", () => {
  it("captures current owner state plus the completed Free-test evidence and star opposition without logging secrets", async () => {
    if (!vault || !apiKey) throw new Error("required connected environment is missing");
    const client = createDnaOpenLabV1Client({ apiKey });
    const history = createDnaCoreRaceHistoryClient();
    let last = 0;
    async function paced<T>(fn: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const delay = Math.max(0, 2100 - (now - last));
      if (delay) await wait(delay);
      last = Date.now();
      return await fn();
    }

    const cores = (await paced(() => client.vaultCoresFull(vault))).result;
    const ids = cores.map(({ hid }) => hid);
    const owned = new Set(ids);

    // Preserve the compact live owner-state snapshot from the original temporary tool.
    const racingStats = [];
    const power = [];
    for (const group of chunks(ids, 20)) {
      racingStats.push(...(await paced(() => client.coreRacingStatsBulk(group))).result);
    }
    for (const group of chunks(ids, 20)) {
      power.push(...(await paced(() => client.corePowerBulk(group))).result);
    }
    const recentRaces = (await paced(() => client.vaultRecentRaces(vault))).result;

    // One 50-row page is sufficient for the quick Free-test window because no
    // selected Core ran anywhere near 50 races after the tests began.
    const freeTestCoreHistory: Record<string, unknown[]> = {};
    const testRaceIds = new Map<string, DnaRaceIdentifier>();
    for (const hid of FREE_TEST_CORE_IDS) {
      const rows = [...(await paced(() => history.page({ coreId: hid, page: 1 }))).result];
      freeTestCoreHistory[String(hid)] = rows;
      for (const row of rows) {
        const start = typeof row.start_time === "string" ? row.start_time : "";
        if (
          row.rvmode !== "bike" ||
          row.race_name !== "Free" ||
          row.rgate !== 4 ||
          start < "2026-09-19T00:00:00.000Z"
        ) continue;
        const rid = raceId(row.rid);
        if (rid !== null) testRaceIds.set(String(rid), rid);
      }
    }

    const freeTestRaceDocs = [];
    for (const group of chunks([...testRaceIds.values()], 20)) {
      freeTestRaceDocs.push(...(await paced(() => client.raceDocs(group))).result);
    }

    // If a Yellow/Blue star went to an external Core, capture enough current
    // evidence to assess whether that opponent was genuinely strong.
    const externalStarIdSet = new Set<number>();
    for (const doc of freeTestRaceDocs) {
      for (const hid of [
        ...numberIds(doc.yellowstars),
        ...numberIds(doc.bluestars),
      ]) {
        if (!owned.has(hid)) externalStarIdSet.add(hid);
      }
    }
    const externalStarIds = [...externalStarIdSet].sort((a, b) => a - b);
    const externalStarInfo = [];
    const externalStarRacingStats = [];
    const externalStarPower = [];
    for (const group of chunks(externalStarIds, 20)) {
      externalStarInfo.push(...(await paced(() => client.coreInfoBulk(group))).result);
      externalStarRacingStats.push(...(await paced(() => client.coreRacingStatsBulk(group))).result);
      externalStarPower.push(...(await paced(() => client.corePowerBulk(group))).result);
    }
    const externalStarHistory: Record<string, unknown[]> = {};
    for (const hid of externalStarIds) {
      externalStarHistory[String(hid)] = [
        ...(await paced(() => history.page({ coreId: hid, page: 1 }))).result,
      ];
    }

    const newestIds = ids.filter((hid) => hid >= 25645);
    const newestCoreHistory: Record<string, unknown[]> = {};
    for (const hid of newestIds) {
      newestCoreHistory[String(hid)] = [
        ...(await paced(() => history.page({ coreId: hid, page: 1 }))).result,
      ];
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      coreCount: cores.length,
      cores,
      racingStats,
      power,
      recentRaces,
      freeTestCoreHistory,
      freeTestRaceDocs,
      externalStarIds,
      externalStarInfo,
      externalStarRacingStats,
      externalStarPower,
      externalStarHistory,
      newestCoreHistory,
    };
    await writeFile("pro-league-live-refresh.json", JSON.stringify(payload, null, 2), "utf8");
    expect(payload.coreCount).toBeGreaterThan(0);
    expect(racingStats).toHaveLength(cores.length);
    expect(power).toHaveLength(cores.length);
    expect(freeTestRaceDocs.length).toBeGreaterThan(0);
  }, 270_000);
});
