import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only owner breeding research only. */
const enabled = process.env.TEMP_PROMISING_PAIR_BOARD === "1";
const d = enabled ? describe : describe.skip;

const PAIRS = [
  [19423, 16757, "Better Luck Next Time x She Will Reign", "exact repeat of Lightning Gale"],
  [19423, 11848, "Better Luck Next Time x Reese Dylan", "exact repeat of Legacy Runner"],
  [20862, 9089, "Cold Rush x Vixey", "exact repeat of Silent Bruiser; Vixey family test"],
  [1675, 22164, "Allurity x Flame Dash", "proven long breeder x emerging 2200 racer"],
  [583, 20365, "Cash Bag x Lightning Gale", "proven long breeder x elite BLNT daughter"],
  [1675, 20365, "Allurity x Lightning Gale", "proven long breeder x elite BLNT daughter"],
  [19423, 23283, "Better Luck Next Time x Titan Mage", "scarce proven sire x emerging 1800 racer"],
  [20777, 9089, "Drift Mirage x Vixey", "emerging 1400 sire x proven broodmare"],
  [20382, 22164, "Legacy Runner x Flame Dash", "BLNT son x emerging 2200 racer"],
  [20382, 23283, "Legacy Runner x Titan Mage", "BLNT son x emerging 1800 racer"],
  [9918, 20365, "Cash Cruiser x Lightning Gale", "Cash Bag/Yankee son x BLNT daughter"],
  [9918, 22164, "Cash Cruiser x Flame Dash", "Cash Bag/Yankee son x emerging 2200 racer"],
  [19495, 23283, "Sword Dancer x Titan Mage", "Allurity/Rashi son x emerging 1800 racer"],
  [15833, 20365, "Krillin x Lightning Gale", "strong long racer x elite BLNT daughter"],
  [8902, 20365, "Utopian Risk x Lightning Gale", "scarce long racer x elite BLNT daughter"],
  [20376, 23283, "Redline Racer x Titan Mage", "middle-distance racer x emerging 1800 racer"],
  [20376, 23388, "Redline Racer x Violet Jaguar", "middle-distance racer x emerging 1800 racer"],
  [19423, 23388, "Better Luck Next Time x Violet Jaguar", "scarce proven sire x emerging 1800 racer"],
  [20777, 17785, "Drift Mirage x Snowfall", "emerging 1400 sire x Vixey-line female"],
  [1675, 22175, "Allurity x Ashfall", "proven long breeder x emerging 2200 female"],
  [583, 22175, "Cash Bag x Ashfall", "proven long breeder x emerging 2200 female"],
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

d("TEMPORARY promising breeding pair board - DO NOT MERGE", () => {
  it("checks official validation, child preview and current splice capacity without writes", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    const ids = [...new Set(PAIRS.flatMap(([f, m]) => [f, m]))];
    const spliceRows = new Map<number, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 20) {
      const response = await client.coreSplicingInfoBulk(ids.slice(i, i + 20));
      for (const row of response.result as readonly Record<string, unknown>[]) {
        spliceRows.set(Number(row.hid), row);
      }
    }
    const capacity = (id: number) => {
      const row = spliceRows.get(id) ?? {};
      const splice = typeof row.splice_core === "object" && row.splice_core !== null
        ? row.splice_core as Record<string, unknown>
        : {};
      return {
        cycleUsed: Number(splice.cycle_splices_n ?? 0),
        cycleMax: Number(splice.mxcycle_splices_n ?? 0),
        lifeUsed: Number(splice.life_splices_n ?? 0),
        lifeMax: Number(splice.mxlife_splices_n ?? 0),
        inStud: splice.in_stud ?? null,
        cycleResets: splice.cycle_resets ?? null,
      };
    };

    const results = [];
    for (const [father, mother, label, thesis] of PAIRS) {
      let valid: boolean | null = null;
      let validationError: string | null = null;
      let baby: unknown = null;
      let infoError: string | null = null;
      try {
        await client.splicePairValidate({ fatherCoreId: father, motherCoreId: mother });
        valid = true;
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
        valid = false;
      }
      try {
        const info = await client.splicePairInfo({ fatherCoreId: father, motherCoreId: mother });
        baby = info.result.baby_info;
      } catch (error) {
        infoError = error instanceof Error ? error.message : String(error);
      }
      results.push({
        father,
        mother,
        label,
        thesis,
        valid,
        validationError,
        baby,
        infoError,
        fatherCapacity: capacity(father),
        motherCapacity: capacity(mother),
      });
    }
    console.log("PROMISING_PAIR_BOARD", JSON.stringify(results));
    expect(results.length).toBe(PAIRS.length);
  }, 10 * 60 * 1000);
});
