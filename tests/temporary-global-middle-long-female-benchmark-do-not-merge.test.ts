import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client, DnaOpenLabApiError, type DnaOpenLabResponse } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE. Read-only global breeding benchmark only. */
const enabled = process.env.TEMP_GLOBAL_FEMALE_BENCHMARK === "1";
const describeConnected = enabled ? describe : describe.skip;
const MAX_HID = 24000;
const BATCH = 20;
const RPM_PER_KEY = 125;
const INTERVAL = Math.ceil(60_000 / RPM_PER_KEY) + 5;
const LOW_ON_DOUGH = 8174;

type Rec = Record<string, unknown>;
function required(name: string): string { const v=process.env[name]; if(!v||v.trim()!==v) throw new Error(`${name} missing`); return v; }
function obj(v: unknown): Rec { return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Rec : {}; }
function num(v: unknown): number { const n=Number(v); return Number.isFinite(n) ? n : 0; }
function hid(v: unknown): number|null { const n=Number(v); return Number.isSafeInteger(n)&&n>0?n:null; }
function ids(v: unknown): number[] { if(v==null)return[]; if(Array.isArray(v))return[...new Set(v.flatMap(ids))]; const d=hid(v); if(d)return[d]; if(typeof v!=="object")return[]; const r=v as Rec; for(const k of ["hid","id","core_id","coreId","token_id","tokenId"]){const q=ids(r[k]); if(q.length)return q;} return [...new Set(Object.values(r).flatMap(ids))]; }
function chunks<T>(a: readonly T[], n:number): T[][] { const o:T[][]=[]; for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]); return o; }
function dist(stats: Rec, d:number){ const r=obj(stats[String(d)]); const races=num(r.races_n), win=num(r.win_p), p2=num(r.p2_n), p3=num(r.p3_n); return {races,win,top3:races?win+(p2+p3)/races:0,paid:num(r.paid_races_n),paidWin:num(r.paid_win_p)}; }
function career(stats: Rec){ const r=obj(stats.career); return {races:num(r.races_n),win:num(r.win_p),paid:num(r.paid_races_n),paidWin:num(r.paid_win_p)}; }
function shrink(rate:number,n:number,prior:number,strength=25){ return (rate*n+prior*strength)/(n+strength); }

