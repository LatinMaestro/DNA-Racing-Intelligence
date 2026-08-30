import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildBreederQualityBenchmark,
  type BreederOffspringOutcome,
  type BreederScope,
} from "../domain/breeder-quality";

const enabled = process.env.DNA_BREEDING_OFFSPRING_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const MIN_RACES = 5;
const MIN_BENCHMARK_CORES = 25;

type AnyRecord = Record<string, unknown>;
type HistoryRecord = {
  hid: number;
  rid: string;
  rvmode: "bike" | "car" | "horse";
  distanceMetres: number;
  elapsedSeconds: number;
  speedMetresPerSecond: number;
  gate: number | null;
  startTime: string | null;
  raw?: AnyRecord;
};

type PerformanceSummary = {
  hid: number;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  sampleSize: number;
  medianSpeed: number;
  upperTailSpeed: number;
  rawScore: number;
  qualityPercentile: number;
};

type DraftOutcome = {
  parentCoreId: string;
  coParentCoreId: string;
  offspringCoreId: string;
  scope: BreederScope;
  offspringQualityPercentile: number;
  expectedQualityPercentile: number;
  rawLift: number;
  offspringRaceSampleSize: number;
  benchmarkPopulationSize: number;
  offspringCreatedAt: string;
  expectedModelCutoff: string;
  evaluationCutoff: string;
  creationAuthority: "minted_at" | "first_race_proxy";
  selectedDistanceMetres: number;
};

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  const weight = position - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function percentileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  const lower = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (100 * (lower + 0.5 * equal)) / values.length;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function monthStart(iso: string): string {
  const date = new Date(iso);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  ).toISOString();
}

function findTimestampField(value: unknown, wantedKey: string): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTimestampField(entry, wantedKey);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value as AnyRecord)) {
    if (key.toLowerCase() === wantedKey.toLowerCase()) {
      const timestamp = canonicalTimestamp(entry);
      if (timestamp) return timestamp;
    }
    const nested = findTimestampField(entry, wantedKey);
    if (nested) return nested;
  }
  return null;
}

function scopeKey(scope: BreederScope): string {
  return `${scope.mode}|${scope.distanceMetres ?? "all"}`;
}

