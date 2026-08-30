import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  decomposeBreederEffects,
  defaultBreederEffectPolicy,
  type BreederEffectDecomposition,
  type BreederLiftObservation,
} from "../domain/breeder-effect-decomposition";
import {
  defaultMatingExpectationPolicy,
  estimateHistoricalMatingExpectation,
  type HistoricalMatingOutcome,
} from "../domain/breeder-mating-expectation";
import type { BreederScope } from "../domain/breeder-quality";

const enabled = process.env.DNA_BREEDING_FULL_TWO_PARENT_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const DISTANCES = [1000, 1200, 1400, 1800] as const;
const HORIZON_DAYS = [90, 180, 365] as const;
const MIN_RACES = 5;
const MAX_RACES = 50;
const MIN_BENCHMARK_CORES = 25;
const DAY_MS = 86_400_000;

type AnyRecord = Record<string, unknown>;
type HistoryRecord = Readonly<{
  hid: number;
  rid: string;
  rvmode: "bike" | "car" | "horse";
  distanceMetres: number;
  elapsedSeconds: number;
  speedMetresPerSecond: number;
  startTime: string | null;
}>;

type TimedHistoryRecord = HistoryRecord & Readonly<{ timeMs: number }>;
type QualityPoint = Readonly<{
  percentile: number;
  sampleSize: number;
  rawScore: number;
}>;
type MatingCandidate = Readonly<{
  childHid: number;
  parentA: number;
  parentB: number;
  childSampleSize: number;
  benchmarkPopulationSize: number;
  mating: HistoricalMatingOutcome;
}>;

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0)
    throw new Error("Cannot calculate an empty quantile.");
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  const weight = position - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function qualityScore(speeds: readonly number[]): number {
  return 0.7 * quantile(speeds, 0.5) + 0.3 * quantile(speeds, 0.75);
}

function percentileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  let lower = 0;
  let equal = 0;
  for (const candidate of values) {
    if (candidate < value) lower++;
    else if (candidate === value) equal++;
  }
  return (100 * (lower + 0.5 * equal)) / values.length;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function positiveHid(value: unknown): number | null {
  const hid = Number(value);
  return Number.isSafeInteger(hid) && hid > 0 ? hid : null;
}

function lowerBound(
  rows: readonly TimedHistoryRecord[],
  wanted: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid]!.timeMs < wanted) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(
  rows: readonly TimedHistoryRecord[],
  wanted: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid]!.timeMs <= wanted) low = mid + 1;
    else high = mid;
  }
  return low;
}

function speedsBefore(
  rows: readonly TimedHistoryRecord[],
  cutoffMs: number,
): number[] {
  const end = lowerBound(rows, cutoffMs);
  const start = Math.max(0, end - MAX_RACES);
  return rows
    .slice(start, end)
    .map((row) => row.speedMetresPerSecond)
    .filter(Number.isFinite);
}

function childWindow(
  rows: readonly TimedHistoryRecord[],
  createdAtMs: number,
  horizonDays: number,
): TimedHistoryRecord[] {
  const start = lowerBound(rows, createdAtMs);
  const end = upperBound(rows, createdAtMs + horizonDays * DAY_MS);
  return rows.slice(start, Math.min(end, start + MAX_RACES));
}

async function readHistoryDirectories(directories: readonly string[]): Promise<{
  records: HistoryRecord[];
  shardSummaries: AnyRecord[];
}> {
  const records: HistoryRecord[] = [];
  const shardSummaries: AnyRecord[] = [];
  for (const directory of directories) {
    const files = (await readdir(directory))
      .filter((name) => /^breeding-race-history-\d+\.json$/u.test(name))
      .sort();
    for (const file of files) {
      const payload = JSON.parse(
        await readFile(`${directory}/${file}`, "utf8"),
      ) as AnyRecord;
      const rows = (payload.records ?? []) as HistoryRecord[];
      records.push(...rows);
      shardSummaries.push({
        directory,
        file,
        requestCount: payload.requestCount ?? null,
        recordCount: rows.length,
        errorCount: Array.isArray(payload.errors) ? payload.errors.length : 0,
        truncatedHids: payload.truncatedHids ?? [],
      });
    }
  }
  return { records, shardSummaries };
}

