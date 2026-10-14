// Owner-authorised temporary read-only Bike 1v1 Wars 48h P/L research.
// DO NOT MERGE. No Neon/R2, wallet, on-chain action, bets, race entries, state mutation.
// Only derived per-Core result and official race-config money metadata in 1-day private artifact.
import { writeFile } from "node:fs/promises";
const V1="https://api.dnaracing.run/fbike/pub/v1";
const HISTORY="https://api.dnaracing.run/fbike/i/hraces";
const key=process.env.DNA_OPEN_LAB_API_KEY_1??"";
const vault=process.env.DNA_OPEN_LAB_VAULT??"";
if(!/^dna_[A-Za-z0-9_-]{43}$/.test(key)||!vault||vault!==vault.trim()||vault.length>4096)throw Error("Private read credentials unavailable");
const after=Date.parse("2026-10-12T22:02:56Z"), before=Date.parse("2026-10-14T22:02:56Z");
const rate=2150, callCap=252, maxPages=5;
let last=0, calls={v1:0,legacy:0}, stopped=false;
function decimalUnits(value){
 if(typeof value!=="number" && typeof value!=="string")return null;
 const s=String(value).trim();
 const m=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
 if(!m)return null;
 const exp=Number(m[3]??0), fractional=(m[2]??"").length;
 if(!Number.isInteger(exp)||Math.abs(exp)>100)return null;
 const shift=12-fractional+exp;
 if(shift<0 || shift>75)return null;
 return BigInt(m[1]+(m[2]??"")) * 10n ** BigInt(shift);
}
function decString(u){
 const sign=u<0n?"-":"",abs=u<0n?-u:u;
 let s=abs.toString().padStart(13,"0");
 const frac=s.slice(-12).replace(/0+$/u,"");
 return sign+s.slice(0,-12)+(frac?"."+frac:"");
}
const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:null;};
const id=v=>{const x=n(v);return x===null||!Number.isSafeInteger(x)?null:x;};
const distance=v=>{const x=id(v);return x===null?null:x<100?x*100:x;};
const stamp=v=>{if(typeof v!=="string")return null;const t=Date.parse(v);return Number.isFinite(t)?t:null;};
async function pace(){const t=rate-(Date.now()-last);if(t>0)await new Promise(r=>setTimeout(r,t));last=Date.now();}
async function call(url,init={}){
 if(calls.v1+calls.legacy>=callCap)throw Error("Hard read-only request cap");
 await pace();calls[url===HISTORY?"legacy":"v1"]++;
 const response=await fetch(url,{...init,cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(response.status===429)throw Error("API rate limited; no retry");
 if(!response.ok)throw Error("DNA API HTTP response rejected");
 let env;
 try{env=await response.json();}catch{throw Error("Non-JSON DNA API response");}
 if(!env||env.status!=="success"||!("result" in env))throw Error("DNA API semantic rejection");
 const remaining=response.headers.get("X-RateLimit-Remaining");
 if(remaining!==null && Number.isFinite(Number(remaining)) && Number(remaining)<1)throw Error("Remaining API rate budget exhausted");
 return env.result;
}
const v1=(path,body)=>call(V1+path,{method:body?"POST":"GET",headers:{"Authorization":"Bearer "+key,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
const history=(hid,page)=>call(HISTORY,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({hid,page})});
const ref=await fetch(V1+"/llm.txt",{cache:"no-store",signal:AbortSignal.timeout(20000)});
if(!ref.ok)throw Error("DNA public API reference unavailable");
const text=await ref.text();
if(text.length>1000000||!/races\/finished|vault\/info|rate.?limit/i.test(text))throw Error("Public API reference contract changed");
const rawCores=await v1("/vault/"+encodeURIComponent(vault)+"/cores_full");
if(!Array.isArray(rawCores)||rawCores.length<1||rawCores.length>500)throw Error("Vault inventory invalid");
const cores=rawCores.map(x=>({hid:id(x?.hid),name:String(x?.name??"Unnamed Core").trim().slice(0,100),element:String(x?.element??"unknown"),type:String(x?.type??"unknown"),records:[],complete:false}));
if(cores.some(x=>x.hid===null)||new Set(cores.map(x=>x.hid)).size!==cores.length)throw Error("Vault identity conflict");
cores.sort((a,b)=>a.hid-b.hid);
const byId=new Map(),seen=new Set();
let invalidHistory=0,unverifiedFormat=0;
for(const c of cores){
 let previousOldest=Infinity,ordered=true,closed=false;
 for(let page=1;page<=maxPages;page++){
  const rows=await history(c.hid,page);
  if(!Array.isArray(rows)||rows.length>50)throw Error("Historical API page invalid");
  if(rows.length===0){closed=true;break;}
  let oldest=Infinity,newest=-Infinity,prior=Infinity;
  for(const x of rows){
   const at=stamp(x?.start_time);
   if(id(x?.hid)!==c.hid||at===null){ordered=false;invalidHistory++;continue;}
   if(at>prior)ordered=false;prior=at;oldest=Math.min(oldest,at);newest=Math.max(newest,at);
   if(at<after||at>before||x?.rvmode!=="bike"||id(x?.rgate)!==2||![1000,1600,2200].includes(distance(x?.cb)))continue;
   const label=String(x?.race_name??x?.event_name??"");
   if(!(String(x?.format??x?.rformat??"").toLowerCase()==="sub_war"||/\b1v1\s*wars?\b/i.test(label))){unverifiedFormat++;continue;}
   const raceId=String(x?.rid??"");
   if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(raceId)||seen.has(raceId+"|"+c.hid))throw Error("Race/Core identity invalid or duplicated");
   seen.add(raceId+"|"+c.hid);
   const position=id(x.pos),seconds=n(x.time),d=distance(x.cb);
   if(position!==1&&position!==2)throw Error("Non 1v1 finish position in owner row");
   const rec={at,d,position,seconds,docId:raceId,legacyFee:x.fee,legacyPrizeUsd:x.prize_usd,legacyPrizeEth:x.prize_eth};
   c.records.push(rec);
   const refs=byId.get(raceId)||[];refs.push({c,rec});byId.set(raceId,refs);
  }
  if(newest>previousOldest)ordered=false;previousOldest=oldest;
  if(ordered&&oldest<=after){closed=true;break;}
 }
 c.complete=closed&&ordered;
}
const races=[...byId.keys()];
const hydrated=new Map(),docStatusCounts={},docPayoutCounts={},missingDocIds=[];
for(let i=0;i<races.length;i+=20){
 const ids=races.slice(i,i+20);
 const docs=await v1("/races/docs",{rids:ids});
 if(!Array.isArray(docs))throw Error("Race docs response invalid");
 for(const d of docs){
  const rid=String(d?.rid??"");
  if(!ids.includes(rid)||hydrated.has(rid))throw Error("Race doc identity mismatch");
  hydrated.set(rid,d);
  const status=String(d.status??"missing"),payout=String(d.payout??"missing");
  docStatusCounts[status]=(docStatusCounts[status]||0)+1;
  docPayoutCounts[payout]=(docPayoutCounts[payout]||0)+1;
 }
 for(const rid of ids)if(!hydrated.has(rid))missingDocIds.push(rid);
}
const all=[],statusCodes=new Map(),financialClasses=new Map(),tokenSamples=[];
let missingPriceRows=0,configMismatch=0,unprovenPayoutSettlement=0,legacyFeeCompare={equal:0,notEqual:0,unrecognised:0};
for(const [rid,entries] of byId){
 const doc=hydrated.get(rid);
 if(!doc){for(const item of entries){item.rec.financial={status:"race_doc_unavailable"};missingPriceRows++;}continue;}
 for(const {c,rec} of entries){
  let issue=null;
  if(doc.rvmode!==undefined&&doc.rvmode!=="bike")issue="race_mode_mismatch";
  const dd=distance(doc.cb);
  if(dd!==null && dd!==rec.d)issue="race_distance_mismatch";
  if(id(doc.rgate)!==2)issue="gate_count_mismatch";
  if(String(doc.payout??"").toLowerCase()!=="wta")issue="payout_rule_unsupported";
  const token=String(doc.paytoken??"").toUpperCase();
  if(!["DEZ","ETH"].includes(token))issue="unsupported_asset";
  const fee=decimalUnits(doc?.fee_fixed?.[token]);
  const payoutMap=doc?.prize_map;
  if(!payoutMap || typeof payoutMap!=="object" || Array.isArray(payoutMap))issue="payout_map_missing";
  const gross=decimalUnits(rec.position===1 ? payoutMap?.["1"] : payoutMap?.["2"]??0);
  const feeUsd=decimalUnits(doc?.feeusd);
  const prizeUsd=decimalUnits(rec.position===1 ? doc?.prizeusd : 0);
  if(fee===null||gross===null||feeUsd===null||prizeUsd===null)issue="financial_numbers_unavailable";
  if(typeof doc.prize==="number" && rec.position===1 && decimalUnits(doc.prize)!==gross)issue="gross_prize_map_mismatch";
  const confirming=doc.entry_txns_confirmed;
  const payoutTxns=doc.payout_txns;
  const payoutState=typeof payoutTxns==="object" && payoutTxns!==null ? "present_unreconciled":"absent_unreconciled";
  if(payoutState==="absent_unreconciled")unprovenPayoutSettlement++;
  const lf=decimalUnits(rec.legacyFee);
  if(lf===null)legacyFeeCompare.unrecognised++;
  else if(fee!==null && lf===fee)legacyFeeCompare.equal++;
  else legacyFeeCompare.notEqual++;
  const result=issue?{status:issue}:{status:"configured_complete",token,fee:decString(fee),gross:decString(gross),net:decString(gross-fee),nominalFeeUsd:decString(feeUsd),nominalGrossUsd:decString(prizeUsd),nominalNetUsd:decString(prizeUsd-feeUsd),sourcePaymentConfirmation:"unreconciled",payoutState};
  rec.financial=result;
  const status=result.status;statusCodes.set(status,(statusCodes.get(status)||0)+1);
  if(issue)configMismatch++;
 }
}
function summarise(records) {
 const n=records.length,w=records.filter(x=>x.position===1).length;
 const byAsset={};
 const valid=records.filter(x=>x.financial?.status==="configured_complete");
 for(const x of valid){
  const f=x.financial,a=byAsset[f.token]??{fee:0n,gross:0n,nomFee:0n,nomGross:0n,entries:0,wins:0};
  a.fee+=decimalUnits(f.fee);a.gross+=decimalUnits(f.gross);
  a.nomFee+=decimalUnits(f.nominalFeeUsd);a.nomGross+=decimalUnits(f.nominalGrossUsd);a.entries++;a.wins+=x.position===1?1:0;byAsset[f.token]=a;
 }
 return {starts:n,wins:w,losses:n-w,winRatePct:n?Math.round(1000*w/n)/10:null,financiallyVerifiedEntries:valid.length,financiallyUnverifiedEntries:n-valid.length,
 byAsset:Object.fromEntries(Object.entries(byAsset).map(([k,v])=>[k,{starts:v.entries,wins:v.wins,entryFees:decString(v.fee),grossPrizes:decString(v.gross),netConfiguredToken:decString(v.gross-v.fee),configuredUsdEntryFees:decString(v.nomFee),configuredUsdGrossPrizes:decString(v.nomGross),netConfiguredUsd:decString(v.nomGross-v.nomFee)}]))};
}
const perCore=cores.map(c=>({name:c.name,type:c.type,element:c.element,completeHistoryScan:c.complete,summary:summarise(c.records),
 byDistance:Object.fromEntries([1000,1600,2200].map(d=>[String(d),summarise(c.records.filter(x=>x.d===d))])),
 per24h:{older:summarise(c.records.filter(x=>x.at<before-24*3600000)),newer:summarise(c.records.filter(x=>x.at>=before-24*3600000))}}));
const allRecords=cores.flatMap(c=>c.records);
const fullData=perCore.filter(c=>c.completeHistoryScan).length===cores.length && allRecords.every(x=>x.financial?.status==="configured_complete")&&missingDocIds.length===0;
const report={generatedAt:new Date().toISOString(),event:"Season 12 Bike 1v1 Wars",
 window:{startUtc:new Date(after).toISOString(),endUtc:new Date(before).toISOString()},
 summary:summarise(allRecords),byDistance:Object.fromEntries([1000,1600,2200].map(d=>[String(d),summarise(allRecords.filter(x=>x.d===d))])),
 coverage:{totalOwnedCoreCount:cores.length,participants:perCore.filter(c=>c.summary.starts>0).length,
 fullyScannedCores:perCore.filter(c=>c.completeHistoryScan).length,raceCoreRows:allRecords.length,
 distinctRaceDocs:races.length,docsReceived:hydrated.size,invalidHistory,unverifiedFormat,
 financialCompleteness:fullData,configMismatch,missingPriceRows,unprovenPayoutSettlement,
 legacyFeeCompare,docStatusCounts,docPayoutCounts,financeRowStatuses:Object.fromEntries(statusCodes),
 readOnlyApiCalls:calls},
 perCore,interpretation:{
 tokenAmounts:"Actual race-config token fee_fixed/paytoken/prize_map matched to each Core's observed finish position; not a settled-wallet debit/credit audit.",
 usdAmounts:"Race documents' feeusd/prizeusd configuration reference only; no dated market conversion or AUD valuation.",
 deferred:"Individual on-chain payout_txn/fee-paid confirmations, refunds/voids, off-race tournament prizes, core valuation and wallet reconciliation not established.",
 recommendation:"Use event-specific observed results as retrospective screening only. Do not project winning rates forward from 10 starts."}};
await writeFile("owner-bike-1v1-48h-configuration-pl.json",JSON.stringify(report,null,2),"utf8");
console.log("PRIVATE_BIKE_WARS_PNL_SUMMARY="+JSON.stringify({
 starts:report.summary.starts,wins:report.summary.wins,losses:report.summary.losses,participants:report.coverage.participants,
 raceDocs:report.coverage.distinctRaceDocs,financiallyMatched:report.summary.financiallyVerifiedEntries,
 incomplete:report.summary.financiallyUnverifiedEntries,docStatuses:docStatusCounts,payoutTypes:docPayoutCounts,
 readCalls:calls}));
