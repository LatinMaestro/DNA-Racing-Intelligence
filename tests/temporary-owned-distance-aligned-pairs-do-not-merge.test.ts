import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only pair_info + splicing_info checks. */
const enabled = process.env.TEMP_OWNED_ALIGNED_PAIRS === "1";
const d = enabled ? describe : describe.skip;
const PAIRS = [
  [583,22164,"Cash Bag × Flame Dash","Long 2100/2200"],
  [583,16145,"Cash Bag × Rhythm","Long 2100/2200 repeat"],
  [8902,22164,"Utopian Risk × Flame Dash","Long 2100/2200"],
  [22126,22164,"Infernape × Flame Dash","Long 2200/2200 gamble"],
  [3861,9960,"Elemental Blaze × Nova Nectar","Middle 1900/1900"],
  [20376,22148,"Redline Racer × Mistfall","Middle 1600/1600"],
  [20376,22145,"Redline Racer × First Light","Middle 1600/1600"],
  [23277,23388,"Brazen Mantis × Violet Jaguar","Middle 1800/1800 gamble"],
  [23462,23388,"Hollow Rebel × Violet Jaguar","Middle 1800/1800 gamble"],
  [20769,22348,"Blue Vortex × Hyperstrike","Sprint 1000/1000"],
  [22002,22348,"Stormveil × Hyperstrike","Sprint 1000/1000"],
  [23394,19525,"Core Oracle × Sakura","Sprint 1400/1400"],
  [23269,13540,"Livid Jaguar × Flying Nimbus","Sprint 1200/1300"],
  [583,170,"Cash Bag × Yankee Trek","Long/boundary 2100/1900 repeat"],
  [1675,123,"Allurity × Rashi","MISMATCH long/sprint repeat"],
  [1675,9089,"Allurity × Vixey","MISMATCH long/sprint-ish repeat"],
] as const;
function req(n:string){const v=process.env[n];if(!v)throw new Error(`${n} missing`);return v;}
function obj(v:unknown):Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v)?v as Record<string,unknown>:{};}
function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:null;}

d("TEMPORARY owned distance-aligned breeding pairs - DO NOT MERGE",()=>{
 it("reads current splice capacity and projected children", async()=>{
  const c=createDnaOpenLabV1Client({apiKey:req("DNA_OPEN_LAB_API_KEY_1")});
  const ids=[...new Set(PAIRS.flatMap(p=>[p[0],p[1]]))];
  const spliceBy=new Map<number,Record<string,unknown>>();
  for(let i=0;i<ids.length;i+=20){
    const r=await c.coreSplicingInfoBulk(ids.slice(i,i+20));
    for(const row of r.result as readonly Record<string,unknown>[]){spliceBy.set(Number(row.hid),row);}
  }
  function cap(hid:number){const row=spliceBy.get(hid)??{};const sc=obj(row.splice_core);return {cycleUsed:num(sc.cycle_splices_n),cycleMax:num(sc.mxcycle_splices_n),lifeUsed:num(sc.life_splices_n),lifeMax:num(sc.mxlife_splices_n),inStud:sc.in_stud??null,cycleResets:sc.cycle_resets??null};}
  const out=[];
  for(const [father,mother,label,alignment] of PAIRS){
    try{const r=await c.splicePairInfo({fatherCoreId:father,motherCoreId:mother});out.push({father,mother,label,alignment,baby:r.result.baby_info,fatherCapacity:cap(father),motherCapacity:cap(mother)});}catch(e){out.push({father,mother,label,alignment,error:e instanceof Error?e.message:'failed',fatherCapacity:cap(father),motherCapacity:cap(mother)});}
  }
  console.log("OWNED_ALIGNED_PAIRS",JSON.stringify(out,null,2));
  await mkdir("artifacts",{recursive:true});await writeFile("artifacts/temporary-owned-distance-aligned-pairs.json",JSON.stringify({temporary:true,doNotMerge:true,generatedAt:new Date().toISOString(),out},null,2));
  expect(out.length).toBe(PAIRS.length);
 });
});