function directName(row: AnyRecord | undefined): string | null {
  if (!row) return null;
  for (const key of ["name", "core_name", "coreName"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

describeConnected("strict full two-parent breeder analysis", () => {
  it(
    "learns chronological mating expectation and separates parent effect from pair synergy",
    async () => {
      const inventory = JSON.parse(
        await readFile(
          process.env.BREEDING_CENSUS_PATH ??
            "artifacts/inventory/breeding-lineage-census-upgraded.json",
          "utf8",
        ),
      ) as AnyRecord;
      const coParentInventory = JSON.parse(
        await readFile(
          process.env.BREEDING_COPARENT_INVENTORY_PATH ??
            "artifacts/inventory/breeding-missing-coparent-inventory.json",
          "utf8",
        ),
      ) as AnyRecord;
      const historyDirectories = (
        process.env.BREEDING_HISTORY_DIRS ??
        "artifacts/history/base,artifacts/history/coparent"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const { records, shardSummaries } =
        await readHistoryDirectories(historyDirectories);

      const dedupe = new Map<string, HistoryRecord>();
      const conflicts: string[] = [];
      for (const record of records) {
        const key = `${record.hid}|${record.rid}`;
        const existing = dedupe.get(key);
        if (!existing) {
          dedupe.set(key, record);
          continue;
        }
        if (JSON.stringify(existing) !== JSON.stringify(record))
          conflicts.push(key);
      }
      if (conflicts.length > 0) {
        throw new Error(
          `Conflicting duplicated race records: ${conflicts.slice(0, 5).join(", ")}`,
        );
      }
      const uniqueRecords = [...dedupe.values()];

      const timedBike = uniqueRecords
        .filter(
          (record) =>
            record.rvmode === "bike" &&
            Number.isFinite(record.speedMetresPerSecond) &&
            canonicalTimestamp(record.startTime) !== null,
        )
        .map((record): TimedHistoryRecord => ({
          ...record,
          timeMs: Date.parse(record.startTime!),
        }));
      const firstRaceByHid = new Map<number, number>();
      for (const record of uniqueRecords) {
        const timestamp = canonicalTimestamp(record.startTime);
        if (!timestamp) continue;
        const timeMs = Date.parse(timestamp);
        const existing = firstRaceByHid.get(record.hid);
        if (existing === undefined || timeMs < existing)
          firstRaceByHid.set(record.hid, timeMs);
      }

      const byDistanceAndHid = new Map<
        number,
        Map<number, TimedHistoryRecord[]>
      >();
      for (const distance of DISTANCES)
        byDistanceAndHid.set(distance, new Map());
      for (const record of timedBike) {
        const byHid = byDistanceAndHid.get(record.distanceMetres);
        if (!byHid) continue;
        const rows = byHid.get(record.hid) ?? [];
        rows.push(record);
        byHid.set(record.hid, rows);
      }
      for (const byHid of byDistanceAndHid.values()) {
        for (const rows of byHid.values())
          rows.sort((a, b) => a.timeMs - b.timeMs);
      }

      const directParents = (inventory.universe as AnyRecord)
        ?.directParentsByChild as Record<string, unknown> | undefined;
      const relations = Object.entries(directParents ?? {})
        .map(([childText, parentValue]) => ({
          child: positiveHid(childText),
          parents: Array.isArray(parentValue)
            ? [
                ...new Set(
                  parentValue
                    .map(positiveHid)
                    .filter((hid): hid is number => hid !== null),
                ),
              ]
            : [],
        }))
        .filter(
          (relation): relation is { child: number; parents: number[] } =>
            relation.child !== null && relation.parents.length === 2,
        )
        .sort(
          (left, right) =>
            (firstRaceByHid.get(left.child) ?? Number.MAX_SAFE_INTEGER) -
            (firstRaceByHid.get(right.child) ?? Number.MAX_SAFE_INTEGER),
        );

      const targetParentHids = new Set<number>(
        ((inventory.offspringByParent ?? []) as AnyRecord[])
          .map((row) => positiveHid(row.parentHid))
          .filter((hid): hid is number => hid !== null),
      );
      const infoRows = [
        ...(((inventory.coreFamilies as AnyRecord)?.info ?? []) as AnyRecord[]),
        ...(((coParentInventory.coreFamilies as AnyRecord)?.info ??
          []) as AnyRecord[]),
      ];
      const infoByHid = new Map<number, AnyRecord>();
      for (const row of infoRows) {
        const hid = positiveHid(row.hid);
        if (hid !== null && !infoByHid.has(hid)) infoByHid.set(hid, row);
      }

      const effectDecompositions: AnyRecord[] = [];
      const matingCoverage: AnyRecord[] = [];
      const robustParentRows: AnyRecord[] = [];
      const stablePairRows: AnyRecord[] = [];
      const parentEffectsByKey = new Map<string, AnyRecord[]>();
      const pairEffectsByKey = new Map<string, AnyRecord[]>();

      for (const distanceMetres of DISTANCES) {
        const byHid = byDistanceAndHid.get(distanceMetres)!;
        const benchmarkCache = new Map<number, Map<number, QualityPoint>>();
        const benchmarkAt = (cutoffMs: number): Map<number, QualityPoint> => {
          const cached = benchmarkCache.get(cutoffMs);
          if (cached) return cached;
          const raw: { hid: number; score: number; sampleSize: number }[] = [];
          for (const [hid, rows] of byHid) {
            const speeds = speedsBefore(rows, cutoffMs);
            if (speeds.length < MIN_RACES) continue;
            raw.push({
              hid,
              score: qualityScore(speeds),
              sampleSize: speeds.length,
            });
          }
          const values = raw.map((entry) => entry.score);
          const result = new Map<number, QualityPoint>();
          if (values.length >= MIN_BENCHMARK_CORES) {
            for (const entry of raw) {
              result.set(entry.hid, {
                percentile: percentileRank(values, entry.score),
                sampleSize: entry.sampleSize,
                rawScore: entry.score,
              });
            }
          }
          benchmarkCache.set(cutoffMs, result);
          return result;
        };

        for (const horizonDays of HORIZON_DAYS) {
          const scope: BreederScope = { mode: "bike", distanceMetres };
          const candidates: MatingCandidate[] = [];
          for (const relation of relations) {
            const createdAtMs = firstRaceByHid.get(relation.child);
            if (createdAtMs === undefined) continue;
            const benchmark = benchmarkAt(createdAtMs);
            if (benchmark.size < MIN_BENCHMARK_CORES) continue;
            const parentA = relation.parents[0]!;
            const parentB = relation.parents[1]!;
            const qualityA = benchmark.get(parentA);
            const qualityB = benchmark.get(parentB);
            if (!qualityA || !qualityB) continue;
            const childRows = childWindow(
              byHid.get(relation.child) ?? [],
              createdAtMs,
              horizonDays,
            );
            if (childRows.length < MIN_RACES) continue;
            const childSpeeds = childRows.map(
              (row) => row.speedMetresPerSecond,
            );
            const childRawScore = qualityScore(childSpeeds);
            const benchmarkScores = [...benchmark.values()].map(
              (point) => point.rawScore,
            );
            const childQuality = percentileRank(benchmarkScores, childRawScore);
            const observedAt = childRows[childRows.length - 1]!.startTime!;
            candidates.push({
              childHid: relation.child,
              parentA,
              parentB,
              childSampleSize: childRows.length,
              benchmarkPopulationSize: benchmark.size,
              mating: {
                offspringCoreId: String(relation.child),
                scope,
                parentAQualityPercentile: qualityA.percentile,
                parentBQualityPercentile: qualityB.percentile,
                offspringQualityPercentile: childQuality,
                offspringCreatedAt: new Date(createdAtMs).toISOString(),
                offspringQualityObservedAt: observedAt,
              },
            });
          }

          const liftRows: BreederLiftObservation[] = [];
          let unavailableExpectationCount = 0;
          const expectationConfidences: Record<string, number> = {
            low: 0,
            moderate: 0,
            high: 0,
          };
          for (const candidate of candidates) {
            const excludedParents = new Set([
              candidate.parentA,
              candidate.parentB,
            ]);
            const historicalMatings = candidates
              .filter(
                (row) =>
                  row.childHid !== candidate.childHid &&
                  !excludedParents.has(row.parentA) &&
                  !excludedParents.has(row.parentB),
              )
              .map((row) => row.mating);
            const expectation = estimateHistoricalMatingExpectation({
              scope,
              parentAQualityPercentile:
                candidate.mating.parentAQualityPercentile,
              parentBQualityPercentile:
                candidate.mating.parentBQualityPercentile,
              asOf: candidate.mating.offspringCreatedAt,
              historicalMatings,
              policy: {
                ...defaultMatingExpectationPolicy,
                minimumHistoricalMatings: 20,
                maximumComparableMatings: 50,
                moderateConfidenceMatings: 30,
                highConfidenceMatings: 40,
              },
            });
            if (expectation.status === "unavailable") {
              unavailableExpectationCount++;
              continue;
            }
            expectationConfidences[expectation.confidence] =
              (expectationConfidences[expectation.confidence] ?? 0) + 1;
            liftRows.push({
              offspringCoreId: String(candidate.childHid),
              parentACoreId: String(candidate.parentA),
              parentBCoreId: String(candidate.parentB),
              scope,
              liftPercentilePoints:
                candidate.mating.offspringQualityPercentile -
                expectation.typicalOffspringQualityPercentile,
            });
          }

          const decomposition: BreederEffectDecomposition =
            decomposeBreederEffects({
              scope,
              observations: liftRows,
              policy: {
                ...defaultBreederEffectPolicy,
                parentRidgeStrength: 12,
                minimumTargetOffspring: 3,
                minimumTargetCoParents: 3,
              },
            });
          effectDecompositions.push({
            horizonDays,
            distanceMetres,
            observationCount: decomposition.observationCount,
            parentCount: decomposition.parentCount,
            baselineLift: decomposition.baselineLift,
            method: decomposition.method,
          });
          matingCoverage.push({
            horizonDays,
            distanceMetres,
            candidateCount: candidates.length,
            withExpectation: liftRows.length,
            unavailableExpectationCount,
            expectationConfidences,
          });

          for (const effect of decomposition.parentEffects) {
            const key = `${effect.parentCoreId}|${distanceMetres}`;
            const rows = parentEffectsByKey.get(key) ?? [];
            rows.push({ horizonDays, ...effect });
            parentEffectsByKey.set(key, rows);
          }
          for (const pair of decomposition.pairSynergies) {
            const parents = [pair.parentACoreId, pair.parentBCoreId].sort();
            const key = `${parents[0]}|${parents[1]}|${distanceMetres}`;
            const rows = pairEffectsByKey.get(key) ?? [];
            rows.push({ horizonDays, ...pair });
            pairEffectsByKey.set(key, rows);
          }
        }
      }

      const careerCounts = new Map<number, Map<number, number>>();
      for (const record of timedBike) {
        const counts =
          careerCounts.get(record.hid) ?? new Map<number, number>();
        counts.set(
          record.distanceMetres,
          (counts.get(record.distanceMetres) ?? 0) + 1,
        );
        careerCounts.set(record.hid, counts);
      }
      const careerProfile = (hid: number) => {
        const counts = careerCounts.get(hid) ?? new Map<number, number>();
        const total = [...counts.values()].reduce(
          (sum, value) => sum + value,
          0,
        );
        const target = [1000, 1200, 1400].reduce(
          (sum, distance) => sum + (counts.get(distance) ?? 0),
          0,
        );
        const sprintBand = [...counts.entries()]
          .filter(([distance]) => distance >= 900 && distance <= 1500)
          .reduce((sum, [, count]) => sum + count, 0);
        const midMara = [...counts.entries()]
          .filter(([distance]) => distance >= 1600 && distance <= 2300)
          .reduce((sum, [, count]) => sum + count, 0);
        return {
          totalBikeRaces: total,
          target1000To1400Races: target,
          targetShare: total === 0 ? 0 : target / total,
          sprintBand900To1500Races: sprintBand,
          sprintBandShare: total === 0 ? 0 : sprintBand / total,
          midMara1600To2300Races: midMara,
          midMaraShare: total === 0 ? 0 : midMara / total,
          countsByDistance: Object.fromEntries(
            [...counts.entries()].sort((left, right) => left[0] - right[0]),
          ),
        };
      };

      for (const [key, rows] of parentEffectsByKey) {
        const [parentText, distanceText] = key.split("|");
        const parentHid = Number(parentText);
        if (!targetParentHids.has(parentHid)) continue;
        const positive = rows.filter(
          (row) =>
            Number(row.adjustedBreederEffect) > 0 &&
            Number(row.offspringCount) >= 3 &&
            Number(row.distinctCoParentCount) >= 3,
        );
        if (positive.length < 2) continue;
        const meanEffect =
          positive.reduce(
            (sum, row) => sum + Number(row.adjustedBreederEffect),
            0,
          ) / positive.length;
        robustParentRows.push({
          parentHid,
          parentName: directName(infoByHid.get(parentHid)),
          distanceMetres: Number(distanceText),
          researchStatus: "watch",
          meanAdjustedBreederEffect: meanEffect,
          positiveQualifiedHorizons: positive.length,
          minimumQualifiedOffspring: Math.min(
            ...positive.map((row) => Number(row.offspringCount)),
          ),
          minimumDistinctCoParents: Math.min(
            ...positive.map((row) => Number(row.distinctCoParentCount)),
          ),
          horizons: rows.sort(
            (left, right) =>
              Number(left.horizonDays) - Number(right.horizonDays),
          ),
          careerProfile: careerProfile(parentHid),
          warning:
            "WATCH/research-only: offspring creation uses first recorded race as a chronology proxy because authoritative minted_at is unavailable.",
        });
      }
      robustParentRows.sort(
        (left, right) =>
          Number(right.meanAdjustedBreederEffect) -
            Number(left.meanAdjustedBreederEffect) ||
          Number(left.parentHid) - Number(right.parentHid),
      );

      for (const [key, rows] of pairEffectsByKey) {
        const [parentAText, parentBText, distanceText] = key.split("|");
        const parentA = Number(parentAText);
        const parentB = Number(parentBText);
        if (!targetParentHids.has(parentA) && !targetParentHids.has(parentB))
          continue;
        const positive = rows.filter(
          (row) =>
            Number(row.adjustedPairSynergy) > 0 &&
            Number(row.offspringCount) >= 2,
        );
        if (positive.length < 2) continue;
        const meanSynergy =
          positive.reduce(
            (sum, row) => sum + Number(row.adjustedPairSynergy),
            0,
          ) / positive.length;
        stablePairRows.push({
          parentA,
          parentAName: directName(infoByHid.get(parentA)),
          parentB,
          parentBName: directName(infoByHid.get(parentB)),
          distanceMetres: Number(distanceText),
          researchStatus: "watch",
          meanAdjustedPairSynergy: meanSynergy,
          positiveQualifiedHorizons: positive.length,
          minimumQualifiedOffspring: Math.min(
            ...positive.map((row) => Number(row.offspringCount)),
          ),
          horizons: rows.sort(
            (left, right) =>
              Number(left.horizonDays) - Number(right.horizonDays),
          ),
          warning:
            "WATCH/research-only: pair synergy is residual after individual parent effects and uses first-race chronology proxy.",
        });
      }
      stablePairRows.sort(
        (left, right) =>
          Number(right.meanAdjustedPairSynergy) -
            Number(left.meanAdjustedPairSynergy) ||
          Number(left.parentA) - Number(right.parentA) ||
          Number(left.parentB) - Number(right.parentB),
      );

      const broadSprintParents = [
        ...new Set(robustParentRows.map((row) => Number(row.parentHid))),
      ]
        .map((parentHid) => {
          const effects = robustParentRows.filter(
            (row) =>
              Number(row.parentHid) === parentHid &&
              [1000, 1200, 1400].includes(Number(row.distanceMetres)),
          );
          const profile = careerProfile(parentHid);
          return {
            parentHid,
            parentName: directName(infoByHid.get(parentHid)),
            robustTargetDistanceCount: effects.length,
            robustTargetEffects: effects,
            careerProfile: profile,
            trueSprintShape:
              profile.targetShare >= 0.5 && profile.sprintBandShare >= 0.7,
            researchStatus: "watch",
          };
        })
        .filter((row) => row.robustTargetDistanceCount >= 1)
        .sort(
          (left, right) =>
            right.robustTargetDistanceCount - left.robustTargetDistanceCount ||
            right.careerProfile.targetShare - left.careerProfile.targetShare ||
            left.parentHid - right.parentHid,
        );

      await mkdir("artifacts/analysis", { recursive: true });
      await writeFile(
        "artifacts/analysis/breeding-full-two-parent-analysis.json",
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          methodology: {
            mode: "bike",
            distancesMetres: DISTANCES,
            maturityHorizonsDays: HORIZON_DAYS,
            minimumExactDistanceRaces: MIN_RACES,
            maximumParentPreCutoffRaces: MAX_RACES,
            maximumChildMaturityWindowRaces: MAX_RACES,
            qualityScore: "0.70*median_speed + 0.30*p75_speed",
            benchmark:
              "equal-Core exact-distance pre-cutoff speed distribution",
            expectation:
              "chronological nearest historical matings, minimum 20, maximum 50; target parents excluded from their own expectation cohort",
            attribution:
              "robust ridge parent effect (ridge strength 12) plus shrunk residual pair synergy",
            creationAuthority: "first_race_proxy",
            recommendationAuthority: "watch_only",
          },
          acquisition: {
            sourceRecordCount: records.length,
            uniqueRecordCount: uniqueRecords.length,
            duplicateCount: records.length - uniqueRecords.length,
            conflictingDuplicateCount: conflicts.length,
            bikeRecordCount: timedBike.length,
            shardSummaries,
          },
          lineage: {
            cleanTwoParentRelationCount: relations.length,
            targetParentWithOffspringCount: targetParentHids.size,
            relationsWithBothParentsInHistory: relations.filter((relation) =>
              relation.parents.every((parent) => firstRaceByHid.has(parent)),
            ).length,
          },
          matingCoverage,
          effectDecompositions,
          robustParentEffects: robustParentRows,
          broadSprintParentResearch: broadSprintParents,
          stablePairSynergies: stablePairRows,
          authority: {
            noAuthoritativeTargets: true,
            reason:
              "DNA Open Lab did not expose authoritative offspring minted_at timestamps for this census; first-race chronology is a research proxy only.",
          },
        }),
        "utf8",
      );

      expect(uniqueRecords.length).toBeGreaterThan(600_000);
      expect(relations.length).toBeGreaterThan(700);
      expect(
        relations.filter((relation) =>
          relation.parents.every((parent) => firstRaceByHid.has(parent)),
        ).length,
      ).toBe(relations.length);
      expect(robustParentRows.length).toBeGreaterThan(0);
      expect(stablePairRows.length).toBeGreaterThan(0);
    },
    45 * 60_000,
  );
});
