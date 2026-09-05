import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only lineage inspection. */
const enabled = process.env.TEMP_ELITE_OFFSPRING_LINEAGE === "1";
const d = enabled ? describe : describe.skip;
const OFFSPRING = [
  [20365, "Lightning Gale"],
  [20382, "Legacy Runner"],
  [9918, "Cash Cruiser"],
  [10457, "Salsa"],
  [19495, "Sword Dancer"],
  [20827, "Cyber Dancer"],
  [20582, "Green Charger"],
  [23457, "Silent Bruiser"],
  [17785, "Snowfall"],
  [22148, "Mistfall"],
  [22333, "Radiant Blitz"],
] as const;
function req(name:string){const v=process.env[name];if(!v)throw new Error(`${name} missing`);return v;}
d("TEMPORARY elite offspring lineage - DO NOT MERGE",()=>{
 it("reads current parent/grandparent evidence only",async()=>{
  const c=createDnaOpenLabV1Client({apiKey:req("DNA_OPEN_LAB_API_KEY_1")});
  const rows=[];
  for(let i=0;i<OFFSPRING.length;i+=20){
    const ids=OFFSPRING.slice(i,i+20).map(([hid])=>hid);
    const r=await c.coreSplicingInfoBulk(ids);
    for(const row of r.result as readonly Record<string,unknown>[]){
      const hid=Number(row.hid);
      rows.push({hid,name:OFFSPRING.find(([id])=>id===hid)?.[1]??null,parents:row.parents??null,grandParents:row.grand_parents??null});
    }
  }
  console.log("ELITE_OFFSPRING_LINEAGE",JSON.stringify(rows));
  expect(rows.length).toBe(OFFSPRING.length);
 });
});