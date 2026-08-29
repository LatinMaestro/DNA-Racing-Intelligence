import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_SPLICE_ARENA_WATCH === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";

const pairCandidates = Object.freeze([
  { label: "Berserker x First Light", fatherCoreId: 24298, motherCoreId: 22145 },
  { label: "Berserker x Reese Dylan", fatherCoreId: 24298, motherCoreId: 11848 },
  { label: "Grand Azula x First Light", fatherCoreId: 9852, motherCoreId: 22145 },
  { label: "Bright Lights x Reese Dylan", fatherCoreId: 17053, motherCoreId: 11848 },
  { label: "Bong Ripper x Low on Dough", fatherCoreId: 23835, motherCoreId: 8174 },
  { label: "Dough x Spoiler", fatherCoreId: 2799, motherCoreId: 24936 },
  { label: "Alien Nosejob x Spoiler", fatherCoreId: 8665, motherCoreId: 24936 },
  { label: "Bright Lights x Spoiler", fatherCoreId: 17053, motherCoreId: 24936 },
  { label: "Grand Azula x Spoiler", fatherCoreId: 9852, motherCoreId: 24936 },
  { label: "Redline Racer x Spoiler", fatherCoreId: 20376, motherCoreId: 24936 },
  { label: "The Ice Cream Man x Spoiler", fatherCoreId: 11432, motherCoreId: 24936 },
  { label: "Grand Azula x Overzealous", fatherCoreId: 9852, motherCoreId: 3437 },
  { label: "Redline Racer x Overzealous", fatherCoreId: 20376, motherCoreId: 3437 },
  { label: "Bright Lights x Moana", fatherCoreId: 17053, motherCoreId: 14798 },
  { label: "Alien Nosejob x Moana", fatherCoreId: 8665, motherCoreId: 14798 },
  { label: "Zeppelin Quest x Reese Dylan", fatherCoreId: 710, motherCoreId: 11848 },
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

describeConnected("splice arena watch snapshot", () => {
  it("captures current arena and evaluates candidate pairs read-only", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    const arena: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const result = (await client.spliceArena({ filter: { rvmode: "bike" }, page })).result;
      arena.push(...result.cores);
      if (!result.has_more) break;
    }
    const vault = (await client.vaultCoresFull(OWNER_VAULT)).result;
    const arenaIds = arena.map((row) => Number(row.hid)).filter(Number.isSafeInteger);
    const vaultIds = vault.map((row) => Number(row.hid)).filter(Number.isSafeInteger);
    const allIds = [...new Set([...arenaIds, ...vaultIds])];
    const power: any[] = [];
    const stats: any[] = [];
    const spliceInfo: any[] = [];
    for (const ids of chunk(allIds, 20)) {
      power.push(...(await client.corePowerBulk(ids)).result);
      stats.push(...(await client.coreRacingStatsBulk(ids)).result);
      spliceInfo.push(...(await client.coreSplicingInfoBulk(ids)).result);
    }
    const tokenPrices = (await client.tokenPrices()).result;

    let lastPairRequestAt = 0;
    const paced = async <T>(request: () => Promise<T>): Promise<T> => {
      const elapsed = Date.now() - lastPairRequestAt;
      if (elapsed < 2_100) await new Promise((resolve) => setTimeout(resolve, 2_100 - elapsed));
      const result = await request();
      lastPairRequestAt = Date.now();
      return result;
    };
    const pairs: any[] = [];
    for (const pair of pairCandidates) {
      let validation: unknown = null;
      let validationError: string | null = null;
      try { validation = (await paced(() => client.splicePairValidate(pair))).result; }
      catch (error) { validationError = error instanceof Error ? error.message : "validation failed"; }
      let pairInfo: unknown = null;
      let pairInfoError: string | null = null;
      try { pairInfo = (await paced(() => client.splicePairInfo(pair))).result; }
      catch (error) { pairInfoError = error instanceof Error ? error.message : "pair info failed"; }
      pairs.push({ ...pair, validation, validationError, pairInfo, pairInfoError });
    }

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/splice-arena-watch.json", JSON.stringify({
      schemaVersion: 2,
      fetchedAt: new Date().toISOString(),
      ownerVault: OWNER_VAULT,
      arena,
      vault,
      power,
      stats,
      spliceInfo,
      tokenPrices,
      pairs,
    }), "utf8");
    expect(arena.length).toBeGreaterThan(0);
    expect(vault.length).toBeGreaterThan(0);
    expect(pairs.length).toBe(pairCandidates.length);
  }, 240_000);
});
