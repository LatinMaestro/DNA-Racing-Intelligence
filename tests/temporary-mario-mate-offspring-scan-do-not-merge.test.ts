import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only offspring quality scan only. */
const enabled = process.env.TEMP_MARIO_MATE_OFFSPRING_SCAN === "1";
const describeConnected = enabled ? describe : describe.skip;
const GROUPS = {
  "Solar Surge": [10765,12273,13795,15159,18132],
  "Cyber Dancer": [23486],
  "Vixey": [9826,11420,12844,15960,14173,16515,17470,17785,18801,19796,20582,22175,23457],
  "Android 18": [15137,11324],
  "Echo Star": [18111,19110,19794,20523,22131,23484],
  "Sakura": [20376,21752,22428,23470],
  "Yankee Trek": [8121,8888,9918,11432,12254,13384,14540,15567,9537,11486,15184,16757,17756,18045,19349,19525,20292,20848,22330,23282],
} as const;

type AnyRecord = Record<string, unknown>;
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}
function chunks<T>(values: readonly T[], n: number): T[][] {
  const out:T[][]=[]; for(let i=0;i<values.length;i+=n) out.push(values.slice(i,i+n) as T[]); return out;
}
function flat(value: unknown, prefix="", out:AnyRecord={}):AnyRecord {
  if (value===null || value===undefined) return out;
  if (Array.isArray(value)) { value.forEach((v,i)=>flat(v,`${prefix}[${i}]`,out)); return out; }
  if (typeof value!=="object") { out[prefix]=value; return out; }
  for (const [k,v] of Object.entries(value as AnyRecord)) flat(v,prefix?`${prefix}.${k}`:k,out);
  return out;
}
function n(v: unknown): number { const x=Number(v); return Number.isFinite(x)?x:0; }

describeConnected("TEMPORARY Mario mate offspring scan - DO NOT MERGE", () => {
  it("reads current offspring Bike outcome evidence for candidate Mario mates", async () => {
    const client=createDnaOpenLabV1Client({apiKey:required("DNA_OPEN_LAB_API_KEY_1")});
    const ids=[...new Set(Object.values(GROUPS).flat())];
    const info=new Map<number,AnyRecord>(); const stats=new Map<number,AnyRecord>();
    for (const batch of chunks(ids,20)) {
      const [ir,sr]=await Promise.all([client.coreInfoBulk(batch),client.coreRacingStatsBulk(batch)]);
      for(const row of ir.result as readonly AnyRecord[]) info.set(Number(row.hid),row);
      for(const row of sr.result as readonly AnyRecord[]) stats.set(Number(row.hid),row);
    }
    const output:AnyRecord={};
    for(const [parent,children] of Object.entries(GROUPS)) {
      output[parent]=(children as readonly number[]).map((hid)=>{
        const i=info.get(hid)??{}; const s=flat(stats.get(hid)??{});
        const dist=(d:number)=>{ const p=`hstats_bike.${d/100}.`; const races=n(s[p+"races_n"]); const win=n(s[p+"win_p"]); const p2=n(s[p+"p2_n"]); const p3=n(s[p+"p3_n"]); return {races,winP:win,top3P:races?((races*win+p2+p3)/races):0}; };
        return {hid,name:String(i.name??""),type:String(i.type??""),element:String(i.element??""),gender:String(i.gender??""),fno:n(i.fno),careerRaces:n(s["hstats_bike.career.races_n"]),careerWinP:n(s["hstats_bike.career.win_p"]),d1000:dist(1000),d1200:dist(1200),d1400:dist(1400)};
      });
    }
    await mkdir("artifacts",{recursive:true});
    await writeFile("artifacts/temporary-mario-mate-offspring-scan.json",JSON.stringify({temporaryBranchOnly:true,doNotMergeIntoMain:true,readOnlyApiScan:true,generatedAt:new Date().toISOString(),groups:output}),"utf8");
    expect(ids.length).toBeGreaterThan(0);
  },10*60*1000);
});
