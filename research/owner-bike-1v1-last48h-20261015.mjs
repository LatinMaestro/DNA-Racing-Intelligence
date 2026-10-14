// Temporary owner-requested read-only DNA API report. NEVER MERGE.
import { writeFile } from "node:fs/promises";
const BASE="https://api.dnaracing.run/fbike/pub/v1";
const HIST="https://api.dnaracing.run/fbike/i/hraces";
const key=process.env.DNA_OPEN_LAB_API_KEY_1??"";
const vault=process.env.DNA_OPEN_LAB_VAULT??"";
if(!/^dna_[A-Za-z0-9_-]{43}$/.test(key)||!vault||vault.length>4096||vault!==vault.trim())throw Error("Protected read-only credentials missing");
const end=Date.parse("2026-10-14T22:02:56.000Z");
const start=end-48*3600000;
const quota=340, pageMax=5;
const total={v1:0,legacy:0};
let last=0;
async function request(url,options={}){
 if(total.v1+total.legacy>=quota)return {capped:true};
 const delay=2150-(Date.now()-last);if(delay>0)await new Promise(r=>setTimeout(r,delay));
 last=Date.now();
 total[url===HIST?"legacy":"v1"]++;
 const response=await fetch(url,{...options,cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(response.status===429)throw Error("API 429: stopped without retry");
 if(!response.ok)throw Error("DNA API HTTP rejection: "+response.status);
 let envelope;try{envelope=await response.json();}catch{throw Error("DNA API non-JSON response");}
 if(envelope?.status!=="success"||!("result" in envelope))throw Error("DNA API error envelope");
 return {result:envelope.result};
}
const v1=path=>request(BASE+path,{headers:{"Authorization":"Bearer "+key,"Accept":"application/json"}});
const history=(hid,page)=>request(HIST,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({hid,page})});
const num=v=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:null;};
const int=v=>{const x=num(v);return x!==null&&Number.isSafeInteger(x)?x:null;};
const distance=v=>{const x=int(v);return x===null?null:x<100?x*100:x;};
const timestamp=v=>{if(typeof v!=="string")return null;const x=Date.parse(v);return Number.isFinite(x)?x:null;};
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);return Math.round((s.length%2?s[i]:(s[i-1]+s[i])/2)*1000)/1000;};
const rnd=x=>Math.round(x*1000)/1000;
function summarise(rows){
 const placed=rows.filter(x=>x.position===1||x.position===2);
 const times=rows.map(x=>x.seconds).filter(x=>x!==null);
 const wins=placed.filter(x=>x.position===1).length;
 return {starts:rows.length,wins,losses:placed.length-wins,unknownFinishes:rows.length-placed.length,
  winRatePct:placed.length?rnd(wins*100/placed.length):null,medianSeconds:median(times),
  bestSeconds:times.length?rnd(Math.min(...times)):null,timeSamples:times.length,
  first24h:rows.filter(x=>x.at<end-24*3600000).length,
  last24h:rows.filter(x=>x.at>=end-24*3600000).length};
}
function byDistance(rows){return Object.fromEntries([1000,1600,2200].map(d=>[String(d),summarise(rows.filter(x=>x.distance===d))]));}
const reference=await fetch(BASE+"/llm.txt",{cache:"no-store",signal:AbortSignal.timeout(20000)});
if(!reference.ok)throw Error("Public source reference unavailable");
const doc=await reference.text();
if(doc.length>1000000||!/races\/finished|vault\/info|rate.?limit/i.test(doc))throw Error("Public API reference contract not recognised");
const owner=(await v1("/vault/"+encodeURIComponent(vault)+"/cores_full")).result;
if(!Array.isArray(owner)||!owner.length||owner.length>500)throw Error("Vault inventory malformed");
const cores=owner.map(x=>({hid:int(x?.hid),name:String(x?.name??"Unnamed Core").slice(0,100),
 type:String(x?.type??x?.core_type??x?.ctype??"unverified"),element:String(x?.element??"unverified"),war:[],twoGate:[],scanned:false,status:"not scanned"}));
