// One-time private financial-source discovery for the owner's last-48h Bike Wars results.
// Uses only read-only DNA API. NEVER merge into main; NO Neon/R2/transactions.
import {writeFile} from "node:fs/promises";
const base="https://api.dnaracing.run/fbike/pub/v1";
const key=process.env.DNA_OPEN_LAB_API_KEY_1??"";
const vault=process.env.DNA_OPEN_LAB_VAULT??"";
if(!/^dna_[A-Za-z0-9_-]{43}$/.test(key) || !vault || vault!==vault.trim())throw Error("Protected API inputs missing");
let last=0; let calls=0;
async function request(url,opts={}){
 const pause=2050-(Date.now()-last); if(pause>0) await new Promise(resolve=>setTimeout(resolve,pause));
 last=Date.now();calls++;if(calls>12)throw Error("Hard 12-request limit");
 const r=await fetch(url,{...opts,cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(r.status===429)throw Error("Read stopped on rate limit");
 if(!r.ok)throw Error("Provider HTTP reject "+r.status);
 const p=await r.json();
 if(p?.status!=="success" || !("result" in p))throw Error("Provider rejected response");
 return p.result;
}
const arr=await request(base+"/vault/"+encodeURIComponent(vault)+"/cores_full",{headers:{Authorization:"Bearer "+key,Accept:"application/json"}});
if(!Array.isArray(arr)||arr.length>500)throw Error("Vault inventory unavailable");
const targets=new Set(["she’s extreme","phantom panther","solar surge","lionel messi","flame dash"]);
const ids=arr.filter(x=>targets.has(String(x.name).toLowerCase())).slice(0,5).map(x=>x.hid);
if(ids.length<2)throw Error("Target examples not found");
const docsNeeded=[], history=[];
const winStart=Date.parse("2026-10-12T22:02:56Z"),winEnd=Date.parse("2026-10-14T22:02:56Z");
for(const hid of ids){
 const rows=await request("https://api.dnaracing.run/fbike/i/hraces",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({hid,page:1})});
 if(!Array.isArray(rows)||rows.length>50)throw Error("Invalid legacy history page");
 const exact=rows.filter(x=>{
  const t=Date.parse(x.start_time||"");
  const d=Number(x.cb)<100?Number(x.cb)*100:Number(x.cb);
  return t>=winStart&&t<=winEnd&&x.rvmode==="bike"&&Number(x.rgate)===2&&[1000,1600,2200].includes(d)&&(String(x.format||x.rformat).toLowerCase()==="sub_war"||/1v1 wars?/i.test(String(x.race_name||"")));
 }).slice(0,2);
 for(const x of exact){
  docsNeeded.push(x.rid);
  const financial={};
  for(const k of ["rfee","prize","toke_curr","rpayout","fee_fixed","feeusd","paytoken","prizeusd","prize_map","payout","rformat","format","eventtags"]){
   if(k in x)financial[k]=x[k];
  }
  history.push({source:"legacy",financial,fieldNames:Object.keys(x).sort()});
 }
}
const candidates=[...new Set(docsNeeded)].slice(0,8);
let docs=[];
if(candidates.length){
 const d=await request(base+"/races/docs",{method:"POST",headers:{Authorization:"Bearer "+key,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({rids:candidates})});
 if(!Array.isArray(d))throw Error("Race-doc sample malformed");
 docs=d.map(x=>{
  const financial={};
  for(const k of ["rfee","prize","toke_curr","rpayout","fee_fixed","feeusd","paytoken","prizeusd","prize_map","payout","rformat","format","eventtags"]){if(k in x)financial[k]=x[k];}
  return {source:"v1_docs",financial,fieldNames:Object.keys(x).sort()};
 });
}
const data={requestCount:calls,sampledHistoryRows:history.length,sampledRaceDocuments:docs.length,samples:{history,docs},note:"No race identifiers, core identifiers, names, secrets, or raw unredacted provider payloads persisted. Financial field values kept only inside temporary private artifact."};
await writeFile("owner-bike-1v1-finance-contract-probe.json",JSON.stringify(data,null,2),"utf8");
console.log(JSON.stringify({probe:"success",apiCalls:calls,historySampleCount:history.length,raceDocumentSamples:docs.length,historyFinanceFieldCoverage:history.filter(z=>"rfee" in z.financial && "prize" in z.financial&&"toke_curr" in z.financial).length,docFinanceFieldCoverage:docs.filter(z=>"fee_fixed" in z.financial||"feeusd" in z.financial).length}));
