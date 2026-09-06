import { mkdir, writeFile } from "node:fs/promises";
import { describe, it } from "vitest";

const enabled = process.env.DNA_ELITE_OPPONENT_ESPORTS_PULL === "1";
const describeConnected = enabled ? describe : describe.skip;
const TEAM_ID = "68082d17da";
const VAULT = "0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b";
const BASE = "https://api.dnaracing.run/fbike/esports";

type AnyRecord = Record<string, unknown>;
function rec(v:unknown):AnyRecord|null { return v!==null&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:null; }
function collectHids(value:unknown): number[] {
  const out=new Set<number>();
  const visit=(v:unknown):void=>{
    if(Array.isArray(v)){ for(const x of v) visit(x); return; }
    const r=rec(v); if(!r) return;
    for(const [k,x] of Object.entries(r)){
      if(/^(hid|core_id|core_hid)$/iu.test(k)){ const n=Number(x); if(Number.isSafeInteger(n)&&n>0) out.add(n); }
      visit(x);
    }
  };
  visit(value); return [...out].sort((a,b)=>a-b);
}

async function post(path:string,body:Record<string,unknown>,headerMode:"none"|"vault"="none"){
  const headers:Record<string,string>={"Content-Type":"application/json",Accept:"application/json","User-Agent":"DNA-Racing-Intelligence read-only research"};
  if(headerMode==="vault") headers["x-vault"]=VAULT;
  const r=await fetch(`${BASE}${path}`,{method:"POST",headers,body:JSON.stringify(body)});
  const text=await r.text(); let json:unknown=null; try{json=JSON.parse(text);}catch{/*ignore*/}
  return {status:r.status,json,text:json===null?text.slice(0,5000):null};
}

function usable(p:{status:number;json:unknown}):boolean{
  if(p.status<200||p.status>=300||p.json===null) return false;
  const r=rec(p.json); return r?.status!=="error";
}

describeConnected("temporary elite opponent esports data pull",()=>{
  it("pulls the public team contract with POST bodies used by the live frontend",async()=>{
    await mkdir("artifacts/temporary-elite-opponent-esports",{recursive:true});
    const attempts:Record<string,unknown>={}; let mode:"none"|"vault"="none"; let teamResponse:Awaited<ReturnType<typeof post>>|null=null;
    for(const headerMode of ["none","vault"] as const){
      const response=await post("/teams",{team_id:TEAM_ID},headerMode);
      attempts[headerMode]=response;
      if(usable(response)){mode=headerMode;teamResponse=response;break;}
    }
    if(!teamResponse){
      await writeFile("artifacts/temporary-elite-opponent-esports/esports.json",JSON.stringify({fetchedAt:new Date().toISOString(),teamId:TEAM_ID,vault:VAULT,attempts}),"utf8");
      return;
    }
    const P=(path:string,body:Record<string,unknown>)=>post(path,body,mode);
    const [vaultStats,maps,standings,seasonState,seasons,history,teamByVault,allTeams,raceTypes] = await Promise.all([
      P("/vault_stats",{team_id:TEAM_ID,of_vault:VAULT,season:0}),
      P("/maps",{}),
      P("/standings",{season:"active"}),
      P("/season_state",{}),
      P("/seasons",{}),
      P("/team/match_history",{team_id:TEAM_ID,limit:100,skip:0,bucket:null}),
      P("/team",{of_vault:VAULT}),
      P("/teams",{}),
      P("/race_types",{}),
    ]);
    const initial={
      team:teamResponse.json,vaultStats:vaultStats.json,maps:maps.json,standings:standings.json,
      seasonState:seasonState.json,seasons:seasons.json,history:history.json,teamByVault:teamByVault.json,
      allTeams:allTeams.json,raceTypes:raceTypes.json,
    };
    const hids=collectHids(initial);
    const hstats:unknown[]=[];
    for(const hid of hids){ const current=await P("/hstats",{hid,season:"all"}); hstats.push({hid,response:current.json,status:current.status}); }
    const coresByHids=hids.length?(await P("/cores_by_hids",{hids})).json:null;
    const eventIds=new Set<string>();
    const visitEvents=(v:unknown):void=>{ if(Array.isArray(v)){for(const x of v)visitEvents(x);return;} const r=rec(v); if(!r)return; for(const [k,x] of Object.entries(r)){if(/event_id/iu.test(k)&&typeof x==="string"&&x)eventIds.add(x);visitEvents(x);} };
    visitEvents(history.json);
    const events:unknown[]=[];
    for(const eventId of [...eventIds].slice(0,60)){ const ev=await P("/event",{event_id:eventId}); events.push({eventId,response:ev.json,status:ev.status}); }
    await writeFile("artifacts/temporary-elite-opponent-esports/esports.json",JSON.stringify({
      fetchedAt:new Date().toISOString(),teamId:TEAM_ID,vault:VAULT,base:BASE,headerMode:mode,attempts,initial,hids,hstats,coresByHids,eventIds:[...eventIds],events
    }),"utf8");
  },180_000);
});
