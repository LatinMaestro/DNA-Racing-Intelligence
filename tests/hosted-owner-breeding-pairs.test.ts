import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const pairs = Object.freeze([
  { label: "1400 Drift King x Zoey", fatherCoreId: 19802, motherCoreId: 20292 },
]);
function required(name: string): string { const value = process.env[name]; if (!value || value.trim() !== value) throw new Error(`${name} missing`); return value; }
describeConnected("elite-only short-distance breeding pair analysis", () => {
  it("retrieves deterministic offspring descriptors read-only", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let lastRequestAt = 0; const results = [];
    for (const pair of pairs) {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < 2_100) await new Promise((resolve) => setTimeout(resolve, 2_100 - elapsed));
      let pairInfo: unknown = null; let pairInfoError: string | null = null;
      try { pairInfo = (await client.splicePairInfo(pair)).result; } catch (error) { pairInfoError = error instanceof Error ? error.message : "pair info failed"; }
      lastRequestAt = Date.now(); results.push({ ...pair, pairInfo, pairInfoError });
    }
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/owner-breeding-pairs.json", JSON.stringify({ schemaVersion: 6, fetchedAt: new Date().toISOString(), results }), "utf8");
    expect(results.length).toBe(pairs.length);
  }, 120_000);
});
