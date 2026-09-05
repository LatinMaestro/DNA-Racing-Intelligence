import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only global 1400 mate research. */
const enabled=process.env.TEMP_GLOBAL_1400_FEMALE_SEARCH==='1'; const d=enabled?describe:describe.skip;
const MAX_HID=26000; const BATCH=20; const CBS=[10,12,14,16,18,20,22] as const; const DRIFT_KING=19802; type Rec=Record<string,unknown>;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const asRec=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const hid=(v:unknown):number|null=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
const chunks=<T,>(a:readonly T[],n:number)=>{const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;};
function teleRows(v:unknown){const out=new Map<number,Rec>();for(const x of Array.isArray(v)?v:[]){const r=asRec(x),id=hid(r.hid);if(id)out.set(id,r);}return out;}
function medSpeed(t:Rec|undefined,cb:number){const x=asRec(asRec(t?.data)[String(cb)]);const n=num(x.races_n)??0,tm=num(x.time_median),best=num(x.speed_mx);if(tm===null||n<1)return null;return {n,medianTime:tm,medianSpeed:cb*100/tm,bestSpeed:best};}
function percentile(sorted:number[],v:number){let lo=0,hi=sorted.length;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]!<=v)lo=m+1;else hi=m;}return sorted.length?100*lo/sorted.length:null;}
function parentIds(row:Rec){const p=asRec(row.parents);return {father:hid(p.father),mother:hid(p.mother)};}
function childIds(row:Rec){const s=asRec(row.splice_core);const x=s.life_splices;return Array.isArray(x)?[...new Set(x.map(hid).filter((v):v is number=>v!==null))]:[];}

d('TEMPORARY global 1400 female Drift King search - DO NOT MERGE',()=>{it('finds population-elite 1400 females and projects Drift King offspring',async()=>{
 const keys=[req('DNA_OPEN_LAB_API_KEY_1'),req('DNA_OPEN_LAB_API_KEY_2'),req('DNA_OPEN_LAB_API_KEY_3')]; const vault=req('DNA_OPEN_LAB_VAULT');
 const apis=keys.map(apiKey=>createDnaOpenLabV1Client({apiKey})); const teles=keys.map(apiKey=>createDnaOpenLabV1TelemetryClient({apiKey}));
 const ids=Array.from({length:MAX_HID},(_,i)=>i+1), batches=chunks(ids,BATCH); const info=new Map<number,Rec>(), tele=new Map<number,Rec>(); let requests=0;
 const workers=[0,1,2].map(async w=>{for(let i=w;i<batches.length;i+=3){const batch=batches[i]!;try{const r=await apis[w]!.coreInfoBulk(batch);requests++;for(const row of r.result as readonly Rec[]){const id=hid(row.hid);if(id)info.set(id,row);}}catch{}await sleep(500);try{const r=await teles[w]!.coreTelemetryBulk(batch);requests++;for(const [id,row] of teleRows(r.result))tele.set(id,row);}catch{}await sleep(500);}}); await Promise.all(workers);
 const distributions:Record<string,number[]>={};for(const cb of CBS){const vals=[...tele.values()].map(t=>medSpeed(t,cb)).filter((x):x is NonNullable<typeof x>=>!!x&&x.n>=5).map(x=>x.medianSpeed).sort((a,b)=>a-b);distributions[String(cb)]=vals;}
 const owned=(await apis[0]!.vaultCoresFull(vault)).result as readonly Rec[];requests++;const ownedIds=new Set(owned.map(x=>hid(x.hid)).filter((v):v is number=>v!==null));
 const arena:Rec[]=[];for(let page=1;page<=100;page++){const r=await apis[0]!.spliceArena({filter:{rvmode:'bike',use_powerstats:true},page});requests++;arena.push(...(r.result.cores as readonly Rec[]));if(!r.result.has_more)break;await sleep(500);}const arenaIds=new Map(arena.map(r=>[hid(r.hid),r]).filter((x):x is [number,Rec]=>x[0]!==null));
 const females=[...info.entries()].map(([id,r])=>{const t=medSpeed(tele.get(id),14);if(!t||t.n<5||String(r.gender??'').toLowerCase()!=='female')return null;const elem=String(r.element??'').toLowerCase();const pct=percentile(distributions['14']!,t.medianSpeed);return {hid:id,name:String(r.name??''),element:elem,type:String(r.type??'').toLowerCase(),fno:num(r.fno),telemetry:t,populationPercentile1400:pct,source:ownedIds.has(id)?'owned':arenaIds.has(id)?'arena':'population-not-arena',arenaPriceUsd:num(arenaIds.get(id)?.price_usd)};}).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>(b.populationPercentile1400??0)-(a.populationPercentile1400??0));
 const gapPool=females.filter(x=>x.element!=='metal'&&(x.populationPercentile1400??0)>=90).slice(0,40);
 const topIds=gapPool.slice(0,20).map(x=>x.hid);const splice=new Map<number,Rec>();for(const batch of chunks(topIds,BATCH)){try{const r=await apis[0]!.coreSplicingInfoBulk(batch);requests++;for(const row of r.result as readonly Rec[]){const id=hid(row.hid);if(id)splice.set(id,row);}}catch{}await sleep(500);}
 const enriched=gapPool.map(x=>{const s=splice.get(x.hid);const kids=s?childIds(s):[];const kidScores=kids.map(id=>{const tt=tele.get(id);let best:null|{cb:number,pct:number,n:number,medianSpeed:number}=null;for(const cb of CBS){const m=medSpeed(tt,cb);if(!m||m.n<5)continue;const pct=percentile(distributions[String(cb)]!,m.medianSpeed);if(pct!==null&&(!best||pct>best.pct))best={cb,pct,n:m.n,medianSpeed:m.medianSpeed};}return {hid:id,best};}).filter(k=>k.best!==null);return {...x,parents:s?parentIds(s):{father:null,mother:null},lifeOffspring:kids.length,offspringEvaluated:kidScores.length,offspring95Plus:kidScores.filter(k=>(k.best?.pct??0)>=95).length,offspring90Plus:kidScores.filter(k=>(k.best?.pct??0)>=90).length,topOffspring:[...kidScores].sort((a,b)=>(b.best?.pct??0)-(a.best?.pct??0)).slice(0,5)};});
 const previews=[];for(const x of enriched.slice(0,15)){try{const p=await apis[0]!.splicePairInfo({fatherCoreId:DRIFT_KING,motherCoreId:x.hid});requests++;previews.push({hid:x.hid,name:x.name,source:x.source,baby:p.result.baby_info,prices:p.result.prices??null,fatherInfo:p.result.father_info??null,motherInfo:p.result.mother_info??null});}catch(e){previews.push({hid:x.hid,name:x.name,source:x.source,error:e instanceof Error?e.message:'failed'});}await sleep(500);}
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,maxHid:MAX_HID,requests,validInfo:info.size,validTelemetry:tele.size,population1400N5:distributions['14']!.length,topFemale1400:females.slice(0,30),gapPool:enriched,previews};
 console.log('GLOBAL_1400_FEMALE_SEARCH',JSON.stringify({population1400N5:out.population1400N5,topGap:enriched.slice(0,15),previews},null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-global-1400-female-drift-king-search.json',JSON.stringify(out,null,2));expect(out.population1400N5).toBeGreaterThan(1000);
},15*60_000);});
