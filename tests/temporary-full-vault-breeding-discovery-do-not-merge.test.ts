import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DnaOpenLabApiError, createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only breeding analysis only. */
const enabled=process.env.TEMP_FULL_VAULT_BREEDING==='1'; const d=enabled?describe:describe.skip;
const CBS=[10,12,14,16,18,20,22] as const; type Rec=Record<string,unknown>;
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const asRec=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const hid=(v:unknown):number|null=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
const chunks=<T,>(a:readonly T[],n:number)=>{const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;};
function parents(row:Rec){const p=asRec(row.parents);return {father:hid(p.father),mother:hid(p.mother)};}
function splice(row:Rec){return asRec(row.splice_core);}
function childIds(row:Rec){const x=splice(row).life_splices;return Array.isArray(x)?[...new Set(x.map(hid).filter((v):v is number=>v!==null))]:[];}
function capacity(row:Rec){const s=splice(row);return {lifeUsed:num(s.life_splices_n)??childIds(row).length,lifeMax:num(s.mxlife_splices_n),cycleUsed:num(s.cycle_splices_n),cycleMax:num(s.mxcycle_splices_n)};}
function teleMap(payload:unknown){const m=new Map<number,Rec>();for(const x of Array.isArray(payload)?payload:[]){const r=asRec(x);const id=hid(r.hid);if(id)m.set(id,r);}return m;}
function bestScreen(t:Rec|undefined, benchmarks:Record<string,Rec>){const data=asRec(t?.data);const rows=[];for(const cb of CBS){const x=asRec(data[String(cb)]);const n=num(x.races_n)??0;const tm=num(x.time_median);const best=num(x.speed_mx);if(n<1||tm===null)continue;const med=cb*100/tm;const b=benchmarks[String(cb)]??{};const ga=num(b.speed_avg);const gm=num(b.speed_mx);const advantage=ga===null?null:(med/ga-1)*100;const frac=ga!==null&&gm!==null&&gm>ga?(med-ga)/(gm-ga):null;rows.push({cb,meters:cb*100,n,medianTime:tm,medianSpeed:med,bestSpeed:best,globalAvg:ga,globalMax:gm,medianVsGlobalAvgPct:advantage,globalHeadroomFraction:frac});}
 const eligible=rows.filter(r=>r.n>=5).sort((a,b)=>(b.medianVsGlobalAvgPct??-999)-(a.medianVsGlobalAvgPct??-999));return {distances:rows,bestN5:eligible[0]??null};}

