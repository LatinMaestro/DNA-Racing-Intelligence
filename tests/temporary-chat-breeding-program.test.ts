import { describe, expect, it } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.TEMP_CHAT_BREEDING_PROGRAM === "1";
const d = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";

function env(name: string): string {
  const v = process.env[name]?.trim() ?? "";
  if (!v) throw new Error(`${name} missing`);
  return v;
}
function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out:T[][]=[]; for(let i=0;i<xs.length;i+=n) out.push(xs.slice(i,i+n) as T[]); return out;
}

d("temporary current breeding program pull",()=>{
  it("pulls current vault splice state, parentage and bike arena", async()=>{
    const client=createDnaOpenLabV1Client({apiKey:env("DNA_OPEN_LAB_API_KEY_1")});
    const cores=(await client.vaultCoresFull(VAULT)).result;
    const ids=cores.map(c=>c.hid);
    const splicing:unknown[]=[];
    for(const batch of chunks(ids,20)){
      splicing.push(...((await client.coreSplicingInfoBulk(batch)).result as unknown[]));
      await new Promise(r=>setTimeout(r,450));
    }
    const arena:unknown[]=[];
    let page=1;
    for(;page<=25;page++){
      const result=(await client.spliceArena({filter:{rvmode:"bike"},page})).result;
      arena.push(...(result.cores as unknown[]));
      if(!result.has_more) break;
      await new Promise(r=>setTimeout(r,450));
    }
    const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,cores,splicing,arena,pages:page};
    await mkdir("artifacts",{recursive:true});
    await writeFile("artifacts/temporary-chat-breeding-program.json",JSON.stringify(out,null,2));
    expect(cores.length).toBeGreaterThan(100);
    expect(splicing.length).toBe(cores.length);
    expect(arena.length).toBeGreaterThan(0);
  }, 900000);
});
