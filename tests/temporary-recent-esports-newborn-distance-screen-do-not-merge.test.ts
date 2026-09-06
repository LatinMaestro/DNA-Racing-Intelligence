import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client, type DnaRaceDocument } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only early Esports screen only. */
const enabled = process.env.TEMP_RECENT_ESPORTS_NEWBORN_SCREEN === "1";
const d = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const TARGETS = new Map<number,string>([
  [25557,"Frozen Blade"],[25574,"Frost Rocket"],[25555,"Cyber Overdrive"],[25558,"Iron Dynamo"],
  [25562,"Nervy Runner"],[25564,"Creeper"],[25565,"Final Flash"],[9216,"Peak Crown"],
]);
type Rec = Record<string,unknown>;
function req(name:string){const v=process.env[name]?.trim()??"";if(!v)throw new Error(`${name} missing`);return v;}
function rec(v:unknown):Rec{return v&&typeof v==="object"&&!Array.isArray(v)?v as Rec:{};}
function n(v:unknown):number|null{const x=Number(v);return Number.isFinite(x)?x:null;}
function ints(v:unknown):number[]{return Array.isArray(v)?v.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0):[];}
function chunks<T>(a:readonly T[],size:number):T[][]{const out:T[][]=[];for(let i=0;i<a.length;i+=size)out.push(a.slice(i,i+size) as T[]);return out;}
function looksEsports(r:Rec){const text=[r.race_name,r.format,r.track,...(Array.isArray(r.eventtags)?r.eventtags:[])].map(String).join(" ").toLowerCase();return /esport|pro[ _-]?league|trial/.test(text);}
function distance(r:Rec):number|null{const cb=n(r.cb);return cb===null?null:cb*100;}
function sanitized(r:Rec){
  const out:Rec={};
  for(const [k,v] of Object.entries(r)){
    if(/secret|api.?key|authorization|credential/i.test(k))continue;
    if(Array.isArray(v))out[k]=v.slice(0,40);
    else if(v&&typeof v==="object")out[k]=v;
    else out[k]=v;
  }
  return out;
}
function placementEvidence(r:Rec,hid:number):number|null{
  for(const key of ["results","result","placements","positions","finish_order","finishing_order","rankings","ranks"]){
    const value=r[key];
    if(Array.isArray(value)){
      const index=value.findIndex((x)=>{
        if(Number(x)===hid)return true;
        const row=rec(x);return Number(row.hid??row.core_id??row.coreId)===hid;
      });
      if(index>=0){const row=rec(value[index]);const explicit=n(row.position??row.place??row.rank??row.finish_position);return explicit??index+1;}
    }
    const object=rec(value);
    const direct=n(object[String(hid)]);if(direct!==null)return direct;
  }
  return null;
}
function elapsedEvidence(r:Rec,hid:number):number|null{
  for(const key of ["results","result","times","elapsed","elapsed_times","finish_times"]){
    const value=r[key];
    if(Array.isArray(value)){
      for(const x of value){const row=rec(x);if(Number(row.hid??row.core_id??row.coreId)!==hid)continue;for(const kk of ["elapsed","elapsed_time","time","time_s","seconds","finish_time"]){const q=n(row[kk]);if(q!==null&&q>0)return q;}}
    }
    const object=rec(value);const direct=n(object[String(hid)]);if(direct!==null&&direct>0)return direct;
  }
  return null;
}

d("TEMPORARY recent Esports newborn distance screen - DO NOT MERGE",()=>{
  it("reads current trial race documents and summarizes target Cores",async()=>{
    const c=createDnaOpenLabV1Client({apiKey:req("DNA_OPEN_LAB_API_KEY_1")});
    const recent=await c.vaultRecentRaces(VAULT);
    const finished=await c.racesFinished({startTime:"2026-09-05T14:00:00.000Z",limit:200});
    const seed=[...(recent.result as readonly DnaRaceDocument[]),...(finished.result as readonly DnaRaceDocument[])];
    const ridSet=new Set<string|number>();
    for(const r of seed){const rr=rec(r);const hids=ints(rr.hids);if(hids.some(id=>TARGETS.has(id))||looksEsports(rr)){if(typeof rr.rid==="string"||typeof rr.rid==="number")ridSet.add(rr.rid);}}
    const hydrated:Rec[]=[];
    for(const batch of chunks([...ridSet],20)){const docs=await c.raceDocs(batch);for(const x of docs.result as readonly DnaRaceDocument[])hydrated.push(rec(x));}
    const byRid=new Map<string,Rec>();
    for(const x of [...seed.map(rec),...hydrated]){const rid=x.rid;if(rid!==undefined&&rid!==null)byRid.set(String(rid),x);}
    const relevant=[...byRid.values()].filter(r=>ints(r.hids).some(id=>TARGETS.has(id)) && (looksEsports(r)||String(r.race_name??"").toLowerCase().includes("trial")));
    // If explicit tags are missing, keep today's target-containing Bike races as a fallback and mark it.
    const fallback=relevant.length?relevant:[...byRid.values()].filter(r=>ints(r.hids).some(id=>TARGETS.has(id))&&String(r.rvmode??"").toLowerCase()==="bike");
    const summaries=[];
    for(const [hid,name] of TARGETS){
      const rows=fallback.filter(r=>ints(r.hids).includes(hid));
      const perDistance=new Map<number,{races:number;blue:number;yellow:number;placements:number[];elapsed:number[]}>();
      for(const r of rows){const dist=distance(r);if(dist===null)continue;const cur=perDistance.get(dist)??{races:0,blue:0,yellow:0,placements:[],elapsed:[]};cur.races++;if(ints(r.bluestars).includes(hid))cur.blue++;if(ints(r.yellowstars).includes(hid))cur.yellow++;const p=placementEvidence(r,hid);if(p!==null)cur.placements.push(p);const e=elapsedEvidence(r,hid);if(e!==null)cur.elapsed.push(e);perDistance.set(dist,cur);}
      const distances=[...perDistance.entries()].map(([dist,x])=>({distance:dist,...x,avgPlace:x.placements.length?x.placements.reduce((a,b)=>a+b,0)/x.placements.length:null,avgElapsed:x.elapsed.length?x.elapsed.reduce((a,b)=>a+b,0)/x.elapsed.length:null,earlyScore:(x.yellow*3+x.blue*2)+(x.placements.length?x.placements.reduce((a,p)=>a+Math.max(0,8-p),0)/x.placements.length:0)})).sort((a,b)=>b.earlyScore-a.earlyScore||b.races-a.races||a.distance-b.distance);
      summaries.push({hid,name,races:rows.length,preferred:distances[0]?.distance??null,distances});
    }
    const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,source:relevant.length?"explicit_esports_or_trial_tag":"target_containing_recent_bike_fallback",recentCount:recent.result.length,finishedCount:finished.result.length,relevantRaceCount:fallback.length,summaries,documents:fallback.map(sanitized)};
    console.log("RECENT_ESPORTS_NEWBORN_SCREEN",JSON.stringify(out,null,2));
    await mkdir("artifacts",{recursive:true});await writeFile("artifacts/temporary-newest-vault-parentage-resolution.json",JSON.stringify(out,null,2));
    expect(summaries).toHaveLength(TARGETS.size);
  },120000);
});
