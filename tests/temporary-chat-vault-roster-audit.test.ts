import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import {
  createDnaOpenLabV1Client,
  type DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";

const enabled = process.env.VAULT_ROSTER_AUDIT === "1";
const apiKey = process.env.DNA_OPEN_LAB_API_KEY_1 ?? "";

const TARGET_IDS = [
  25657,25678,23484,22338,23283,22128,20775,20524,20274,9166,
  21752,20376,25565,10830,12866,25647,25676,25650,
] as const;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)]);
  return out;
}
async function wait(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
function raceId(v: unknown): DnaRaceIdentifier | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v !== "string") return null;
  const s=v.trim(); return s ? s : null;
}
function numberIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((x): x is number => typeof x==="number" && Number.isSafeInteger(x) && x>0) : [];
}

describe.runIf(enabled)("temporary full-vault roster challenger audit", () => {
  it("captures challenger histories, race documents and opposition strength without writes", async () => {
    if (!apiKey) throw new Error("API key unavailable");
    const client=createDnaOpenLabV1Client({apiKey});
    const history=createDnaCoreRaceHistoryClient();
    let last=0;
    async function paced<T>(fn:()=>Promise<T>):Promise<T>{
      const now=Date.now(); const delay=Math.max(0,2100-(now-last));
      if(delay) await wait(delay); last=Date.now(); return await fn();
    }

    const targetHistory:Record<string,unknown[]>={};
    const raceIds=new Map<string,DnaRaceIdentifier>();
    for(const hid of TARGET_IDS){
      const rows=[...(await paced(()=>history.page({coreId:hid,page:1}))).result];
      targetHistory[String(hid)]=rows;
      for(const row of rows){
        if(row.rvmode!=="bike") continue;
        const rid=raceId(row.rid); if(rid!==null) raceIds.set(String(rid),rid);
      }
    }

    const raceDocs=[];
    for(const group of chunks([...raceIds.values()],20)){
      raceDocs.push(...(await paced(()=>client.raceDocs(group))).result);
    }

    const participantIds=new Set<number>(TARGET_IDS);
    for(const doc of raceDocs){
      for(const hid of numberIds(doc.hids)) participantIds.add(hid);
    }
    const ids=[...participantIds].sort((a,b)=>a-b);
    const coreInfo=[]; const racingStats=[]; const power=[];
    for(const group of chunks(ids,20)) coreInfo.push(...(await paced(()=>client.coreInfoBulk(group))).result);
    for(const group of chunks(ids,20)) racingStats.push(...(await paced(()=>client.coreRacingStatsBulk(group))).result);
    for(const group of chunks(ids,20)) power.push(...(await paced(()=>client.corePowerBulk(group))).result);

    const payload={generatedAt:new Date().toISOString(),targetIds:TARGET_IDS,targetHistory,raceDocs,coreInfo,racingStats,power};
    await writeFile("vault-roster-audit.json",JSON.stringify(payload,null,2),"utf8");
    expect(raceDocs.length).toBeGreaterThan(0);
  },270_000);
});