if(cores.some(x=>x.hid===null)||new Set(cores.map(x=>x.hid)).size!==cores.length)throw Error("Vault Core identities invalid");
cores.sort((a,b)=>a.hid-b.hid);
const seen=new Set();
let invalidRows=0,duplicateRows=0,uncertainFormats=0,lastRaceAt=null;
for(const c of cores){
 let previousOldest=Infinity,sorted=true,done=false;
 for(let page=1;page<=pageMax;page++){
  const answer=await history(c.hid,page);
  if(answer.capped){c.status="global bounded request cap";break;}
  const rows=answer.result;
  if(!Array.isArray(rows)||rows.length>50){c.status="invalid API pagination";break;}
  if(rows.length===0){done=true;c.status="explicit empty page";break;}
  let oldest=Infinity,newest=-Infinity,prior=Infinity;
  for(const x of rows){
   const t=timestamp(x?.start_time);
   if(int(x?.hid)!==c.hid||t===null){invalidRows++;sorted=false;continue;}
   if(t>prior)sorted=false;prior=t;oldest=Math.min(oldest,t);newest=Math.max(newest,t);
   if(t<start||t>end||x?.rvmode!=="bike")continue;
   const d=distance(x?.cb),g=int(x?.rgate);
   if(g!==2||![1000,1600,2200].includes(d))continue;
   const raceId=String(x?.rid??"");
   if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(raceId)){invalidRows++;continue;}
   const pair=raceId+"|"+c.hid;
   if(seen.has(pair)){duplicateRows++;continue;}seen.add(pair);
   const p=int(x?.pos);const seconds=num(x?.time);
   const v={at:t,distance:d,position:p===1||p===2?p:null,seconds:seconds===null?null:rnd(seconds)};
   const format=String(x?.format??x?.rformat??"").toLowerCase().trim();
   const title=String(x?.race_name??x?.event_name??"").toLowerCase();
   if(format==="sub_war"||/\b1v1\s*wars?\b/.test(title))c.war.push(v);
   else{c.twoGate.push(v);uncertainFormats++;}
   if(lastRaceAt===null||t>lastRaceAt)lastRaceAt=t;
  }
  if(newest>previousOldest)sorted=false;
  previousOldest=oldest;
  if(sorted&&oldest<=start){done=true;c.status="reached prior 48-hour boundary";break;}
  if(page===pageMax)c.status="per-Core page cap";
 }
 c.scanned=done&&sorted;
 if(!c.scanned&&c.status==="not scanned")c.status="ordering evidence incomplete";
 if(total.v1+total.legacy>=quota)break;
}
const named=new Map();
const label=c=>{const n=c.name,k=named.get(n)||0;named.set(n,k+1);return k?n+" (duplicate name "+(k+1)+")":n;};
const verified=cores.flatMap(x=>x.war),ambiguous=cores.flatMap(x=>x.twoGate);
const complete=cores.filter(x=>x.scanned).length;
const report={event:"Bike 1v1 Wars",window:{startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString(),timezone:"Australia/Brisbane"},
 method:"Only Bike mode, two gates, exact 1000/1600/2200 metres, with explicit sub_war or 1v1 Wars label are confirmed event rows.",
 coverage:{vaultCoreCount:cores.length,fullyScannedCoreCount:complete,complete:complete===cores.length,
  participatedCores:cores.filter(x=>x.war.length).length,readRequests:total,invalidRows,duplicateRows,uncertainFormats,
  lastMatchedRaceAt:lastRaceAt===null?null:new Date(lastRaceAt).toISOString()},
 vault:summarise(verified),distances:byDistance(verified),
 unidentifiedTwoGate:summarise(ambiguous),
 perCore:cores.map(x=>({name:label(x),type:x.type,element:x.element,scanComplete:x.scanned,reason:x.scanned?null:x.status,
  event:summarise(x.war),distances:byDistance(x.war),unverifiedTwoGate:summarise(x.twoGate)})),
 caveats:["Per-Core observed win percentage is descriptive, not calibrated tournament P(win).",
 "Generic two-gate results with unverified event identity are reported separately.",
 "No verified payout, fee, EV or monetary profit was available from this read-only outcome scan.",
 "No Neon, R2, data write, race entry, game or financial operation."]};
await writeFile("owner-bike-1v1-last48h-aggregate.json",JSON.stringify(report,null,2),"utf8");
console.log("SAFE_OWNER_1V1_AGGREGATE="+JSON.stringify({startUtc:report.window.startUtc,endUtc:report.window.endUtc,
 ownerCores:cores.length,scanned:complete,participatingCores:report.coverage.participatedCores,
 eventStarts:report.vault.starts,eventWins:report.vault.wins,eventLosses:report.vault.losses,
 ambiguousTwoGate:report.unidentifiedTwoGate.starts,apiCalls:total,complete:report.coverage.complete}));
