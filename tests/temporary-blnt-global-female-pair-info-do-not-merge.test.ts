import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. pair_info reads only. */
const enabled = process.env.TEMP_BLNT_GLOBAL_PAIR_INFO === "1";
const describeConnected = enabled ? describe : describe.skip;
const FATHER = 19423;
const MOTHERS = [
  [8174,"Low on Dough"],
  [13467,"Little Sweet"],
  [18346,"April O'Neil"],
  [15946,"Cinematic Gold"],
  [20186,"Up For A Challenge"],
  [23158,"Duck"],
] as const;
function required(name:string){const v=process.env[name];if(!v)throw new Error(`${name} missing`);return v;}
describeConnected("TEMPORARY BLNT global female projections - DO NOT MERGE",()=>{
 it("reads pair_info projections",async()=>{
  const c=createDnaOpenLabV1Client({apiKey:required("DNA_OPEN_LAB_API_KEY_1")});
  const results=[];
  for(const [mother,label] of MOTHERS){try{const r=await c.splicePairInfo({fatherCoreId:FATHER,motherCoreId:mother});results.push({mother,label,baby:r.result.baby_info,prices:r.result.prices});}catch(e){results.push({mother,label,error:e instanceof Error?e.message:"failed"});}}
  console.log("BLNT_GLOBAL_PAIR_INFO",JSON.stringify(results,null,2));
  await mkdir("artifacts",{recursive:true});await writeFile("artifacts/temporary-blnt-global-pair-info.json",JSON.stringify({temporary:true,doNotMerge:true,results},null,2));
  expect(results.length).toBe(MOTHERS.length);
 });
});