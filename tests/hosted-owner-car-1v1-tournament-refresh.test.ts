import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const enabled = process.env.DNA_OWNER_CAR_1V1_TOURNAMENT_REFRESH === "1";
const describeConnected = enabled ? describe : describe.skip;

const V1_BASE = "https://api.dnaracing.run/fbike/pub/v1";
const HISTORY_URL = "https://api.dnaracing.run/fbike/i/hraces";
const CUTOFF_EXCLUSIVE = "2026-05-23T18:12:51.787Z";
const PAGE_SIZE = 50;
const MAXIMUM_PAGES_PER_CORE = 40;
const MAXIMUM_LEGACY_REQUESTS = 700;
const MINIMUM_REQUEST_INTERVAL_MS = 2_050;
const TARGET_DISTANCES = Object.freeze([
  1000, 1200, 1400, 1600, 1800, 2000, 2200,
] as const);
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;

type AnyRecord = Record<string, unknown>;

type Sample = Readonly<{
  elapsed: number;
  eventAt: string;
  twoGate: boolean;
  war: boolean;
}>;

type CandidateAccumulator = {
  coreId: number;
  name: string;
  element: string;
  byDistance: Map<number, Sample[]>;
};

function required(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    value.trim() !== value ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(
      "required protected tournament configuration is unavailable",
    );
  }
  return value;
}

function record(value: unknown, label: string): AnyRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value as AnyRecord;
}

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : value;
  return Number.isSafeInteger(parsed) && Number(parsed) > 0
    ? Number(parsed)
    : null;
}

