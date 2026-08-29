import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const BASELINE_ROSTER = [583,170,11848,15833,9537,19802,20292,10980,8902,19423,14540,16757,1675,12254,9926,16515,9918,20365,20376,16148,9089,949,8431,20274,823] as const;

type AnyRecord = Record<string, any>;
type Hist = {
  hid: number;
  rid: string;
  distance: number;
  gate: number;
  time: number;
  speed: number;
  star: unknown;
  family: "wta" | "madness" | "1v1" | "generic";
  evidence: "normal_free" | "esports" | "competitive";
  startTime: string;
  raceName: string;
};

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
function familyOf(r: AnyRecord): Hist["family"] {
  const gate = num(r.rgate, 0);
  const descriptor = [r.format, r.race_name, r.payout]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
    .toLowerCase();
  if (gate === 2 || descriptor.includes("1v1")) return "1v1";
  if (descriptor.includes("wta") || descriptor.includes("winner take all")) return "wta";
  if (descriptor.includes("mad") || descriptor.includes("variance")) return "madness";
  return "generic";
}
function evidenceOf(r: AnyRecord): Hist["evidence"] {
  const name = String(r.race_name ?? "");
  const format = String(r.format ?? "").toLowerCase();
  if (/\bfree\b/i.test(name)) return "normal_free";
  if (format.includes("esport") || /\b(anchor|glory|measure|miracles)\b/i.test(name)) return "esports";
  return "competitive";
}
function normHistory(hid: number, r: AnyRecord): Hist | null {
  if (String(r.rvmode ?? "").toLowerCase() !== "bike") return null;
  const cb = num(r.cb, 0);
  const distance = cb >= 100 ? cb : cb * 100;
  const time = num(r.time ?? r.rtime ?? r.elapsed, 0);
  const gate = num(r.rgate, 0);
  if (distance < 900 || distance > 2300 || time <= 0 || gate < 2) return null;
  return {
    hid,
    rid: String(r.rid ?? r.rhid ?? `${hid}:${r.start_time ?? ""}:${distance}:${time}`),
    distance,
    gate,
    time,
    speed: distance / time,
    star: r.star ?? null,
    family: familyOf(r),
    evidence: evidenceOf(r),
    startTime: String(r.start_time ?? ""),
    raceName: String(r.race_name ?? ""),
  };
}
function raceCount(stats: AnyRecord, distance: number) {
  return num(stats?.hstats_bike?.[String(distance / 100)]?.races_n, 0);
}

