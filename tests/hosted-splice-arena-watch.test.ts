import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_SPLICE_ARENA_WATCH === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";

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
  it("captures current arena, owner vault and bike performance evidence read-only", async () => {
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
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/splice-arena-watch.json", JSON.stringify({
      schemaVersion: 1,
      fetchedAt: new Date().toISOString(),
      ownerVault: OWNER_VAULT,
      arena,
      vault,
      power,
      stats,
      spliceInfo,
      tokenPrices,
    }), "utf8");
    expect(arena.length).toBeGreaterThan(0);
    expect(vault.length).toBeGreaterThan(0);
  }, 180_000);
});
