import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only 1400m mate scan. */
const enabled=process.env.TEMP_DRIFT_KING_1400_MATE_SCAN==='1'; const d=enabled?describe:describe.skip;
const DRIFT_KING=19802; const CB=14; type Rec=Record<string,unknown>;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const asRec=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const hid=(v:unknown):number|null=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
const chunks=<T,>(a:readonly T[],n:number)=>{const out:T[][]=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n) as T[]);return out;};
function teleMap(payload:unknown){const m=new Map<number,Rec>();for(const x of Array.isArray(payload)?payload:[]){const r=asRec(x);const id=hid(r.hid);if(id)m.set(id,r);}return m;}
function tele1400(t:Rec|undefined,b:Rec){const x=asRec(asRec(t?.data)[String(CB)]);const n=num(x.races_n)??0,tm=num(x.time_median),best=num(x.speed_mx),ga=num(b.speed_avg),gm=num(b.speed_mx);if(tm===null||ga===null)return null;const med=CB*100/tm;return {n,medianTime:tm,medianSpeed:med,bestSpeed:best,medianVsGlobalAvgPct:(med/ga-1)*100,globalHeadroomFraction:gm!==null&&gm>ga?(med-ga)/(gm-ga):null};}
function family(row:Rec){const p=asRec(row.parents);return {father:hid(p.father),mother:hid(p.mother)};}

d('TEMPORARY Drift King 1400 mate scan - DO NOT MERGE',()=>{it('ranks owned and Arena females for a 1400 gap-filling mate',async()=>{
 const apiKey=req('DNA_OPEN_LAB_API_KEY_1'); const vault=req('DNA_OPEN_LAB_VAULT');
 const c=createDnaOpenLabV1Client({apiKey}); const t=createDnaOpenLabV1TelemetryClient({apiKey});
 const driftInfo=(await c.coreInfoBulk([DRIFT_KING])).result[0] as Rec; const driftSplice=(await c.coreSplicingInfoBulk([DRIFT_KING])).result[0] as Rec; const driftFamily=family(driftSplice);
 const benchmark=asRec(asRec((await t.coreTelemetryBenchmark(DRIFT_KING,CB)).result).benchmark); await sleep(450);
 const owned=(await c.vaultCoresFull(vault)).result as readonly Rec[];
 const arena:Rec[]=[]; for(let page=1;page<=100;page++){const r=await c.spliceArena({filter:{rvmode:'bike',use_powerstats:true},page});arena.push(...(r.result.cores as readonly Rec[]));if(!r.result.has_more)break;await sleep(450);} 
 const sourceRows=[...owned.map(r=>({...r,source:'owned'})),...arena.map(r=>({...r,source:'arena'}))] as Rec[];
 const femaleRows=sourceRows.filter(r=>String(r.gender??'').toLowerCase()==='female');
 const ids=[...new Set(femaleRows.map(r=>hid(r.hid)).filter((v):v is number=>v!==null))];
 const tele=new Map<number,Rec>(), splice=new Map<number,Rec>();
 for(const batch of chunks(ids,20)){const tr=await t.coreTelemetryBulk(batch);for(const [id,row] of teleMap(tr.result))tele.set(id,row);await sleep(450);try{const sr=await c.coreSplicingInfoBulk(batch);for(const row of sr.result as readonly Rec[]){const id=hid(row.hid);if(id)splice.set(id,row);}}catch{}await sleep(450);}
 const candidates=femaleRows.map(r=>{const id=hid(r.hid)!;const tt=tele1400(tele.get(id),benchmark);const fam=family(splice.get(id)??{});const elem=String(r.element??'').toLowerCase();const type=String(r.type??'').toLowerCase();const fno=num(r.fno);const source=String(r.source??'');const price=num(r.price_usd);const obviousFamily=id===driftFamily.mother||id===driftFamily.father||fam.father===DRIFT_KING||fam.mother===DRIFT_KING||((fam.father&&fam.father===driftFamily.father)||(fam.mother&&fam.mother===driftFamily.mother));return {hid:id,name:String(r.name??''),source,gender:String(r.gender??''),element:elem,type,fno,priceUsd:price,family:fam,obviousFamily,telemetry:tt};}).filter(x=>x.telemetry&&x.telemetry.n>=5&&!x.obviousFamily).sort((a,b)=>(b.telemetry!.medianVsGlobalAvgPct)-(a.telemetry!.medianVsGlobalAvgPct));
 const gapCandidates=candidates.filter(x=>x.element!=='metal').slice(0,15);
 const previews=[];for(const x of gapCandidates.slice(0,10)){try{const p=await c.splicePairInfo({fatherCoreId:DRIFT_KING,motherCoreId:x.hid});previews.push({hid:x.hid,name:x.name,source:x.source,baby:p.result.baby_info,prices:p.result.prices,errors:{father:p.result.father_info.errs,mother:p.result.mother_info.errs}});}catch(e){previews.push({hid:x.hid,name:x.name,source:x.source,error:e instanceof Error?e.message:'failed'});}await sleep(450);}
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,driftKing:{hid:DRIFT_KING,name:String(driftInfo.name??''),family:driftFamily},benchmark,candidatesTop20:candidates.slice(0,20),gapCandidatesTop15:gapCandidates,previews};
 console.log('DRIFT_KING_1400_MATE_SCAN',JSON.stringify(out));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-drift-king-1400-mate-scan.json',JSON.stringify(out,null,2));expect(gapCandidates.length).toBeGreaterThan(0);
},180_000);});
