import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assessBreedingPair,
  assessBreedingParent,
  type BreedingExactPerformanceEvidence,
  type BreedingPairCandidate,
  type BreedingParentCandidate,
  type BreedingFreshness,
} from "../domain/breeding-recommendation";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_LIVE_ARENA_BREEDING === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const DISTANCES = [1_000, 1_200, 1_400, 1_600, 1_800, 2_000, 2_200] as const;
const PROFILE_DISTANCES = Array.from({ length: 15 }, (_, index) => 900 + index * 100);

type AnyRecord = Record<string, any>;
type Source = "vault" | "arena";
type ParentBase = Readonly<{
  hid: number;
  name: string;
  sex: "male" | "female";
  source: Source;
  power: number | null;
  adjustedOdds: number | null;
  variance: number | null;
  distanceProfile: readonly { distanceMetres: number; raceCount: number }[];
  parents: readonly string[];
  grandparents: readonly string[];
  arenaRecord: AnyRecord | null;
}>;
type Hist = Readonly<{
  hid: number;
  rid: string;
  distanceMetres: number;
  elapsedSeconds: number;
  speedMetresPerSecond: number;
  observedAt: string | null;
}>;

type ExactSummary = Readonly<{
  hid: number;
  distanceMetres: number;
  sampleSize: number;
  medianElapsedTimeMilliseconds: number;
  medianSpeedMetresPerSecond: number;
  upperTailSpeedMetresPerSecond: number;
  bestSpeedMetresPerSecond: number;
  medianSpeedPercentile: number;
  upperTailSpeedPercentile: number;
  bestSpeedPercentile: number;
  benchmarkPopulationSize: number;
  latestObservedAt: string | null;
}>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}
function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size) as T[]);
  }
  return out;
}
function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function metric(value: any): number | null {
  const candidate = value?.fill?.per ?? value?.per ?? value?.val;
  return numberOrNull(candidate);
}
function raceCount(stats: AnyRecord, distanceMetres: number): number {
  const value = Number(stats?.hstats_bike?.[String(distanceMetres / 100)]?.races_n ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error("quantile requires values");
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}
function percentileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  const less = values.filter((entry) => entry < value).length;
  const equal = values.filter((entry) => entry === value).length;
  return (100 * (less + 0.5 * equal)) / values.length;
}
function canonicalDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function latestDate(values: readonly (string | null)[]): string | null {
  const dates = values.filter((value): value is string => value !== null).sort();
  return dates.at(-1) ?? null;
}
function freshness(latestObservedAt: string | null, fetchedAt: string): BreedingFreshness {
  if (latestObservedAt === null) return "unknown";
  const ageDays = (Date.parse(fetchedAt) - Date.parse(latestObservedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return "unknown";
  if (ageDays <= 120) return "current";
  if (ageDays <= 365) return "ageing";
  return "stale";
}
function lineageIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap((entry) => lineageIds(entry)))];
  if (typeof value === "number") return Number.isFinite(value) ? [String(value)] : [];
  if (typeof value === "string") return /^\d+$/.test(value.trim()) ? [String(Number(value))] : [];
  if (typeof value !== "object") return [];
  const record = value as AnyRecord;
  const directKeys = ["hid", "id", "core_id", "token_id", "father_id", "mother_id"];
  const direct = directKeys.flatMap((key) => lineageIds(record[key]));
  if (direct.length > 0) return [...new Set(direct)];
  return [...new Set(Object.values(record).flatMap((entry) => lineageIds(entry)))];
}
function normalizeHistory(hid: number, row: AnyRecord): Hist | null {
  if (String(row.rvmode ?? "").toLowerCase() !== "bike") return null;
  const cb = Number(row.cb ?? 0);
  const distanceMetres = cb >= 100 ? cb : cb * 100;
  if (!DISTANCES.includes(distanceMetres as (typeof DISTANCES)[number])) return null;
  const elapsedSeconds = Number(row.time ?? row.rtime ?? row.elapsed ?? 0);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  return Object.freeze({
    hid,
    rid: String(row.rid ?? row.rhid ?? `${hid}:${row.start_time ?? ""}:${distanceMetres}:${elapsedSeconds}`),
    distanceMetres,
    elapsedSeconds,
    speedMetresPerSecond: distanceMetres / elapsedSeconds,
    observedAt: canonicalDate(row.start_time),
  });
}
function strengthSort(left: ParentBase, right: ParentBase): number {
  return (right.power ?? -1) + (right.adjustedOdds ?? -1) - ((left.power ?? -1) + (left.adjustedOdds ?? -1));
}