describeConnected("offspring breeder history analysis", () => {
  it(
    "derives chronological parent-offspring lift and separates authoritative from proxy creation evidence",
    async () => {
      const inventoryPath =
        process.env.BREEDING_INVENTORY_PATH ??
        "artifacts/inventory/breeding-universe-inventory.json";
      const historyDir =
        process.env.BREEDING_HISTORY_DIR ?? "artifacts/history";
      const inventory = JSON.parse(
        await readFile(inventoryPath, "utf8"),
      ) as AnyRecord;
      const evaluationCutoff =
        canonicalTimestamp(inventory.fetchedAt) ?? new Date().toISOString();

      const historyFiles = (await readdir(historyDir))
        .filter((name) => /^breeding-race-history-\d+\.json$/u.test(name))
        .sort();
      if (historyFiles.length === 0)
        throw new Error("No history shard artifacts found.");
      const history: HistoryRecord[] = [];
      const historyShardSummaries: AnyRecord[] = [];
      for (const file of historyFiles) {
        const payload = JSON.parse(
          await readFile(`${historyDir}/${file}`, "utf8"),
        ) as AnyRecord;
        historyShardSummaries.push({
          file,
          requestCount: payload.requestCount,
          recordCount: payload.recordCount,
          truncatedHids: payload.truncatedHids ?? [],
          errorCount: Array.isArray(payload.errors) ? payload.errors.length : 0,
        });
        history.push(...((payload.records ?? []) as HistoryRecord[]));
      }

      const infoByHid = new Map<number, AnyRecord>(
        ((inventory?.coreFamilies?.info ?? []) as AnyRecord[]).map((row) => [
          Number(row.hid),
          row,
        ]),
      );
      const splicingByHid = new Map<number, AnyRecord>(
        ((inventory?.coreFamilies?.splicing ?? []) as AnyRecord[]).map(
          (row) => [Number(row.hid), row],
        ),
      );
      const directParentsByChild = new Map<number, number[]>(
        Object.entries(inventory?.universe?.directParentsByChild ?? {}).map(
          ([hid, parents]) => [
            Number(hid),
            (parents as unknown[])
              .map(Number)
              .filter((value) => Number.isSafeInteger(value) && value > 0),
          ],
        ),
      );
      const explicitMintedAt = new Map<number, string>(
        Object.entries(inventory?.spliceDiscovery?.mintedAtByHid ?? {})
          .map(
            ([hid, value]) => [Number(hid), canonicalTimestamp(value)] as const,
          )
          .filter(
            (entry): entry is readonly [number, string] =>
              Number.isSafeInteger(entry[0]) && entry[1] !== null,
          ),
      );
      for (const [hid, row] of splicingByHid) {
        if (explicitMintedAt.has(hid)) continue;
        const found = findTimestampField(row?.splice_core, "minted_at");
        if (found) explicitMintedAt.set(hid, found);
      }

      const byCoreModeDistance = new Map<string, HistoryRecord[]>();
      const firstRaceByHid = new Map<number, string>();
      for (const record of history) {
        if (!record.startTime) continue;
        const existingFirst = firstRaceByHid.get(record.hid);
        if (!existingFirst || record.startTime < existingFirst)
          firstRaceByHid.set(record.hid, record.startTime);
        const key = `${record.hid}|${record.rvmode}|${record.distanceMetres}`;
        const rows = byCoreModeDistance.get(key) ?? [];
        rows.push(record);
        byCoreModeDistance.set(key, rows);
      }

      const rawSummaries: Omit<PerformanceSummary, "qualityPercentile">[] = [];
      for (const [key, rows] of byCoreModeDistance) {
        if (rows.length < MIN_RACES) continue;
        const [hidText, mode, distanceText] = key.split("|");
        const speeds = rows
          .map((row) => row.speedMetresPerSecond)
          .filter(Number.isFinite);
        if (speeds.length < MIN_RACES) continue;
        const medianSpeed = median(speeds);
        const upperTailSpeed = quantile(speeds, 0.8);
        rawSummaries.push({
          hid: Number(hidText),
          mode: mode as PerformanceSummary["mode"],
          distanceMetres: Number(distanceText),
          sampleSize: speeds.length,
          medianSpeed,
          upperTailSpeed,
          rawScore: 0.8 * medianSpeed + 0.2 * upperTailSpeed,
        });
      }

      const rawByScope = new Map<string, typeof rawSummaries>();
      for (const summary of rawSummaries) {
        const key = `${summary.mode}|${summary.distanceMetres}`;
        const rows = rawByScope.get(key) ?? [];
        rows.push(summary);
        rawByScope.set(key, rows);
      }
      const fullSummaries: PerformanceSummary[] = [];
      for (const rows of rawByScope.values()) {
        const values = rows.map((row) => row.rawScore);
        for (const row of rows) {
          fullSummaries.push({
            ...row,
            qualityPercentile: percentileRank(values, row.rawScore),
          });
        }
      }
      const indexedHistory = new Map<string, HistoryRecord[]>();
      for (const record of history) {
        if (!record.startTime) continue;
        const key = `${record.rvmode}|${record.distanceMetres}`;
        const rows = indexedHistory.get(key) ?? [];
        rows.push(record);
        indexedHistory.set(key, rows);
      }
      for (const rows of indexedHistory.values())
        rows.sort((a, b) =>
          (a.startTime ?? "").localeCompare(b.startTime ?? ""),
        );

      const historicalQualityCache = new Map<
        string,
        Map<number, { percentile: number; sampleSize: number }>
      >();
      const historicalQuality = (
        mode: PerformanceSummary["mode"],
        distanceMetres: number,
        cutoff: string,
      ): Map<number, { percentile: number; sampleSize: number }> => {
        const cacheKey = `${mode}|${distanceMetres}|${cutoff}`;
        const cached = historicalQualityCache.get(cacheKey);
        if (cached) return cached;
        const rows = (
          indexedHistory.get(`${mode}|${distanceMetres}`) ?? []
        ).filter(
          (record) => record.startTime !== null && record.startTime < cutoff,
        );
        const grouped = new Map<number, number[]>();
        for (const row of rows) {
          const speeds = grouped.get(row.hid) ?? [];
          speeds.push(row.speedMetresPerSecond);
          grouped.set(row.hid, speeds);
        }
        const scores: { hid: number; score: number; sampleSize: number }[] = [];
        for (const [hid, speeds] of grouped) {
          if (speeds.length < MIN_RACES) continue;
          scores.push({
            hid,
            score: 0.8 * median(speeds) + 0.2 * quantile(speeds, 0.8),
            sampleSize: speeds.length,
          });
        }
        const benchmark = scores.map((entry) => entry.score);
        const map = new Map<
          number,
          { percentile: number; sampleSize: number }
        >();
        if (benchmark.length >= MIN_BENCHMARK_CORES) {
          for (const entry of scores) {
            map.set(entry.hid, {
              percentile: percentileRank(benchmark, entry.score),
              sampleSize: entry.sampleSize,
            });
          }
        }
        historicalQualityCache.set(cacheKey, map);
        return map;
      };

      const relations = [...directParentsByChild.entries()]
        .map(([child, parents]) => ({
          child,
          parents: [...new Set(parents)].filter((parent) => parent !== child),
        }))
        .filter((relation) => relation.parents.length === 2);
      const drafts: DraftOutcome[] = [];
      const skippedRelations: AnyRecord[] = [];
      const pairLiftRows: AnyRecord[] = [];

      for (const relation of relations) {
        const [parentA, parentB] = relation.parents;
        const mintedAt = explicitMintedAt.get(relation.child) ?? null;
        const firstRace = firstRaceByHid.get(relation.child) ?? null;
        const createdAt = mintedAt ?? firstRace;
        if (!createdAt) {
          skippedRelations.push({
            child: relation.child,
            parents: relation.parents,
            reason: "no_creation_or_first_race_time",
          });
          continue;
        }
        const creationAuthority: DraftOutcome["creationAuthority"] = mintedAt
          ? "minted_at"
          : "first_race_proxy";
        const modelCutoff = monthStart(createdAt);
        const childSummaries = fullSummaries.filter(
          (summary) => summary.hid === relation.child,
        );
        if (childSummaries.length === 0) {
          skippedRelations.push({
            child: relation.child,
            parents: relation.parents,
            reason: "no_qualified_offspring_performance",
          });
          continue;
        }

        for (const childSummary of childSummaries) {
          const benchmark =
            rawByScope.get(
              `${childSummary.mode}|${childSummary.distanceMetres}`,
            ) ?? [];
          if (benchmark.length < MIN_BENCHMARK_CORES) continue;
          const historical = historicalQuality(
            childSummary.mode,
            childSummary.distanceMetres,
            modelCutoff,
          );
          const qualityA = historical.get(parentA);
          const qualityB = historical.get(parentB);
          if (!qualityA || !qualityB) continue;
          const expected = (qualityA.percentile + qualityB.percentile) / 2;
          const rawLift = childSummary.qualityPercentile - expected;
          const common = {
            offspringCoreId: String(relation.child),
            scope: {
              mode: childSummary.mode,
              distanceMetres: childSummary.distanceMetres,
            } satisfies BreederScope,
            offspringQualityPercentile: childSummary.qualityPercentile,
            expectedQualityPercentile: expected,
            rawLift,
            offspringRaceSampleSize: childSummary.sampleSize,
            benchmarkPopulationSize: benchmark.length,
            offspringCreatedAt: createdAt,
            expectedModelCutoff: modelCutoff,
            evaluationCutoff,
            creationAuthority,
            selectedDistanceMetres: childSummary.distanceMetres,
          };
          drafts.push({
            ...common,
            parentCoreId: String(parentA),
            coParentCoreId: String(parentB),
          });
          drafts.push({
            ...common,
            parentCoreId: String(parentB),
            coParentCoreId: String(parentA),
          });
          pairLiftRows.push({
            child: relation.child,
            parentA,
            parentB,
            mode: childSummary.mode,
            distanceMetres: childSummary.distanceMetres,
            rawLift,
            childQualityPercentile: childSummary.qualityPercentile,
            expectedQualityPercentile: expected,
            creationAuthority,
          });
        }

        for (const mode of ["bike", "car", "horse"] as const) {
          const best = childSummaries
            .filter((summary) => summary.mode === mode)
            .sort(
              (a, b) =>
                b.qualityPercentile - a.qualityPercentile ||
                b.sampleSize - a.sampleSize,
            )[0];
          if (!best) continue;
          const historical = historicalQuality(
            mode,
            best.distanceMetres,
            modelCutoff,
          );
          const qualityA = historical.get(parentA);
          const qualityB = historical.get(parentB);
          if (!qualityA || !qualityB) continue;
          const expected = (qualityA.percentile + qualityB.percentile) / 2;
          const rawLift = best.qualityPercentile - expected;
          const common = {
            offspringCoreId: String(relation.child),
            scope: { mode, distanceMetres: null } satisfies BreederScope,
            offspringQualityPercentile: best.qualityPercentile,
            expectedQualityPercentile: expected,
            rawLift,
            offspringRaceSampleSize: best.sampleSize,
            benchmarkPopulationSize:
              rawByScope.get(`${mode}|${best.distanceMetres}`)?.length ?? 0,
            offspringCreatedAt: createdAt,
            expectedModelCutoff: modelCutoff,
            evaluationCutoff,
            creationAuthority,
            selectedDistanceMetres: best.distanceMetres,
          };
          drafts.push({
            ...common,
            parentCoreId: String(parentA),
            coParentCoreId: String(parentB),
          });
          drafts.push({
            ...common,
            parentCoreId: String(parentB),
            coParentCoreId: String(parentA),
          });
        }
      }

      const draftScopes = new Map<string, DraftOutcome[]>();
      for (const draft of drafts) {
        const key = scopeKey(draft.scope);
        const rows = draftScopes.get(key) ?? [];
        rows.push(draft);
        draftScopes.set(key, rows);
      }

      const authoritativeOutcomes: BreederOffspringOutcome[] = [];
      const proxyOutcomes: BreederOffspringOutcome[] = [];
      for (const rows of draftScopes.values()) {
        const liftValues = rows.map((row) => row.rawLift);
        for (const row of rows) {
          const outcome: BreederOffspringOutcome = {
            parentCoreId: row.parentCoreId,
            coParentCoreId: row.coParentCoreId,
            offspringCoreId: row.offspringCoreId,
            scope: row.scope,
            offspringQualityPercentile: row.offspringQualityPercentile,
            expectedQualityPercentile: row.expectedQualityPercentile,
            residualPercentile: percentileRank(liftValues, row.rawLift),
            offspringRaceSampleSize: row.offspringRaceSampleSize,
            benchmarkPopulationSize: row.benchmarkPopulationSize,
            offspringCreatedAt: row.offspringCreatedAt,
            expectedModelCutoff: row.expectedModelCutoff,
            evaluationCutoff: row.evaluationCutoff,
          };
          if (row.creationAuthority === "minted_at")
            authoritativeOutcomes.push(outcome);
          else proxyOutcomes.push(outcome);
        }
      }

      const benchmarkResults: AnyRecord[] = [];
      const scopeKeys = [
        ...new Set(
          authoritativeOutcomes.map((outcome) => scopeKey(outcome.scope)),
        ),
      ].sort();
      for (const key of scopeKeys) {
        const [mode, distanceText] = key.split("|");
        const scope: BreederScope = {
          mode: mode as BreederScope["mode"],
          distanceMetres: distanceText === "all" ? null : Number(distanceText),
        };
        const outcomes = authoritativeOutcomes.filter(
          (outcome) => scopeKey(outcome.scope) === key,
        );
        const parentCount = new Set(
          outcomes.map((outcome) => outcome.parentCoreId),
        ).size;
        if (outcomes.length < 10 || parentCount < 5) continue;
        const benchmark = buildBreederQualityBenchmark({ scope, outcomes });
        benchmarkResults.push({
          scope,
          qualifiedOutcomeCount: benchmark.qualifiedOutcomeCount,
          parentCount: benchmark.parentCount,
          populationEliteOffspringRate: benchmark.populationEliteOffspringRate,
          populationExceptionalOffspringRate:
            benchmark.populationExceptionalOffspringRate,
          targets: benchmark.assessments
            .filter((assessment) => assessment.status === "target")
            .slice(0, 50),
          watches: benchmark.assessments
            .filter((assessment) => assessment.status === "watch")
            .slice(0, 50),
          topAssessments: benchmark.assessments.slice(0, 100),
        });
      }

      const ownBestRacerQuality = new Map<string, number>();
      for (const summary of fullSummaries) {
        const key = `${summary.hid}|${summary.mode}`;
        ownBestRacerQuality.set(
          key,
          Math.max(
            ownBestRacerQuality.get(key) ?? 0,
            summary.qualityPercentile,
          ),
        );
      }
      const averageRacerEliteBreeders: AnyRecord[] = [];
      for (const result of benchmarkResults) {
        for (const target of result.targets as AnyRecord[]) {
          const ownQuality =
            ownBestRacerQuality.get(
              `${target.parentCoreId}|${result.scope.mode}`,
            ) ?? null;
          if (ownQuality !== null && ownQuality < 90) {
            averageRacerEliteBreeders.push({
              mode: result.scope.mode,
              distanceMetres: result.scope.distanceMetres,
              parentCoreId: target.parentCoreId,
              parentName:
                infoByHid.get(Number(target.parentCoreId))?.name ?? null,
              ownBestRacerQualityPercentile: ownQuality,
              breederAssessment: target,
            });
          }
        }
      }

      const pairGroups = new Map<string, AnyRecord[]>();
      for (const row of pairLiftRows.filter(
        (entry) => entry.creationAuthority === "minted_at",
      )) {
        const pair = [row.parentA, row.parentB].sort(
          (a: number, b: number) => a - b,
        );
        const key = `${pair[0]}|${pair[1]}|${row.mode}|${row.distanceMetres}`;
        const rows = pairGroups.get(key) ?? [];
        rows.push(row);
        pairGroups.set(key, rows);
      }
      const pairSynergies = [...pairGroups.entries()]
        .map(([key, rows]) => {
          const [parentAText, parentBText, mode, distanceText] = key.split("|");
          const lifts = rows.map((row) => Number(row.rawLift));
          return {
            parentA: Number(parentAText),
            parentB: Number(parentBText),
            parentAName: infoByHid.get(Number(parentAText))?.name ?? null,
            parentBName: infoByHid.get(Number(parentBText))?.name ?? null,
            mode,
            distanceMetres: Number(distanceText),
            offspringCount: new Set(rows.map((row) => row.child)).size,
            medianLift: median(lifts),
            positiveLiftRate:
              lifts.filter((lift) => lift > 0).length / lifts.length,
            exceptionalLikeCount: rows.filter(
              (row) => row.childQualityPercentile >= 95 && row.rawLift >= 20,
            ).length,
          };
        })
        .filter((row) => row.offspringCount >= 2)
        .sort(
          (a, b) =>
            b.medianLift - a.medianLift || b.offspringCount - a.offspringCount,
        )
        .slice(0, 200);

      const creationCoverage = {
        lineageChildren: relations.length,
        authoritativeMintedAtChildren: relations.filter((relation) =>
          explicitMintedAt.has(relation.child),
        ).length,
        firstRaceProxyChildren: relations.filter(
          (relation) =>
            !explicitMintedAt.has(relation.child) &&
            firstRaceByHid.has(relation.child),
        ).length,
      };

      await mkdir("artifacts/analysis", { recursive: true });
      await writeFile(
        "artifacts/analysis/breeding-offspring-analysis.json",
        JSON.stringify({
          schemaVersion: 1,
          evaluationCutoff,
          historyShardSummaries,
          historyRecordCount: history.length,
          performanceSummaryCount: fullSummaries.length,
          lineageRelationCount: relations.length,
          creationCoverage,
          draftOutcomeCount: drafts.length,
          authoritativeOutcomeCount: authoritativeOutcomes.length,
          proxyOutcomeCount: proxyOutcomes.length,
          skippedRelations,
          benchmarkResults,
          averageRacerEliteBreeders: averageRacerEliteBreeders.sort(
            (a, b) =>
              (b.breederAssessment?.breederScore ?? 0) -
              (a.breederAssessment?.breederScore ?? 0),
          ),
          pairSynergies,
          method: {
            exactPerformance:
              "0.8 * median speed + 0.2 * 80th-percentile speed, then population percentile",
            expectedBaseline:
              "mean of both parents' pre-cutoff exact-distance quality percentiles",
            chronologicalCutoff:
              "UTC month start at or before minted_at; first-race proxy is exploratory only",
            authoritativeBreederTargets: "minted_at outcomes only",
            modeWide:
              "offspring's best supported exact-distance specialty within the mode",
          },
        }),
        "utf8",
      );

      expect(history.length).toBeGreaterThan(1000);
      expect(relations.length).toBeGreaterThan(10);
      expect(drafts.length).toBeGreaterThan(0);
    },
    120 * 60_000,
  );
});
