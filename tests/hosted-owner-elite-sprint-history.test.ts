import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const TARGETS = new Map<number, number>([
  [19423, 6],   // Better Luck Next Time
  [170, 50],    // Yankee Trek
  [583, 60],    // Cash Bag
  [20827, 2],   // Cyber Dancer
  [20524, 2],   // Starline
  [22002, 2],   // Stormveil
  [19802, 5],   // Drift King
  [618, 6],     // Brains
  [4063, 2],    // Make Sense
  [22576, 3],   // Feeling Free (Open Lab stats incomplete)
  [24101, 3],   // Seoul Sinner
]);

type AnyRecord = Record<string, any>;
function num(v:any,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function distanceOf(r:AnyRecord){ const cb=num(r.cb,0); return cb>=100?cb:cb*100; }
function starFlags(r:AnyRecord){ return {
  yellowStar: Boolean(r.yellowstar ?? r.yellow_star ?? r.ystar ?? false),
  blueStar: Boolean(r.bluestar ?? r.blue_star ?? r.bstar ?? false),
}; }

describeConnected("elite sprint history validation",()=>{
  it("backfills full practical 1000/1200/1400 histories for elite raw-performance candidates",async()=>{
    let last=0,calls=0; const records:any[]=[]; const pages:any[]=[];
    const paced=async<T>(fn:()=>Promise<T>)=>{ const wait=2100-(Date.now()-last); if(wait>0)await new Promise(r=>setTimeout(r,wait)); const v=await fn(); last=Date.now(); calls++; return v; };
    for(const [hid,maxPages] of TARGETS){
      for(let page=1;page<=maxPages;page++){
        const rows=await paced(async()=>{ const res=await fetch("https://api.dnaracing.run/fbike/i/hraces",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hid,page})}); const body:any=await res.json(); if(!body||!Array.isArray(body.result))throw new Error(`hraces ${hid}/${page} malformed`); return body.result as AnyRecord[]; });
        pages.push({hid,page,n:rows.length});
        for(const r of rows){ const distance=distanceOf(r); const time=num(r.time??r.rtime??r.elapsed,0); if(![1000,1200,1400].includes(distance)||time<=0)continue; records.push({hid,rid:String(r.rid??r.rhid??`${hid}:${page}:${records.length}`),distance,time,speed:distance/time,gate:num(r.rgate,0),startTime:String(r.start_time??""),raceName:String(r.race_name??""),payout:String(r.payout??""),format:String(r.format??""),...starFlags(r)}); }
        if(rows.length<50)break;
      }
    }
    await mkdir("artifacts",{recursive:true});
    await writeFile("artifacts/owner-elite-sprint-history.json",JSON.stringify({schemaVersion:1,fetchedAt:new Date().toISOString(),apiCalls:calls,targets:[...TARGETS.keys()],pages,records}),"utf8");
    expect(records.length).toBeGreaterThan(0);
  },900_000);
});