describeConnected("live Bike Arena elite breeding scan", () => {
  it("benchmarks current Arena parents and returns only elite-supported pair hypotheses", async () => {
    const fetchedAt = new Date().toISOString();
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let lastRequestAt = 0;
    let apiCalls = 0;
    const paced = async <T>(operation: () => Promise<T>): Promise<T> => {
      const wait = 2_100 - (Date.now() - lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const result = await operation();
      lastRequestAt = Date.now();
      apiCalls++;
      return result;
    };
    const legacyHistory = async (hid: number, page: number): Promise<AnyRecord[]> =>
      paced(async () => {
        const response = await fetch("https://api.dnaracing.run/fbike/i/hraces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hid, page }),
        });
        const body: any = await response.json();
        if (!body || !Array.isArray(body.result)) throw new Error(`hraces ${hid}/${page} malformed`);
        return body.result as AnyRecord[];
      });

    const owned = (await paced(() => client.vaultCoresFull(OWNER_VAULT))).result;
    const arenaCores: AnyRecord[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = (await paced(() => client.spliceArena({ filter: { rvmode: "bike" }, page }))).result;
      arenaCores.push(...result.cores);
      if (!result.has_more) break;
    }

    const sourceByHid = new Map<number, Source>();
    for (const row of owned) sourceByHid.set(Number(row.hid), "vault");
    const arenaByHid = new Map<number, AnyRecord>();
    for (const row of arenaCores) {
      const hid = Number(row.hid);
      arenaByHid.set(hid, row);
      if (!sourceByHid.has(hid)) sourceByHid.set(hid, "arena");
    }
    const hids = [...sourceByHid.keys()].filter(Number.isFinite);

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

    const infoByHid = new Map(info.map((row) => [Number(row.hid), row]));
    const statsByHid = new Map(stats.map((row) => [Number(row.hid), row]));
    const powerByHid = new Map(power.map((row) => [Number(row.hid), row]));
    const splicingByHid = new Map(splicing.map((row) => [Number(row.hid), row]));

    const parents: ParentBase[] = hids.flatMap((hid) => {
      const details = infoByHid.get(hid) ?? {};
      const gender = String(details.gender ?? "").toLowerCase();
      if (gender !== "male" && gender !== "female") return [];
      const bike = powerByHid.get(hid)?.power?.bike ?? {};
      const splice = splicingByHid.get(hid) ?? {};
      return [Object.freeze({
        hid,
        name: String(details.name ?? hid),
        sex: gender,
        source: sourceByHid.get(hid)!,
        power: metric(bike.power),
        adjustedOdds: metric(bike.adjodds),
        variance: metric(bike.variance),
        distanceProfile: Object.freeze(PROFILE_DISTANCES.map((distanceMetres) => ({
          distanceMetres,
          raceCount: raceCount(statsByHid.get(hid) ?? {}, distanceMetres),
        }))),
        parents: Object.freeze(lineageIds(splice.parents)),
        grandparents: Object.freeze(lineageIds(splice.grand_parents ?? splice.grandparents)),
        arenaRecord: arenaByHid.get(hid) ?? null,
      })];
    });

    const benchmarkRecords: Hist[] = [];
    const candidateRecords: Hist[] = [];
    const candidateSeen = new Set<string>();
    const pageOneByHid = new Map<number, AnyRecord[]>();
    for (const parent of parents) {
      const rows = await legacyHistory(parent.hid, 1);
      pageOneByHid.set(parent.hid, rows);
      for (const row of rows) {
        const normalized = normalizeHistory(parent.hid, row);
        if (normalized) benchmarkRecords.push(normalized);
      }
    }

    const expanded = new Set<number>();
    for (const parent of parents) {
      const targetRaces = parent.distanceProfile
        .filter((entry) => DISTANCES.includes(entry.distanceMetres as (typeof DISTANCES)[number]))
        .reduce((sum, entry) => sum + entry.raceCount, 0);
      if ((parent.power ?? 0) >= 75 && (parent.adjustedOdds ?? 0) >= 70 && targetRaces > 0) {
        expanded.add(parent.hid);
      }
    }
    for (const distanceMetres of DISTANCES) {
      for (const sex of ["male", "female"] as const) {
        const candidates = parents
          .filter((parent) => parent.sex === sex && parent.distanceProfile.some((entry) => entry.distanceMetres === distanceMetres && entry.raceCount > 0))
          .sort(strengthSort)
          .slice(0, 8);
        for (const candidate of candidates) expanded.add(candidate.hid);
      }
    }

    for (const hid of expanded) {
      for (const row of pageOneByHid.get(hid) ?? []) {
        const normalized = normalizeHistory(hid, row);
        if (!normalized) continue;
        const key = `${normalized.hid}|${normalized.rid}`;
        if (!candidateSeen.has(key)) {
          candidateSeen.add(key);
          candidateRecords.push(normalized);
        }
      }
      for (const page of [2, 3, 4, 5]) {
        const rows = await legacyHistory(hid, page);
        for (const row of rows) {
          const normalized = normalizeHistory(hid, row);
          if (!normalized) continue;
          const key = `${normalized.hid}|${normalized.rid}`;
          if (!candidateSeen.has(key)) {
            candidateSeen.add(key);
            candidateRecords.push(normalized);
          }
        }
        if (rows.length < 50) break;
      }
    }

    const benchmarkByDistance = new Map<number, { medians: number[]; upperTails: number[]; bests: number[] }>();
    for (const distanceMetres of DISTANCES) {
      const perCore = new Map<number, number[]>();
      for (const record of benchmarkRecords.filter((entry) => entry.distanceMetres === distanceMetres)) {
        const values = perCore.get(record.hid) ?? [];
        values.push(record.speedMetresPerSecond);
        perCore.set(record.hid, values);
      }
      benchmarkByDistance.set(distanceMetres, {
        medians: [...perCore.values()].map((values) => median(values)),
        upperTails: [...perCore.values()].map((values) => quantile(values, 0.8)),
        bests: [...perCore.values()].map((values) => Math.max(...values)),
      });
    }

    const exactSummaries: ExactSummary[] = [];
    for (const parent of parents.filter((entry) => expanded.has(entry.hid))) {
      for (const distanceMetres of DISTANCES) {
        const rows = candidateRecords.filter((entry) => entry.hid === parent.hid && entry.distanceMetres === distanceMetres);
        if (rows.length === 0) continue;
        const benchmark = benchmarkByDistance.get(distanceMetres)!;
        const speeds = rows.map((entry) => entry.speedMetresPerSecond);
        const elapsedMilliseconds = rows.map((entry) => entry.elapsedSeconds * 1_000);
        const medianSpeed = median(speeds);
        const upperTail = quantile(speeds, 0.8);
        const bestSpeed = Math.max(...speeds);
        exactSummaries.push(Object.freeze({
          hid: parent.hid,
          distanceMetres,
          sampleSize: rows.length,
          medianElapsedTimeMilliseconds: median(elapsedMilliseconds),
          medianSpeedMetresPerSecond: medianSpeed,
          upperTailSpeedMetresPerSecond: upperTail,
          bestSpeedMetresPerSecond: bestSpeed,
          medianSpeedPercentile: percentileRank(benchmark.medians, medianSpeed),
          upperTailSpeedPercentile: percentileRank(benchmark.upperTails, upperTail),
          bestSpeedPercentile: percentileRank(benchmark.bests, bestSpeed),
          benchmarkPopulationSize: benchmark.medians.length,
          latestObservedAt: latestDate(rows.map((entry) => entry.observedAt)),
        }));
      }
    }

    const summaryByParentDistance = new Map(exactSummaries.map((summary) => [`${summary.hid}|${summary.distanceMetres}`, summary]));
    const parentInput = (base: ParentBase, distanceMetres: number): BreedingParentCandidate => {
      const performances: BreedingExactPerformanceEvidence[] = exactSummaries
        .filter((summary) => summary.hid === base.hid)
        .map((summary) => ({
          mode: "bike",
          distanceMetres: summary.distanceMetres,
          sampleSize: summary.sampleSize,
          medianElapsedTimeMilliseconds: summary.medianElapsedTimeMilliseconds,
          medianSpeedMetresPerSecond: summary.medianSpeedMetresPerSecond,
          medianSpeedPercentile: summary.medianSpeedPercentile,
          upperTailSpeedPercentile: summary.upperTailSpeedPercentile,
          bestSpeedPercentile: summary.bestSpeedPercentile,
          benchmarkPopulationSize: summary.benchmarkPopulationSize,
          latestObservedAt: summary.latestObservedAt,
        }));
      const exact = summaryByParentDistance.get(`${base.hid}|${distanceMetres}`);
      return {
        coreId: String(base.hid),
        coreName: base.name,
        sex: base.sex,
        source: base.source,
        performance: performances,
        currentStrength: {
          power: base.power,
          adjustedOdds: base.adjustedOdds,
          variance: base.variance,
          observedAt: fetchedAt,
        },
        distanceProfile: base.distanceProfile,
        lineage: { parents: base.parents, grandparents: base.grandparents },
        freshness: freshness(exact?.latestObservedAt ?? null, fetchedAt),
        available: true,
        starEvidenceAuthority: "unavailable",
      };
    };

    const distanceResults: AnyRecord[] = [];
    const pairInfoQueue: { distanceMetres: number; fatherId: number; motherId: number; status: string; qualityScore: number | null }[] = [];
    for (const distanceMetres of DISTANCES) {
      const assessed = parents
        .filter((base) => expanded.has(base.hid))
        .map((base) => {
          const candidate = parentInput(base, distanceMetres);
          return { base, candidate, assessment: assessBreedingParent(candidate, { mode: "bike", distanceMetres }) };
        });
      const arenaParents = assessed
        .filter(({ base }) => base.source === "arena")
        .sort((left, right) => (right.assessment.qualityScore ?? -1) - (left.assessment.qualityScore ?? -1));
      const fathers = assessed.filter(({ candidate, assessment }) => candidate.sex === "male" && assessment.status !== "wait");
      const mothers = assessed.filter(({ candidate, assessment }) => candidate.sex === "female" && assessment.status !== "wait");
      const pairs: AnyRecord[] = [];
      for (const father of fathers) {
        for (const mother of mothers) {
          if (father.base.source !== "arena" && mother.base.source !== "arena") continue;
          const pairCandidate: BreedingPairCandidate = {
            father: father.candidate,
            mother: mother.candidate,
            officialValidation: "unknown",
            pairInfo: null,
          };
          const assessment = assessBreedingPair(pairCandidate, { mode: "bike", distanceMetres });
          if (assessment.status === "wait") continue;
          pairs.push({
            fatherHid: father.base.hid,
            fatherName: father.base.name,
            fatherSource: father.base.source,
            motherHid: mother.base.hid,
            motherName: mother.base.name,
            motherSource: mother.base.source,
            status: assessment.status,
            qualityScore: assessment.qualityScore,
            fatherAssessment: assessment.father,
            motherAssessment: assessment.mother,
            localEligibilityReason: assessment.localEligibilityReason,
          });
        }
      }
      pairs.sort((left, right) => (right.qualityScore ?? -1) - (left.qualityScore ?? -1));
      const targets = pairs.filter((entry) => entry.status === "target");
      const watches = pairs.filter((entry) => entry.status === "watch");
      const forPairInfo = (targets.length > 0 ? targets.slice(0, 3) : watches.slice(0, 2));
      for (const entry of forPairInfo) {
        pairInfoQueue.push({
          distanceMetres,
          fatherId: entry.fatherHid,
          motherId: entry.motherHid,
          status: entry.status,
          qualityScore: entry.qualityScore,
        });
      }
      distanceResults.push({
        distanceMetres,
        benchmarkPopulationSize: benchmarkByDistance.get(distanceMetres)?.medians.length ?? 0,
        arenaTargets: arenaParents.filter(({ assessment }) => assessment.status === "target").slice(0, 12).map(({ base, assessment }) => ({ hid: base.hid, name: base.name, sex: base.sex, source: base.source, power: base.power, adjustedOdds: base.adjustedOdds, variance: base.variance, assessment })),
        arenaWatches: arenaParents.filter(({ assessment }) => assessment.status === "watch").slice(0, 12).map(({ base, assessment }) => ({ hid: base.hid, name: base.name, sex: base.sex, source: base.source, power: base.power, adjustedOdds: base.adjustedOdds, variance: base.variance, assessment })),
        targetPairs: targets.slice(0, 12),
        watchPairs: watches.slice(0, 12),
        action: targets.length > 0 ? "breed_candidate_available" : "wait",
      });
    }

    const pairInfoResults: AnyRecord[] = [];
    const pairInfoSeen = new Set<string>();
    for (const request of pairInfoQueue) {
      const key = `${request.fatherId}|${request.motherId}`;
      if (pairInfoSeen.has(key)) continue;
      pairInfoSeen.add(key);
      let pairInfo: unknown = null;
      let pairInfoError: string | null = null;
      try {
        pairInfo = (await paced(() => client.splicePairInfo({ fatherCoreId: request.fatherId, motherCoreId: request.motherId }))).result;
      } catch (error) {
        pairInfoError = error instanceof Error ? error.message : "pair_info failed";
      }
      pairInfoResults.push({ ...request, pairInfo, pairInfoError });
    }

    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/live-bike-arena-breeding.json",
      JSON.stringify({
        schemaVersion: 1,
        fetchedAt,
        apiCalls,
        ownerCoreCount: owned.length,
        arenaCoreCount: arenaCores.length,
        uniqueBreedingUniverseCount: parents.length,
        expandedTimingCandidateCount: expanded.size,
        benchmarkRecordCount: benchmarkRecords.length,
        candidateRecordCount: candidateRecords.length,
        arenaSnapshot: arenaCores.map((row) => ({ hid: Number(row.hid), price: row.price ?? row.price_usd ?? row.fee ?? null, rawListing: row })),
        distanceResults,
        pairInfoResults,
      }),
      "utf8",
    );

    expect(arenaCores.length).toBeGreaterThan(0);
    expect(parents.length).toBeGreaterThan(200);
    expect(benchmarkRecords.length).toBeGreaterThan(500);
  }, 40 * 60_000);
});
