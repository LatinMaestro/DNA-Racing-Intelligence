import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const pairs = Object.freeze([
  { label: "1000 Stormveil x Cyber Dancer", fatherCoreId: 22002, motherCoreId: 20827 },
  { label: "1000 Stormveil x Keepy Uppy", fatherCoreId: 22002, motherCoreId: 13765 },
  { label: "1000 Seoul Sinner x Cyber Dancer", fatherCoreId: 24101, motherCoreId: 20827 },
  { label: "1000 Immaculate Chakra x Keepy Uppy", fatherCoreId: 12990, motherCoreId: 13765 },
  { label: "1000 Alien Nosejob x Solar Surge", fatherCoreId: 8665, motherCoreId: 9926 },
  { label: "1200 Victorious Chickadee x Solar Surge", fatherCoreId: 77, motherCoreId: 9926 },
  { label: "1200 Victorious Chickadee x Android 18", fatherCoreId: 77, motherCoreId: 14186 },
  { label: "1200 Bright Lights x Solar Surge", fatherCoreId: 17053, motherCoreId: 9926 },
  { label: "1200 Victorious Chickadee x Daring Dawn", fatherCoreId: 77, motherCoreId: 823 },
  { label: "1400 Drift King x Celestia", fatherCoreId: 19802, motherCoreId: 14036 },
  { label: "1400 Drift King x Rashi", fatherCoreId: 19802, motherCoreId: 123 },
  { label: "1400 Immaculate Chakra x Celestia", fatherCoreId: 12990, motherCoreId: 14036 },
  { label: "1400 Bright Lights x Celestia", fatherCoreId: 17053, motherCoreId: 14036 },
  { label: "1400 Daring Rowan x Flying Nimbus", fatherCoreId: 11042, motherCoreId: 13540 },
  { label: "Broad Bright Lights x Android 18", fatherCoreId: 17053, motherCoreId: 14186 },
  { label: "Broad Metro Magic x Solar Surge", fatherCoreId: 13298, motherCoreId: 9926 },
]);
function required(name: string): string { const value = process.env[name]; if (!value || value.trim() !== value) throw new Error(`${name} missing`); return value; }
describeConnected("specialist short-distance breeding pair analysis", () => {
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
    await writeFile("artifacts/owner-breeding-pairs.json", JSON.stringify({ schemaVersion: 4, fetchedAt: new Date().toISOString(), results }), "utf8");
    expect(results.length).toBe(pairs.length);
  }, 120_000);
});
