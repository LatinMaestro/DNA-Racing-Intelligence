import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "@/lib/dna-open-lab-v1-client";

const enabled = process.env.PRO_LEAGUE_LIVE_REFRESH === "1";
const vault = process.env.DNA_OPEN_LAB_VAULT ?? "";
const apiKey = process.env.DNA_OPEN_LAB_API_KEY_1 ?? "";

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)]);
  return out;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.runIf(enabled)("temporary Pro League live refresh", () => {
  it("captures current owner Core, racing-stat, power, and recent-race evidence without logging secrets", async () => {
    if (!vault || !apiKey) throw new Error("required connected environment is missing");
    const client = createDnaOpenLabV1Client({ apiKey });
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
    const racingStats = [];
    const power = [];
    for (const group of chunks(ids, 20)) {
      racingStats.push(...(await paced(() => client.coreRacingStatsBulk(group))).result);
    }
    for (const group of chunks(ids, 20)) {
      power.push(...(await paced(() => client.corePowerBulk(group))).result);
    }
    const recentRaces = (await paced(() => client.vaultRecentRaces(vault))).result;

    const payload = {
      generatedAt: new Date().toISOString(),
      coreCount: cores.length,
      cores,
      racingStats,
      power,
      recentRaces,
    };
    await writeFile("pro-league-live-refresh.json", JSON.stringify(payload, null, 2), "utf8");
    expect(payload.coreCount).toBeGreaterThan(0);
    expect(racingStats).toHaveLength(cores.length);
    expect(power).toHaveLength(cores.length);
  }, 120_000);
});
