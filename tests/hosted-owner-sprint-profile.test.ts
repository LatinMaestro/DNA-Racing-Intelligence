import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";

type AnyRecord = Record<string, any>;
function required(name: string) {
  const v = process.env[name];
  if (!v || v.trim() !== v) throw new Error(`${name} missing`);
  return v;
}
function chunks<T>(xs: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
function num(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function metric(v: any) {
  return num(v?.fill?.per ?? v?.per ?? v?.val, 0);
}

describeConnected("owner sprint breeding profile", () => {
  it("captures live all-distance racing profiles for owned and Arena bike Cores", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let last = 0;
    let calls = 0;
    const paced = async <T>(fn: () => Promise<T>) => {
      const wait = 2100 - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const v = await fn();
      last = Date.now();
      calls++;
      return v;
    };

    const owned = (await paced(() => client.vaultCoresFull(OWNER_VAULT))).result;
    const arenaCores: AnyRecord[] = [];
    for (let page = 1; page <= 20; page++) {
      const x = (await paced(() => client.spliceArena({ filter: { rvmode: "bike" }, page }))).result;
      arenaCores.push(...x.cores);
      if (!x.has_more) break;
    }

    const sources = new Map<number, "vault" | "arena">();
    for (const x of owned) sources.set(Number(x.hid), "vault");
    for (const x of arenaCores) if (!sources.has(Number(x.hid))) sources.set(Number(x.hid), "arena");
    const hids = [...sources.keys()];

    const info: AnyRecord[] = [];
    const stats: AnyRecord[] = [];
    const power: AnyRecord[] = [];
    for (const batch of chunks(hids, 20)) {
      info.push(...(await paced(() => client.coreInfoBulk(batch))).result);
      stats.push(...(await paced(() => client.coreRacingStatsBulk(batch))).result);
      power.push(...(await paced(() => client.corePowerBulk(batch))).result);
    }

    const I = new Map(info.map((x) => [Number(x.hid), x]));
    const S = new Map(stats.map((x) => [Number(x.hid), x]));
    const P = new Map(power.map((x) => [Number(x.hid), x]));
    const parents = hids.map((hid) => {
      const i = I.get(hid) ?? {};
      const s = S.get(hid) ?? {};
      const p = P.get(hid)?.power?.bike ?? {};
      return {
        hid,
        name: String(i.name ?? hid),
        source: sources.get(hid),
        gender: String(i.gender ?? "").toLowerCase(),
        element: String(i.element ?? "").toLowerCase(),
        type: String(i.type ?? "").toLowerCase(),
        fno: num(i.fno, 0),
        power: metric(p.power),
        adj: metric(p.adjodds),
        variance: metric(p.variance),
        races: num(p.races_n, 0),
        hstats_bike: s.hstats_bike ?? null,
        ageing: s.ageing ?? null,
      };
    });

    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/owner-sprint-profile.json",
      JSON.stringify({
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        apiCalls: calls,
        ownerCoreCount: owned.length,
        arenaCoreCount: arenaCores.length,
        uniqueParentCount: hids.length,
        parents,
      }),
    );
    expect(parents.length).toBeGreaterThanOrEqual(250);
  }, 10 * 60_000);
});
