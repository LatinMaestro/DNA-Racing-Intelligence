import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only pair projections only. */
const enabled = process.env.TEMP_NEW_REPEAT_PAIR_PREVIEW === "1";
const d = enabled ? describe : describe.skip;
const PAIRS = [
  [11042, 13348, "Daring Rowan x Spirit Rider"],
  [949, 21516, "Hibiscus x Solar Ember"],
  [12188, 13348, "Gotenks x Spirit Rider"],
] as const;
function req(name: string) { const v = process.env[name]; if (!v) throw new Error(`${name} missing`); return v; }

d("TEMPORARY new repeat-family pair previews - DO NOT MERGE", () => {
  it("reads pair projections without writes", async () => {
    const c = createDnaOpenLabV1Client({ apiKey: req("DNA_OPEN_LAB_API_KEY_1") });
    const rows = [];
    for (const [fatherCoreId, motherCoreId, label] of PAIRS) {
      try {
        const r = await c.splicePairInfo({ fatherCoreId, motherCoreId });
        rows.push({ fatherCoreId, motherCoreId, label, baby: r.result.baby_info, father: r.result.f, mother: r.result.m, error: null });
      } catch (error) {
        rows.push({ fatherCoreId, motherCoreId, label, baby: null, father: null, mother: null, error: error instanceof Error ? error.message : "unknown" });
      }
    }
    console.log("NEW_REPEAT_PAIR_PREVIEW", JSON.stringify(rows));
    expect(rows.length).toBe(PAIRS.length);
  });
});
