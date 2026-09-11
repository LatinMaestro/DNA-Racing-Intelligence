import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { crawlDnaFinishedRaceWindows } from "../lib/dna-open-lab-finished-race-window-crawler";
import { writeFile } from "node:fs/promises";

const connected=process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY==="1";
const describeConnected=connected?describe:describe.skip;
function env(name:string){const v=process.env[name];if(!v)throw new Error(`${name} missing`);return v;}
function chunks<T>(values:readonly T[],n:number):T[][]{const out:T[][]=[];for(let i=0;i<values.length;i+=n)out.push(values.slice(i,i+n));return out;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describeConnected("temporary throttled complete race crawl",()=>{
  it("crawls owner races since 10 Sep UTC",async()=>{
    const client=createDnaOpenLabV1Client({apiKey:env("DNA_OPEN_LAB_API_KEY_2")});
    const vault=env("DNA_OPEN_LAB_VAULT"); const ids=(await client.vaultCores(vault)).result; const owned=new Set(ids);
    const endTime=new Date().toISOString(); const startTime="2026-09-10T00:00:00.000Z";
    const crawl=await crawlDnaFinishedRaceWindows({startTime,endTime,minimumWindowMilliseconds:60_000,
      fetchWindow:async(w)=>{await sleep(500);return (await client.racesFinished(w)).result;}});
    const ownerDocs:unknown[]=[]; let hydrated=0;
    for(const batch of chunks(crawl.races.map(r=>r.rid),20)){
      await sleep(500); const docs=(await client.raceDocs(batch)).result; hydrated+=docs.length;
      for(const doc of docs){if((doc.hids??[]).some(h=>owned.has(h)))ownerDocs.push(doc);}
    }
    await writeFile("temporary-chat-complete-race-window.json",JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault,startTime,endTime,crawl:{requestCount:crawl.requestCount,splitCount:crawl.splitCount,totalIndex:crawl.races.length,hydrated},ownerDocs}));
    expect(ownerDocs.length).toBeGreaterThan(0);
  },1_500_000);
});
