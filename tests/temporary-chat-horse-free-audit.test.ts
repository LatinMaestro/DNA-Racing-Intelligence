import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import {
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
  type DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import {
  createDnaCoreRaceHistoryClient,
  dnaCoreRaceHistoryRaceIdentifier,
  type DnaCoreRaceHistoryRow,
} from "@/lib/dna-core-race-history-client";

const enabled = process.env.HORSE_FREE_AUDIT === "1";
const apiKey = process.env.DNA_OPEN_LAB_API_KEY_1 ?? "";
const vault = process.env.DNA_OPEN_LAB_VAULT ?? "";
const MAX_HISTORY_PAGES = 3;
const PAGE_SIZE = 50;
const RECENT_CUTOFF_MS = Date.parse("2026-09-10T00:00:00.000Z");
const REQUEST_INTERVAL_MS = 2050;
const BULK_SIZE = 20;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out:T[][]=[];
  for(let i=0;i<items.length;i+=size) out.push([...items.slice(i,i+size)]);
  return out;
}
function freeRaceName(value: unknown): boolean {
  return typeof value === "string" && /\bFree\b/iu.test(value);
}
function eventTime(row: DnaCoreRaceHistoryRow): number | null {
  if (typeof row.start_time !== "string") return null;
  const parsed = Date.parse(row.start_time);
  return Number.isFinite(parsed) ? parsed : null;
}
function positiveIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((x): x is number => Number.isSafeInteger(x) && Number(x) > 0)
    : [];
}

describe.runIf(enabled)("temporary Horse Free discovery audit", () => {
  it("captures current owned Horse evidence and recent Free fields", async () => {
    if (!/^dna_[A-Za-z0-9_-]{43}$/u.test(apiKey)) throw new Error("API key unavailable");
    if (!vault.trim()) throw new Error("Vault unavailable");

    const api=createDnaOpenLabV1Client({apiKey});
    const history=createDnaCoreRaceHistoryClient();
    let lastStarted=0;
    async function paced<T>(fn:()=>Promise<T>):Promise<T>{
      const wait=Math.max(0,REQUEST_INTERVAL_MS-(Date.now()-lastStarted));
      if(wait>0) await new Promise(r=>setTimeout(r,wait));
      lastStarted=Date.now();
      return await fn();
    }

    const owned=(await paced(()=>api.vaultCores(vault))).result
      .filter((x):x is number=>Number.isSafeInteger(x)&&x>0)
      .sort((a,b)=>a-b);
    if(owned.length<1) throw new Error("Owned Core list is empty");

    const coreInfo:unknown[]=[];
    const racingStats:unknown[]=[];
    const power:unknown[]=[];
    for(const group of chunks(owned,BULK_SIZE)){
      coreInfo.push(...(await paced(()=>api.coreInfoBulk(group))).result);
      racingStats.push(...(await paced(()=>api.coreRacingStatsBulk(group))).result);
      power.push(...(await paced(()=>api.corePowerBulk(group))).result);
    }

    const histories:Record<string,DnaCoreRaceHistoryRow[]>={};
    const recentHorseFreeRaceIds=new Map<string,DnaRaceIdentifier>();
    for(const hid of owned){
      const rows:DnaCoreRaceHistoryRow[]=[];
      for(let page=1;page<=MAX_HISTORY_PAGES;page++){
        const response=await paced(()=>history.page({coreId:hid,page}));
        rows.push(...response.result);
        for(const row of response.result){
          if(row.rvmode!=="horse" || !freeRaceName(row.race_name)) continue;
          const rid=dnaCoreRaceHistoryRaceIdentifier(row.rid);
          if(rid!==null) recentHorseFreeRaceIds.set(String(rid),rid);
        }
        if(response.result.length<PAGE_SIZE) break;
        const times=response.result.map(eventTime).filter((x):x is number=>x!==null);
        if(times.length>0 && Math.min(...times)<=RECENT_CUTOFF_MS) break;
      }
      histories[String(hid)]=rows;
    }

    const raceDocs:unknown[]=[];
    for(const group of chunks([...recentHorseFreeRaceIds.values()],BULK_SIZE)){
      raceDocs.push(...(await paced(()=>api.raceDocs(group))).result);
    }

    const participantIds=new Set<number>(owned);
    for(const raw of raceDocs){
      if(raw && typeof raw==="object" && !Array.isArray(raw)){
        for(const hid of positiveIds((raw as Record<string,unknown>).hids)) participantIds.add(hid);
      }
    }
    const externalIds=[...participantIds].filter(hid=>!owned.includes(hid)).sort((a,b)=>a-b);
    const externalInfo:unknown[]=[];
    const externalStats:unknown[]=[];
    for(const group of chunks(externalIds,BULK_SIZE)){
      externalInfo.push(...(await paced(()=>api.coreInfoBulk(group))).result);
      externalStats.push(...(await paced(()=>api.coreRacingStatsBulk(group))).result);
    }

    const payload={
      generatedAt:new Date().toISOString(),
      recentCutoff:"2026-09-10T00:00:00.000Z",
      maximumHistoryPages:MAX_HISTORY_PAGES,
      ownedCoreIds:owned,
      coreInfo,
      racingStats,
      power,
      histories,
      recentHorseFreeRaceDocs:raceDocs,
      externalInfo,
      externalStats,
    };
    await writeFile("horse-free-discovery-audit.json",JSON.stringify(payload,null,2),"utf8");
    expect(owned.length).toBeGreaterThan(0);
    expect(coreInfo.length).toBe(owned.length);
    expect(racingStats.length).toBe(owned.length);
  }, 40*60_000);
});