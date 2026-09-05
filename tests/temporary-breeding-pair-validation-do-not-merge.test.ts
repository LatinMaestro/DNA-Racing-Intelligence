import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only pair_info/pair_validate checks only. */
const enabled = process.env.TEMP_BREEDING_PAIR_VALIDATION === "1";
const describeConnected = enabled ? describe : describe.skip;
const CANDIDATES = [
  { father: 13423, mother: 8174, label: "Mario Kart x Low on Dough" },
  { father: 16105, mother: 8174, label: "Act More Stupidly x Low on Dough" },
  { father: 13423, mother: 2020, label: "Mario Kart x Lustre" },
  { father: 22946, mother: 8174, label: "Piss Missile x Low on Dough" },
  { father: 22946, mother: 618, label: "Piss Missile x Brains" },
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

describeConnected("TEMPORARY breeding pair validation - DO NOT MERGE", () => {
  it("checks current Arena pair viability and official pair_info", async () => {
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
    await writeFile("artifacts/temporary-breeding-pair-validation.json", JSON.stringify({
      temporaryBranchOnly: true,
      doNotMergeIntoMain: true,
      readOnlyApiScan: true,
      generatedAt: new Date().toISOString(),
      results,
    }), "utf8");
    expect(results.length).toBe(CANDIDATES.length);
  }, 5 * 60 * 1000);
});
