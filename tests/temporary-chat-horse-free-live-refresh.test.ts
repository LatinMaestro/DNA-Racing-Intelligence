import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client, type DnaRaceIdentifier } from "@/lib/dna-open-lab-v1-client";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";

const enabled = process.env.HORSE_FREE_REFRESH_AUDIT === "1";
const apiKey = process.env.DNA_OPEN_LAB_API_KEY_1 ?? "";
const vault = process.env.DNA_OPEN_LAB_VAULT ?? "";
const MAX_RACE_DOCS = 800;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output:T[][]=[];
  for(let i=0;i<values.length;i+=size) output.push([...values.slice(i,i+size)]);
  return output;
}
async function wait(ms:number){await new Promise(r=>setTimeout(r,ms))}
function raceId(value:unknown):DnaRaceIdentifier|null{
  if(typeof value==="number"&&Number.isSafeInteger(value)&&value>0)return value;
  if(typeof value!=="string")return null;
  const n=value.trim();return n?n:null;
}

describe.runIf(enabled)("temporary Horse Free live refresh audit",()=>{
  it("captures current owned Horse stats and newest result history without writes",async()=>{
    if(!apiKey||!vault) throw new Error("Horse Free refresh settings unavailable");
    const client=createDnaOpenLabV1Client({apiKey});
    const history=createDnaCoreRaceHistoryClient();

    // Conservative shared provider pacing: no more than ~28 requests/minute.
    let last=0;
    async function paced<T>(fn:()=>Promise<T>):Promise<T>{
      const now=Date.now();
      const delay=Math.max(0,2150-(now-last));
      if(delay) await wait(delay);
      last=Date.now();
      return await fn();
    }

    await paced(()=>client.testAuth());
    const owned=[...new Set((await paced(()=>client.vaultCores(vault))).result)]
      .filter(x=>Number.isSafeInteger(x)&&x>0)
      .sort((a,b)=>a-b);
    if(owned.length===0) throw new Error("Horse Free refresh found no owned Cores");

    const coreInfo=[]; const racingStats=[];
    for(const group of chunks(owned,20)){
      coreInfo.push(...(await paced(()=>client.coreInfoBulk(group))).result);
      racingStats.push(...(await paced(()=>client.coreRacingStatsBulk(group))).result);
    }

    const newestHistory:Record<string,unknown[]>={};
    const recentHorseRaceIds=new Map<string,DnaRaceIdentifier>();
    for(const hid of owned){
      const rows=[...(await paced(()=>history.page({coreId:hid,page:1}))).result];
      newestHistory[String(hid)]=rows;
      for(const row of rows){
        if(row.rvmode!=="horse") continue;
        const rid=raceId(row.rid);
        if(rid!==null && recentHorseRaceIds.size<MAX_RACE_DOCS) recentHorseRaceIds.set(String(rid),rid);
      }
    }

    const raceDocs=[];
    for(const group of chunks([...recentHorseRaceIds.values()],20)){
      raceDocs.push(...(await paced(()=>client.raceDocs(group))).result);
    }

    const payload={
      generatedAt:new Date().toISOString(),
      source:"fresh_read_only_api_pull",
      ownedCoreCount:owned.length,
      ownedCoreIds:owned,
      coreInfo,
      racingStats,
      newestHistory,
      recentHorseRaceDocs:raceDocs,
    };
    await writeFile("horse-free-live-refresh.json",JSON.stringify(payload,null,2),"utf8");
    expect(coreInfo.length).toBe(owned.length);
    expect(racingStats.length).toBe(owned.length);
  }, 14*60*1000);
});