describeConnected("TEMPORARY global middle/long female benchmark - DO NOT MERGE",()=>{
 it("benchmarks Low on Dough against current non-Arena females and breeder history", async()=>{
   const keys=[required("DNA_OPEN_LAB_API_KEY_1"),required("DNA_OPEN_LAB_API_KEY_2"),required("DNA_OPEN_LAB_API_KEY_3")];
   const clients=keys.map(apiKey=>createDnaOpenLabV1Client({apiKey}));
   const last=[0,0,0]; let requests=0,retries=0;
   async function paced<T>(i:number, op:()=>Promise<DnaOpenLabResponse<T>>){
     for(let a=0;a<4;a++){
       const wait=INTERVAL-(Date.now()-last[i]!); if(wait>0) await new Promise(r=>setTimeout(r,wait)); last[i]=Date.now(); requests++;
       try{return await op();}catch(e){ if(e instanceof DnaOpenLabApiError && a<3 && (e.kind==="rate_limited"||(e.httpStatus!==null&&e.httpStatus>=500))){retries++; const s=e.rateLimit?.retryAfterSeconds??e.rateLimit?.resetSeconds??2; await new Promise(r=>setTimeout(r,Math.max(1,s)*1000)); continue;} throw e; }
     } throw new Error("retry exhausted");
   }
   const statsBy=new Map<number,Rec>(); const all=Array.from({length:MAX_HID},(_,i)=>i+1); const batches=chunks(all,BATCH);
   async function adaptiveStats(worker:number,b:readonly number[]):Promise<void>{
     try{ const r=await paced(worker,()=>clients[worker]!.coreRacingStatsBulk(b)); for(const row of r.result as readonly Rec[]){const id=hid(row.hid); if(id)statsBy.set(id,row);} }
     catch(e){ if(b.length===1)return; const m=Math.ceil(b.length/2); await adaptiveStats(worker,b.slice(0,m)); await adaptiveStats(worker,b.slice(m)); }
   }
   const queues=[batches.filter((_,i)=>i%3===0),batches.filter((_,i)=>i%3===1),batches.filter((_,i)=>i%3===2)];
   await Promise.all(queues.map(async(q,w)=>{for(const b of q) await adaptiveStats(w,b);}));

   const prelim=[...statsBy.values()].map(row=>{ const id=Number(row.hid); const s=obj(row.hstats_bike); const d16=dist(s,16),d18=dist(s,18),d20=dist(s,20),d22=dist(s,22),c=career(s); const middleLongRaces=d16.races+d18.races+d20.races+d22.races; const d18q=0.55*shrink(d18.win,d18.races,0.18)+0.45*shrink(d18.top3,d18.races,0.55); const longq=0.5*shrink(d20.win,d20.races,0.16)+0.5*shrink(d22.win,d22.races,0.15); const fit=d18q*0.72+longq*0.28; return {id,fit,d16,d18,d20,d22,career:c,middleLongRaces}; }).filter(x=>x.d18.races>=20).sort((a,b)=>b.fit-a.fit);
   const topIds=[...new Set([...prelim.slice(0,600).map(x=>x.id),LOW_ON_DOUGH])];
   const infoBy=new Map<number,Rec>(), spliceBy=new Map<number,Rec>();
   async function adaptiveFamily(worker:number,b:readonly number[],family:"info"|"splice"){
     try{ const r=family==="info"?await paced(worker,()=>clients[worker]!.coreInfoBulk(b)):await paced(worker,()=>clients[worker]!.coreSplicingInfoBulk(b)); for(const row of r.result as readonly Rec[]){const id=hid(row.hid);if(id)(family==="info"?infoBy:spliceBy).set(id,row);} }
     catch(e){ if(b.length===1)return; const m=Math.ceil(b.length/2); await adaptiveFamily(worker,b.slice(0,m),family); await adaptiveFamily(worker,b.slice(m),family); }
   }
   const ib=chunks(topIds,BATCH); await Promise.all([0,1,2].map(async w=>{for(let i=w;i<ib.length;i+=3){await adaptiveFamily(w,ib[i]!,"info"); await adaptiveFamily(w,ib[i]!,"splice");}}));

   const arenaIds=new Set<number>(); for(let p=1;p<=100;p++){const r=await paced(p%3,()=>clients[p%3]!.spliceArena({filter:{rvmode:"bike",use_powerstats:true},page:p})); for(const row of r.result.cores as readonly Rec[]){const id=hid(row.hid);if(id)arenaIds.add(id);} if(!r.result.has_more)break;}
   const female=prelim.map(x=>({...x,info:infoBy.get(x.id),splice:spliceBy.get(x.id)})).filter(x=>String(x.info?.gender??"").toLowerCase()==="female");
   const category=female.filter(x=>{
     const primary=Math.max(x.d16.races,x.d18.races,x.d20.races,x.d22.races);
     return x.d18.races>=50 && (x.d18.races===primary || x.d18.races>=0.7*primary) && x.d18.win>=0.18;
   }).sort((a,b)=>b.fit-a.fit);
   const rank=category.findIndex(x=>x.id===LOW_ON_DOUGH)+1;

   const breederTop=category.slice(0,80);
   const offspringIds=[...new Set(breederTop.flatMap(x=>ids(obj(x.splice?.splice_core).life_splices)))];
   const offStats=new Map<number,Rec>(),offInfo=new Map<number,Rec>(); const ob=chunks(offspringIds,BATCH);
   async function fetchOff(worker:number,b:readonly number[]){
     try{const [s,i]=await Promise.all([paced(worker,()=>clients[worker]!.coreRacingStatsBulk(b)),paced(worker,()=>clients[worker]!.coreInfoBulk(b))]); for(const r of s.result as readonly Rec[]){const id=hid(r.hid);if(id)offStats.set(id,r);} for(const r of i.result as readonly Rec[]){const id=hid(r.hid);if(id)offInfo.set(id,r);} }catch(e){if(b.length===1)return;const m=Math.ceil(b.length/2);await fetchOff(worker,b.slice(0,m));await fetchOff(worker,b.slice(m));}
   }
   await Promise.all([0,1,2].map(async w=>{for(let i=w;i<ob.length;i+=3)await fetchOff(w,ob[i]!);}));
   function offspringScore(id:number){const row=offStats.get(id);if(!row)return null;const s=obj(row.hstats_bike);const c=career(s);const d18=dist(s,18),d20=dist(s,20),d22=dist(s,22);const q=0.5*shrink(c.win,c.races,0.15)+0.25*shrink(d18.win,d18.races,0.18)+0.125*shrink(d20.win,d20.races,0.16)+0.125*shrink(d22.win,d22.races,0.15);return {id,name:String(offInfo.get(id)?.name??""),career:c,d18,d20,d22,q};}
   const summarized=breederTop.map(x=>{const life=ids(obj(x.splice?.splice_core).life_splices);const os=life.map(offspringScore).filter(Boolean) as any[];const qs=os.map(o=>o.q).sort((a,b)=>b-a);return {hid:x.id,name:String(x.info?.name??""),type:String(x.info?.type??""),element:String(x.info?.element??""),fno:num(x.info?.fno),inArena:arenaIds.has(x.id),fit:x.fit,d18:x.d18,d20:x.d20,d22:x.d22,career:x.career,lifeSplices:life.length,offspringAvailable:os.length,offspringMeanQ:qs.length?qs.reduce((a,b)=>a+b,0)/qs.length:null,offspringBestQ:qs[0]??null,offspringTop:os.sort((a,b)=>b.q-a.q).slice(0,5)};}).sort((a,b)=>b.fit-a.fit);
   const low=summarized.find(x=>x.hid===LOW_ON_DOUGH)??null;
   console.log("GLOBAL_FEMALE_BENCHMARK",JSON.stringify({maxHid:MAX_HID,statsRows:statsBy.size,categoryCount:category.length,lowRank:rank,lowPercentile:rank?1-(rank-1)/category.length:null,low,top10:summarized.slice(0,10),top10NonArena:summarized.filter(x=>!x.inArena).slice(0,10)},null,2));
   await mkdir("artifacts",{recursive:true}); await writeFile("artifacts/temporary-global-middle-long-female-benchmark.json",JSON.stringify({temporaryBranchOnly:true,doNotMergeIntoMain:true,readOnly:true,generatedAt:new Date().toISOString(),requests,retries,maxHid:MAX_HID,statsRows:statsBy.size,categoryCount:category.length,lowRank:rank,lowPercentile:rank?1-(rank-1)/category.length:null,low,top50:summarized.slice(0,50)},null,2));
   expect(statsBy.size).toBeGreaterThan(10000); expect(low).not.toBeNull();
 },30*60*1000);
});