import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only pair_info/pair_validate checks only. */
const enabled = process.env.TEMP_MARIO_LOW_PAIR_SCAN === "1";
const describeConnected = enabled ? describe : describe.skip;
const CANDIDATES = [
  { father: 13423, mother: 23260, label: "Mario Kart x Scarlet Panther", group: "mario" },
  { father: 13423, mother: 9926, label: "Mario Kart x Solar Surge", group: "mario" },
  { father: 13423, mother: 20827, label: "Mario Kart x Cyber Dancer", group: "mario" },
  { father: 13423, mother: 9089, label: "Mario Kart x Vixey", group: "mario" },
  { father: 13423, mother: 14186, label: "Mario Kart x Android 18", group: "mario" },
  { father: 13423, mother: 16148, label: "Mario Kart x Echo Star", group: "mario" },
  { father: 13423, mother: 19525, label: "Mario Kart x Sakura", group: "mario" },
  { father: 13423, mother: 9166, label: "Mario Kart x Lethal Claw", group: "mario" },
  { father: 13423, mother: 170, label: "Mario Kart x Yankee Trek", group: "mario" },
  { father: 13423, mother: 14798, label: "Mario Kart x Moana", group: "mario" },
  { father: 19423, mother: 8174, label: "Better Luck Next Time x Low on Dough", group: "low" },
  { father: 15833, mother: 8174, label: "Krillin x Low on Dough", group: "low" },
  { father: 8902, mother: 8174, label: "Utopian Risk x Low on Dough", group: "low" },
  { father: 23467, mother: 8174, label: "Forge Serpent x Low on Dough", group: "low" },
  { father: 583, mother: 8174, label: "Cash Bag x Low on Dough", group: "low" },
  { father: 949, mother: 8174, label: "Hibiscus x Low on Dough", group: "low" },
  { father: 9852, mother: 8174, label: "Grand Azula x Low on Dough", group: "low" },
  { father: 11432, mother: 8174, label: "The Ice Cream Man x Low on Dough", group: "low" },
] as const;

type AnyRecord = Record<string, unknown>;
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}
function sanitize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out: AnyRecord = {};
    for (const [key, entry] of Object.entries(value as AnyRecord)) {
      if (["vault","owner","hex_code","color"].includes(key)) continue;
      out[key] = sanitize(entry);
    }
    return out;
  }
  return null;
}

describeConnected("TEMPORARY Mario/Low vault pair scan - DO NOT MERGE", () => {
  it("checks projected children and current pair status", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    const results: unknown[] = [];
    for (const candidate of CANDIDATES) {
      const pair = { fatherCoreId: candidate.father, motherCoreId: candidate.mother };
      let info: unknown = null;
      let infoError: string | null = null;
      let valid = false;
      let validationError: string | null = null;
      try { info = sanitize((await client.splicePairInfo(pair)).result); }
      catch (error) { infoError = error instanceof Error ? error.message : "pair_info failed"; }
      try { valid = (await client.splicePairValidate(pair)).result.valid === true; }
      catch (error) { validationError = error instanceof Error ? error.message : "pair_validate failed"; }
      results.push({ ...candidate, valid, validationError, infoError, info });
    }
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/temporary-mario-low-vault-pair-scan.json", JSON.stringify({
      temporaryBranchOnly: true,
      doNotMergeIntoMain: true,
      readOnlyApiScan: true,
      generatedAt: new Date().toISOString(),
      results,
    }), "utf8");
    expect(results.length).toBe(CANDIDATES.length);
  }, 10 * 60 * 1000);
});
