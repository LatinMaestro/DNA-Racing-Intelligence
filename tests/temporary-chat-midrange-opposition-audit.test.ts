import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "@/lib/dna-open-lab-v1-client";

const enabled=process.env.MIDRANGE_OPPOSITION_AUDIT==="1";
const apiKey=process.env.DNA_OPEN_LAB_API_KEY_1??"";
const RACE_IDS=[
"36d0afe348","54904f58c3","6d7db82682","b65e0d05d7","cb6f30215b","43bc805fa3","47d05ded34","a7310b3782","a170200e10","da0072def0","c7f48d109e","fcc64af4b7","51b441f966",
"45ceeb1837","b98b6e54bd","8839d94087","394f500eb9","87164bafd5","4f3cee0f5b","84b19de936","581cfced89","8fe3d620ff","1c1df8c982","1698e33eaa","02e14dc6dd","a7bbeb0401"
] as const;
function chunks<T>(items:readonly T[],size:number):T[][]{const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push([...items.slice(i,i+size)]);return out}
async function wait(ms:number){await new Promise(r=>setTimeout(r,ms))}
function numberIds(v:unknown):number[]{return Array.isArray(v)?v.filter((x):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0):[]}

describe.runIf(enabled)("temporary midrange opposition audit",()=>{
 it("hydrates the 1400 star fields for Core Oracle and Phantom Panther",async()=>{
  if(!apiKey)throw new Error("API key unavailable");
  const client=createDnaOpenLabV1Client({apiKey});let last=0;
  async function paced<T>(fn:()=>Promise<T>):Promise<T>{const now=Date.now();const delay=Math.max(0,2200-(now-last));if(delay)await wait(delay);last=Date.now();return await fn()}
  const raceDocs=[];for(const g of chunks(RACE_IDS,20))raceDocs.push(...(await paced(()=>client.raceDocs(g))).result);
  const ids=new Set<number>();for(const d of raceDocs)for(const hid of numberIds(d.hids))ids.add(hid);
  const coreInfo=[];const racingStats=[];
  for(const g of chunks([...ids],20))coreInfo.push(...(await paced(()=>client.coreInfoBulk(g))).result);
  for(const g of chunks([...ids],20))racingStats.push(...(await paced(()=>client.coreRacingStatsBulk(g))).result);
  await writeFile("midrange-opposition-audit.json",JSON.stringify({generatedAt:new Date().toISOString(),raceDocs,coreInfo,racingStats},null,2),"utf8");
  expect(raceDocs.length).toBe(RACE_IDS.length);
 },120_000);
});