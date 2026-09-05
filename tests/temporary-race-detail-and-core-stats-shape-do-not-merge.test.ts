import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only API shape inspection only. */
const enabled = process.env.TEMP_RACE_DETAIL_SHAPE === "1";
const d = enabled ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} missing`);
  return value;
}

function depth(value: unknown, level = 0): unknown {
  if (level >= 5) return typeof value;
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => depth(v, level + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [k, depth(v, level + 1)]));
  }
  return value;
}

d("TEMPORARY race detail and Core stats shape - DO NOT MERGE", () => {
  it("reads selected race docs/fills and candidate Core stats without writes", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    const rids = ["73cfa2edb6", "1583e81412", "3bf48c260e"];
    const coreIds = [22164, 23283, 20777, 16757, 11848, 20365, 22148, 23467, 20582, 17785, 23457, 9918, 10457, 20382, 19495, 20827];
    const [docs, fills, stats, powers] = await Promise.all([
      client.raceDocs(rids),
      client.raceFills(rids),
      client.coreRacingStatsBulk(coreIds.slice(0, 20)),
      client.corePowerBulk(coreIds.slice(0, 20)),
    ]);
    console.log("RACE_DOC_SHAPE", JSON.stringify(depth(docs.result)));
    console.log("RACE_FILL_SHAPE", JSON.stringify(depth(fills.result)));
    console.log("CORE_STATS_SHAPE", JSON.stringify(depth(stats.result)));
    console.log("CORE_POWER_SHAPE", JSON.stringify(depth(powers.result)));
    expect(docs.result.length).toBeGreaterThan(0);
    expect(stats.result.length).toBeGreaterThan(0);
  }, 60_000);
});
