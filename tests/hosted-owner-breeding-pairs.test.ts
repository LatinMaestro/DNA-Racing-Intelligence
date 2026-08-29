import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;

const pairs = Object.freeze([
  { label: "Dough x Android 18", fatherCoreId: 2799, motherCoreId: 14186 },
  { label: "Bright Lights x Android 18", fatherCoreId: 17053, motherCoreId: 14186 },
  { label: "Alien Nosejob x Android 18", fatherCoreId: 8665, motherCoreId: 14186 },
  { label: "Dough x Reese Dylan", fatherCoreId: 2799, motherCoreId: 11848 },
  { label: "Bright Lights x Reese Dylan", fatherCoreId: 17053, motherCoreId: 11848 },
  { label: "Aerosphere x Reese Dylan", fatherCoreId: 1743, motherCoreId: 11848 },
  { label: "Stormstride x Reese Dylan", fatherCoreId: 20321, motherCoreId: 11848 },
  { label: "Run forest run x Reese Dylan", fatherCoreId: 20693, motherCoreId: 11848 },
  { label: "Immaculate Chakra x Reese Dylan", fatherCoreId: 12990, motherCoreId: 11848 },
  { label: "Grand Azula x Reese Dylan", fatherCoreId: 9852, motherCoreId: 11848 },
  { label: "The Ice Cream Man x Moana", fatherCoreId: 11432, motherCoreId: 14798 },
  { label: "Cash Bag x Android 18", fatherCoreId: 583, motherCoreId: 14186 },
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

describeConnected("one-off performance-gap breeding pair analysis", () => {
  it("retrieves deterministic offspring descriptors read-only", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let lastRequestAt = 0;
    const results = [];
    for (const pair of pairs) {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < 2_100) await new Promise((resolve) => setTimeout(resolve, 2_100 - elapsed));
      let pairInfo: unknown = null;
      let pairInfoError: string | null = null;
      try {
        pairInfo = (await client.splicePairInfo(pair)).result;
      } catch (error) {
        pairInfoError = error instanceof Error ? error.message : "pair info failed";
      }
      lastRequestAt = Date.now();
      results.push({ ...pair, pairInfo, pairInfoError });
    }
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/owner-breeding-pairs.json", JSON.stringify({ schemaVersion: 2, fetchedAt: new Date().toISOString(), results }), "utf8");
    expect(results.length).toBe(pairs.length);
  }, 180_000);
});
