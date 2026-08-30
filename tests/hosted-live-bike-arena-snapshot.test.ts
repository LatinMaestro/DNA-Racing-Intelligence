import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_LIVE_ARENA_SNAPSHOT === "1";
const describeConnected = enabled ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

describeConnected("live Bike Arena snapshot", () => {
  it("captures current complete Bike Arena pagination only", async () => {
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
    const cores: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = (await paced(() => client.spliceArena({ filter: { rvmode: "bike" }, page }))).result;
      cores.push(...result.cores);
      if (!result.has_more) break;
    }
    const ids = cores.map((row) => Number(row.hid));
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate Arena Core ID across pages");
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/live-bike-arena-snapshot.json", JSON.stringify({
      schemaVersion: 1,
      fetchedAt: new Date().toISOString(),
      apiCalls: calls,
      count: cores.length,
      cores: cores.map((row) => ({
        hid: Number(row.hid),
        name: String(row.name ?? row.hid),
        type: row.type ?? null,
        gender: row.gender ?? null,
        element: row.element ?? null,
        fno: row.fno ?? null,
        price_usd: row.price_usd ?? row.price ?? null,
      })).sort((a, b) => a.hid - b.hid),
    }), "utf8");
    expect(cores.length).toBeGreaterThan(0);
  }, 120_000);
});