function positiveFinite(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value)
      ? Number(value)
      : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function percentile(values: readonly number[], p: number): number {
  if (values.length < 1) throw new Error("percentile sample is empty");
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return ordered[lower]!;
  const weight = index - lower;
  return ordered[lower]! * (1 - weight) + ordered[upper]! * weight;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stats(samples: readonly Sample[]) {
  const elapsed = samples.map((sample) => sample.elapsed).sort((a, b) => a - b);
  const trim = elapsed.length >= 10 ? Math.floor(elapsed.length * 0.1) : 0;
  const trimmed =
    trim > 0 ? elapsed.slice(trim, elapsed.length - trim) : elapsed;
  const mean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  const fullMean =
    elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length;
  const variance =
    elapsed.reduce((sum, value) => sum + (value - fullMean) ** 2, 0) /
    elapsed.length;
  const twoGate = samples.filter((sample) => sample.twoGate);
  const war = samples.filter((sample) => sample.war);
  return Object.freeze({
    sampleCount: elapsed.length,
    meanSeconds: rounded(fullMean),
    medianSeconds: rounded(percentile(elapsed, 0.5)),
    trimmedMeanSeconds: rounded(mean),
    iqrSeconds: rounded(percentile(elapsed, 0.75) - percentile(elapsed, 0.25)),
    sdSeconds: rounded(Math.sqrt(variance)),
    p10Seconds: rounded(percentile(elapsed, 0.1)),
    fastestSeconds: rounded(elapsed[0]!),
    quantilesSeconds: Object.freeze({
      p05: rounded(percentile(elapsed, 0.05)),
      p10: rounded(percentile(elapsed, 0.1)),
      p25: rounded(percentile(elapsed, 0.25)),
      p50: rounded(percentile(elapsed, 0.5)),
      p75: rounded(percentile(elapsed, 0.75)),
      p90: rounded(percentile(elapsed, 0.9)),
      p95: rounded(percentile(elapsed, 0.95)),
    }),
    latestEventAt: [...samples]
      .map((sample) => sample.eventAt)
      .sort()
      .at(-1)!,
    twoGateSampleCount: twoGate.length,
    twoGateMedianSeconds:
      twoGate.length > 0
        ? rounded(
            percentile(
              twoGate.map((sample) => sample.elapsed),
              0.5,
            ),
          )
        : null,
    warSampleCount: war.length,
    warMedianSeconds:
      war.length > 0
        ? rounded(
            percentile(
              war.map((sample) => sample.elapsed),
              0.5,
            ),
          )
        : null,
  });
}

describeConnected("owner Car 1v1 tournament refresh", () => {
  it(
    "reads current Vault identity and only the post-boundary Core-history window without persistence",
    async () => {
      const expectedMainSha = required("GITHUB_SHA");
      if (!/^[a-f0-9]{40}$/u.test(expectedMainSha)) {
        throw new Error("exact main commit is unavailable");
      }
      const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
      if (!API_KEY_PATTERN.test(apiKey)) {
        throw new Error("protected API key is invalid");
      }
      const vault = required("DNA_OPEN_LAB_VAULT");
      const fetchedAt = new Date().toISOString();
      const cutoffMs = Date.parse(CUTOFF_EXCLUSIVE);
      let lastRequestStartedAt = 0;
      let publicRequestCount = 0;
      let legacyRequestCount = 0;

      const pace = async () => {
        const wait =
          MINIMUM_REQUEST_INTERVAL_MS - (Date.now() - lastRequestStartedAt);
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastRequestStartedAt = Date.now();
      };

      const readEnvelope = async (
        response: Response,
        label: string,
      ): Promise<unknown> => {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error(`${label} returned non-JSON content`);
        }
        const envelope = record(body, label);
        if (
          !response.ok ||
          envelope.status !== "success" ||
          !("result" in envelope)
        ) {
          throw new Error(`${label} was rejected`);
        }
        return envelope.result;
      };

      const v1 = async (path: string, init: RequestInit = {}) => {
        await pace();
        publicRequestCount += 1;
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${apiKey}`);
        headers.set("Accept", "application/json");
        const response = await fetch(`${V1_BASE}${path}`, {
          ...init,
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429) {
          throw new Error(
            "tournament refresh reached the keyed API rate limit",
          );
        }
        return readEnvelope(response, "DNA Open Lab");
      };

      const encodedVault = encodeURIComponent(vault);
      const coresRaw = await v1(`/vault/${encodedVault}/cores_full`);
      if (
        !Array.isArray(coresRaw) ||
        coresRaw.length < 1 ||
        coresRaw.length > 500
      ) {
        throw new Error("current Vault Core inventory is invalid");
      }
      const coreMetadata = new Map<
        number,
        Readonly<{ name: string; element: string }>
      >();
      for (const value of coresRaw) {
        const core = record(value, "Vault Core");
        const hid = positiveInteger(core.hid);
        const name = typeof core.name === "string" ? core.name.trim() : "";
        const rawElement =
          typeof core.element === "string"
            ? core.element.trim().toLowerCase()
            : "";
        const element = (
          {
            metal: "Metal",
            fire: "Fire",
            earth: "Earth",
            water: "Water",
          } as const
        )[rawElement as "metal" | "fire" | "earth" | "water"];
        if (
          hid === null ||
          name.length < 1 ||
          name.length > 256 ||
          element === undefined ||
          coreMetadata.has(hid)
        ) {
          throw new Error(
            "current Vault Core inventory contains invalid identity",
          );
        }
        coreMetadata.set(hid, Object.freeze({ name, element }));
      }

      const carCareerCounts = new Map<number, number>();
      const coreIds = [...coreMetadata.keys()].sort((a, b) => a - b);
      for (let offset = 0; offset < coreIds.length; offset += 20) {
        const batch = coreIds.slice(offset, offset + 20);
        const result = await v1("/cores/racing_stats_bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hids: batch }),
        });
        if (!Array.isArray(result) || result.length !== batch.length) {
          throw new Error("Car career bulk response is incomplete");
        }
        for (const value of result) {
          const row = record(value, "Core racing stats");
          const hid = positiveInteger(row.hid);
          const car = record(row.hstats_car, "Car racing stats");
          const career = record(car.career, "Car career stats");
          const races = Number(career.races_n);
          if (
            hid === null ||
            !coreMetadata.has(hid) ||
            !Number.isSafeInteger(races) ||
            races < 0
          ) {
            throw new Error("Car career stats are invalid");
          }
          carCareerCounts.set(hid, races);
        }
      }
      if (carCareerCounts.size !== coreMetadata.size) {
        throw new Error("Car career coverage is incomplete");
      }

      const candidates = new Map<number, CandidateAccumulator>();
      let latestCarEventAt: string | null = null;
      let orderingFallbackCoreCount = 0;
      let scannedCarCoreCount = 0;
      let postBoundaryCarObservationCount = 0;

      const historyPage = async (hid: number, page: number) => {
        if (legacyRequestCount >= MAXIMUM_LEGACY_REQUESTS) {
          throw new Error("bounded legacy request ceiling was reached");
        }
        await pace();
        legacyRequestCount += 1;
        const response = await fetch(HISTORY_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ hid, page }),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429) {
          throw new Error(
            "tournament refresh reached the legacy history rate limit",
          );
        }
        const result = await readEnvelope(response, "DNA Core history");
        if (!Array.isArray(result) || result.length > PAGE_SIZE) {
          throw new Error("DNA Core history page is malformed");
        }
        return result.map((value) => record(value, "DNA Core history row"));
      };

      for (const hid of coreIds) {
        if ((carCareerCounts.get(hid) ?? 0) < 1) continue;
        scannedCarCoreCount += 1;
        let previousOldestMs: number | null = null;
        let orderingCertain = true;
        let reachedBoundary = false;
        for (let page = 1; page <= MAXIMUM_PAGES_PER_CORE; page += 1) {
          const pageRows = await historyPage(hid, page);
          const timestamps = pageRows.map((row) => timestamp(row.start_time));
          const validMs = timestamps
            .filter((value): value is string => value !== null)
            .map((value) => Date.parse(value));
          if (validMs.length !== pageRows.length) orderingCertain = false;
          for (let index = 1; index < validMs.length; index += 1) {
            if (validMs[index]! > validMs[index - 1]!) orderingCertain = false;
          }
          if (
            previousOldestMs !== null &&
            validMs.length > 0 &&
            Math.max(...validMs) > previousOldestMs
          ) {
            orderingCertain = false;
          }
          if (validMs.length > 0) {
            previousOldestMs = Math.min(...validMs);
          }

          for (let index = 0; index < pageRows.length; index += 1) {
            const row = pageRows[index]!;
            const rowHid = positiveInteger(row.hid);
            if (rowHid !== hid) {
              throw new Error(
                "legacy history returned a different Core identity",
              );
            }
            if (row.rvmode !== "car") continue;
            const eventAt = timestamps[index] ?? null;
            if (eventAt === null) continue;
            if (latestCarEventAt === null || eventAt > latestCarEventAt) {
              latestCarEventAt = eventAt;
            }
            if (Date.parse(eventAt) <= cutoffMs) continue;
            postBoundaryCarObservationCount += 1;
            const cb = positiveInteger(row.cb);
            const distance = cb === null ? null : cb < 100 ? cb * 100 : cb;
            if (
              distance === null ||
              !TARGET_DISTANCES.includes(
                distance as (typeof TARGET_DISTANCES)[number],
              )
            ) {
              continue;
            }
            const elapsed = positiveFinite(row.time);
            if (elapsed === null) continue;
            const gateCount = positiveInteger(row.rgate);
            const format =
              typeof row.format === "string" ? row.format.trim() : "";
            const accumulator = candidates.get(hid) ?? {
              coreId: hid,
              name: coreMetadata.get(hid)!.name,
              element: coreMetadata.get(hid)!.element,
              byDistance: new Map<number, Sample[]>(),
            };
            const distanceSamples = accumulator.byDistance.get(distance) ?? [];
            distanceSamples.push(
              Object.freeze({
                elapsed,
                eventAt,
                twoGate: gateCount === 2,
                war: gateCount === 2 && format === "sub_war",
              }),
            );
            accumulator.byDistance.set(distance, distanceSamples);
            candidates.set(hid, accumulator);
          }

          if (pageRows.length < PAGE_SIZE) {
            reachedBoundary = true;
            break;
          }
          if (
            orderingCertain &&
            previousOldestMs !== null &&
            previousOldestMs <= cutoffMs
          ) {
            reachedBoundary = true;
            break;
          }
        }
        if (!orderingCertain) orderingFallbackCoreCount += 1;
        if (!reachedBoundary) {
          throw new Error(
            "one Core exceeded the bounded post-May history window",
          );
        }
      }

      const distanceCandidates: Record<string, unknown[]> = {};
      for (const distance of TARGET_DISTANCES) {
        const ranked = [...candidates.values()]
          .map((candidate) => {
            const samples = candidate.byDistance.get(distance) ?? [];
            if (samples.length < 1) return null;
            return Object.freeze({
              coreId: candidate.coreId,
              name: candidate.name,
              element: candidate.element,
              ...stats(samples),
            });
          })
          .filter((value): value is NonNullable<typeof value> => value !== null)
          .sort(
            (left, right) =>
              left.medianSeconds - right.medianSeconds ||
              right.sampleCount - left.sampleCount ||
              left.coreId - right.coreId,
          );
        distanceCandidates[String(distance)] = ranked;
      }

      const report = Object.freeze({
        version: 1,
        exactMainSha: expectedMainSha,
        fetchedAt,
        cutoffExclusive: CUTOFF_EXCLUSIVE,
        policy: Object.freeze({
          readOnly: true,
          persistentProviderWrite: false,
          aggregateRequestsPerMinuteCeiling: 30,
          rawRaceIdentitiesIncluded: false,
          rawProviderPayloadsIncluded: false,
        }),
        coverage: Object.freeze({
          currentVaultCoreCount: coreMetadata.size,
          distanceCount: TARGET_DISTANCES.length,
          carCareerCoreCount: [...carCareerCounts.values()].filter(
            (count) => count > 0,
          ).length,
          scannedCarCoreCount,
          publicRequestCount,
          legacyPageRequestCount: legacyRequestCount,
          postBoundaryCarObservationCount,
          orderingFallbackCoreCount,
          latestCarEventAt,
        }),
        currentVaultCores: Object.freeze(
          coreIds.map((coreId) =>
            Object.freeze({
              coreId,
              name: coreMetadata.get(coreId)!.name,
              element: coreMetadata.get(coreId)!.element,
              carCareerRaceCount: carCareerCounts.get(coreId)!,
            }),
          ),
        ),
        distanceCandidates,
        privateNormalizedSamples: Object.freeze(
          [...candidates.values()]
            .sort((left, right) => left.coreId - right.coreId)
            .map((candidate) =>
              Object.freeze({
                coreId: candidate.coreId,
                name: candidate.name,
                element: candidate.element,
                byDistance: Object.fromEntries(
                  TARGET_DISTANCES.map((distance) => [
                    String(distance),
                    Object.freeze([
                      ...(candidate.byDistance.get(distance) ?? []),
                    ]),
                  ]),
                ),
              }),
            ),
        ),
      });

      await writeFile(
        "owner-car-1v1-tournament-refresh.json",
        JSON.stringify(report),
        "utf8",
      );
      console.log(
        "DNA_OWNER_CAR_1V1_TOURNAMENT_REFRESH_SUMMARY=" +
          JSON.stringify({
            currentVaultCoreCount: report.coverage.currentVaultCoreCount,
            carCareerCoreCount: report.coverage.carCareerCoreCount,
            legacyPageRequestCount: report.coverage.legacyPageRequestCount,
            postBoundaryCarObservationCount:
              report.coverage.postBoundaryCarObservationCount,
            latestCarEventAt: report.coverage.latestCarEventAt,
          }),
      );
      expect(report.coverage.currentVaultCoreCount).toBeGreaterThan(0);
      expect(report.coverage.latestCarEventAt).not.toBeNull();
    },
    40 * 60_000,
  );
});