describeConnected("owner sprint breeding profile", () => {
  it("captures live all-distance shape plus expanded timing evidence for sprint-biased parents", async () => {
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
    const legacy = async (hid: number, page: number) =>
      paced(async () => {
        const res = await fetch("https://api.dnaracing.run/fbike/i/hraces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hid, page }),
        });
        const body: any = await res.json();
        if (!body || !Array.isArray(body.result)) throw new Error(`hraces ${hid}/${page} malformed`);
        return body.result as AnyRecord[];
      });

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
    const splicing: AnyRecord[] = [];
    for (const batch of chunks(hids, 20)) {
      info.push(...(await paced(() => client.coreInfoBulk(batch))).result);
      stats.push(...(await paced(() => client.coreRacingStatsBulk(batch))).result);
      power.push(...(await paced(() => client.corePowerBulk(batch))).result);
      splicing.push(...(await paced(() => client.coreSplicingInfoBulk(batch))).result);
    }

    const I = new Map(info.map((x) => [Number(x.hid), x]));
    const S = new Map(stats.map((x) => [Number(x.hid), x]));
    const P = new Map(power.map((x) => [Number(x.hid), x]));
    const X = new Map(splicing.map((x) => [Number(x.hid), x]));

    const parents = hids.map((hid) => {
      const i = I.get(hid) ?? {};
      const s = S.get(hid) ?? {};
      const p = P.get(hid)?.power?.bike ?? {};
      const counts: Record<string, number> = {};
      for (let k = 9; k <= 23; k++) counts[String(k * 100)] = raceCount(s, k * 100);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const target = counts["1000"] + counts["1200"] + counts["1400"];
      const sprintBand = [900,1000,1100,1200,1300,1400,1500].reduce((a, x) => a + counts[String(x)], 0);
      const targetShare = total ? target / total : 0;
      const sprintShare = total ? sprintBand / total : 0;
      const targetConfidence = Math.min(1, Math.log1p(target) / Math.log(401));
      const powerN = metric(p.power);
      const adj = metric(p.adjodds);
      const selectionScore = 55 * (0.58 * targetShare + 0.42 * sprintShare) + 25 * targetConfidence + 0.1 * powerN + 0.1 * adj;
      return {
        hid,
        name: String(i.name ?? hid),
        source: sources.get(hid),
        gender: String(i.gender ?? "").toLowerCase(),
        element: String(i.element ?? "").toLowerCase(),
        type: String(i.type ?? "").toLowerCase(),
        fno: num(i.fno, 0),
        power: powerN,
        adj,
        variance: metric(p.variance),
        races: num(p.races_n, 0),
        careerRaces: num(s?.hstats_bike?.career?.races_n, total),
        counts,
        targetRaces: target,
        sprintBandRaces: sprintBand,
        targetShare,
        sprintShare,
        selectionScore,
        ancestry: { parents: X.get(hid)?.parents ?? null, grandParents: X.get(hid)?.grand_parents ?? null },
      };
    }).filter((p) => p.gender === "male" || p.gender === "female");

    const expanded = new Set<number>([17785, 4126, ...BASELINE_ROSTER]);
    for (const gender of ["male", "female"] as const) {
      const group = parents.filter((p) => p.gender === gender && p.targetRaces > 0);
      for (const p of [...group].sort((a, b) => b.selectionScore - a.selectionScore).slice(0, 24)) expanded.add(p.hid);
      for (const p of [...group].sort((a, b) => b.targetRaces - a.targetRaces).slice(0, 10)) expanded.add(p.hid);
      for (const p of [...group].filter((p) => p.targetRaces >= 10).sort((a, b) => (b.power + b.adj) - (a.power + a.adj)).slice(0, 10)) expanded.add(p.hid);
    }

    const benchmarkRecords: Hist[] = [];
    const candidateRecords: Hist[] = [];
    const seenCandidate = new Set<string>();
    for (const p of parents) {
      const page = await legacy(p.hid, 1);
      for (const r of page) {
        const z = normHistory(p.hid, r);
        if (!z) continue;
        benchmarkRecords.push(z);
        if (expanded.has(p.hid)) {
          const key = `${z.hid}|${z.rid}`;
          if (!seenCandidate.has(key)) {
            seenCandidate.add(key);
            candidateRecords.push(z);
          }
        }
      }
    }
    for (const hid of expanded) {
      for (const pageNo of [2, 3, 4]) {
        const page = await legacy(hid, pageNo);
        for (const r of page) {
          const z = normHistory(hid, r);
          if (!z) continue;
          const key = `${z.hid}|${z.rid}`;
          if (!seenCandidate.has(key)) {
            seenCandidate.add(key);
            candidateRecords.push(z);
          }
        }
        if (page.length < 50) break;
      }
    }

    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/owner-sprint-profile.json",
      JSON.stringify({
        schemaVersion: 2,
        fetchedAt: new Date().toISOString(),
        apiCalls: calls,
        ownerCoreCount: owned.length,
        arenaCoreCount: arenaCores.length,
        uniqueParentCount: parents.length,
        expandedParentCount: expanded.size,
        parents,
        benchmarkRecords,
        candidateRecords,
      }),
    );
    expect(parents.length).toBeGreaterThanOrEqual(250);
    expect(benchmarkRecords.length).toBeGreaterThan(1000);
    expect(candidateRecords.length).toBeGreaterThan(500);
  }, 35 * 60_000);
});