d('TEMPORARY full-vault all-distance breeding discovery - DO NOT MERGE',()=>{it('scans owned cores, offspring and pair families read-only',async()=>{
 const key=req('DNA_OPEN_LAB_API_KEY_1'), vault=req('DNA_OPEN_LAB_VAULT'); const c=createDnaOpenLabV1Client({apiKey:key}); const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const owned=(await c.vaultCoresFull(vault)).result as readonly Rec[]; const ownedIds=owned.map(r=>hid(r.hid)).filter((v):v is number=>v!==null); expect(ownedIds.length).toBeGreaterThan(50);
 const benchmarks:Record<string,Rec>={}; for(const cb of CBS){const r=await t.coreTelemetryBenchmark(ownedIds[0]!,cb);benchmarks[String(cb)]=asRec(asRec(r.result).benchmark);await sleep(420);}
 const ownedTele=new Map<number,Rec>(), ownedSplice=new Map<number,Rec>();
 for(const batch of chunks(ownedIds,20)){const tr=await t.coreTelemetryBulk(batch);for(const [id,r] of teleMap(tr.result))ownedTele.set(id,r);await sleep(420);const sr=await c.coreSplicingInfoBulk(batch);for(const r of sr.result as readonly Rec[]){const id=hid(r.hid);if(id)ownedSplice.set(id,r);}await sleep(420);}
 const allChildIds=[...new Set([...ownedSplice.values()].flatMap(childIds))].sort((a,b)=>a-b); const childTele=new Map<number,Rec>(), childSplice=new Map<number,Rec>(), childInfo=new Map<number,Rec>();
 for(const batch of chunks(allChildIds,20)){
   try{const tr=await t.coreTelemetryBulk(batch);for(const [id,r] of teleMap(tr.result))childTele.set(id,r);}catch(e){if(!(e instanceof DnaOpenLabApiError))throw e;for(const id of batch){try{const r=await t.coreTelemetry(id);childTele.set(id,asRec(r.result));}catch{/* unavailable child */}await sleep(420);}} await sleep(420);
   try{const sr=await c.coreSplicingInfoBulk(batch);for(const r of sr.result as readonly Rec[]){const id=hid(r.hid);if(id)childSplice.set(id,r);}}catch{/* unavailable/burnt child rows */} await sleep(420);
   try{const ir=await c.coreInfoBulk(batch);for(const r of ir.result as readonly Rec[]){const id=hid(r.hid);if(id)childInfo.set(id,r);}}catch{/* unavailable/burnt child rows */} await sleep(420);
 }
 const ownedRows=owned.map(r=>{const id=hid(r.hid)!;return {hid:id,name:String(r.name??''),gender:String(r.gender??''),element:String(r.element??''),type:String(r.type??''),fno:num(r.fno),capacity:capacity(ownedSplice.get(id)??{}),screen:bestScreen(ownedTele.get(id),benchmarks)};});
 const childRows=allChildIds.map(id=>{const info=childInfo.get(id)??{};const ps=parents(childSplice.get(id)??{});return {hid:id,name:String(info.name??''),gender:String(info.gender??''),element:String(info.element??''),type:String(info.type??''),fno:num(info.fno),...ps,screen:bestScreen(childTele.get(id),benchmarks)};});
 const byParent=new Map<number,typeof childRows>();for(const ch of childRows){for(const pid of [ch.father,ch.mother])if(pid){const a=byParent.get(pid)??[];a.push(ch);byParent.set(pid,a);}}
 const parentSummary=ownedRows.map(p=>{const kids=byParent.get(p.hid)??[];const scored=kids.filter(k=>k.screen.bestN5!==null);const above=scored.filter(k=>(k.screen.bestN5?.medianVsGlobalAvgPct??-999)>0);const halfTail=scored.filter(k=>(k.screen.bestN5?.globalHeadroomFraction??-999)>=0.5);const coParents=new Set(kids.map(k=>k.father===p.hid?k.mother:k.father).filter(Boolean));return {hid:p.hid,name:p.name,capacity:p.capacity,children:kids.length,childrenN5:scored.length,childrenAboveGlobalAvg:above.length,childrenHalfwayAvgToGlobalMax:halfTail.length,coParentCount:coParents.size,topChildren:[...scored].sort((a,b)=>(b.screen.bestN5?.medianVsGlobalAvgPct??-999)-(a.screen.bestN5?.medianVsGlobalAvgPct??-999)).slice(0,8).map(k=>({hid:k.hid,name:k.name,father:k.father,mother:k.mother,best:k.screen.bestN5}))};}).filter(p=>p.children>0).sort((a,b)=>b.childrenHalfwayAvgToGlobalMax-a.childrenHalfwayAvgToGlobalMax||b.childrenAboveGlobalAvg-a.childrenAboveGlobalAvg||b.childrenN5-a.childrenN5);
 const pairMap=new Map<string,typeof childRows>();for(const ch of childRows){if(!ch.father||!ch.mother)continue;const key2=`${ch.father}:${ch.mother}`;const a=pairMap.get(key2)??[];a.push(ch);pairMap.set(key2,a);} const pairSummary=[...pairMap.entries()].map(([k,kids])=>{const [father,mother]=k.split(':').map(Number);const scored=kids.filter(x=>x.screen.bestN5!==null);return {father,mother,children:kids.length,childrenN5:scored.length,childrenAboveGlobalAvg:scored.filter(x=>(x.screen.bestN5?.medianVsGlobalAvgPct??-999)>0).length,childrenHalfwayAvgToGlobalMax:scored.filter(x=>(x.screen.bestN5?.globalHeadroomFraction??-999)>=0.5).length,topChildren:[...scored].sort((a,b)=>(b.screen.bestN5?.medianVsGlobalAvgPct??-999)-(a.screen.bestN5?.medianVsGlobalAvgPct??-999)).slice(0,6).map(x=>({hid:x.hid,name:x.name,best:x.screen.bestN5}))};}).sort((a,b)=>b.childrenHalfwayAvgToGlobalMax-a.childrenHalfwayAvgToGlobalMax||b.childrenAboveGlobalAvg-a.childrenAboveGlobalAvg||b.childrenN5-a.childrenN5);
 const distanceLeaders=Object.fromEntries(CBS.map(cb=>[String(cb),ownedRows.map(x=>({hid:x.hid,name:x.name,gender:x.gender,element:x.element,type:x.type,fno:x.fno,capacity:x.capacity,row:x.screen.distances.find(d=>d.cb===cb)??null})).filter(x=>x.row&&x.row.n>=5).sort((a,b)=>(b.row?.medianVsGlobalAvgPct??-999)-(a.row?.medianVsGlobalAvgPct??-999)).slice(0,25)]));
 const unbredLeaders=ownedRows.filter(x=>(x.capacity.lifeUsed??0)===0&&x.screen.bestN5!==null).sort((a,b)=>(b.screen.bestN5?.medianVsGlobalAvgPct??-999)-(a.screen.bestN5?.medianVsGlobalAvgPct??-999)).slice(0,50);
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-full-vault-breeding-discovery.json',JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,ownedCount:ownedRows.length,childCount:childRows.length,benchmarks,distanceLeaders,unbredLeaders,parentSummary:parentSummary.slice(0,80),pairSummary:pairSummary.slice(0,100),ownedRows,childRows}), 'utf8');
 console.log('FULL_VAULT_BREEDING_SUMMARY',JSON.stringify({ownedCount:ownedRows.length,childCount:childRows.length,topUnbred:unbredLeaders.slice(0,12).map(x=>({hid:x.hid,name:x.name,best:x.screen.bestN5})),topParents:parentSummary.slice(0,12),topPairs:pairSummary.slice(0,12)}));
},8*60_000);});
