// One-shot connected scan dispatch marker; do not merge.\nimport { describe, expect, it } from "vitest";

import { summarizeDnaOpenLabShape } from "../lib/dna-open-lab-discovery-evidence";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "../lib/dna-open-lab-request-budget";
import {
  createDnaOpenLabV1Client,
  readDnaOpenLabRateLimit,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceFill,
  type DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_API_PERFORMANCE_FIELD_SCAN === "1";
const describeConnected = enabled ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const LEGACY_HISTORY_URL = "https://api.dnaracing.run/fbike/i/hraces";
const BULK_LIMIT = 20;
const MAXIMUM_RACE_IDS = 200;

type JsonRecord = Readonly<Record<string, unknown>>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096
  ) {
    throw new Error(`${name} is missing, padded, or unexpectedly large`);
  }
  return value;
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function raceIdentity(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : null;
}

function candidatePaths(value: unknown): readonly string[] {
  const signal =
    /(?:^|[._])(cb|rcb|dist(?:ance)?|length|met(?:er|re)s?|time|rtime|elapsed|duration|finish|position|pos|place|rank|result|speed|split|lap|track)(?:$|[._])/iu;
  return Object.freeze(
    summarizeDnaOpenLabShape(value, {
      maximumDepth: 16,
      maximumPaths: 4_096,
    })
      .paths.map(({ path }) => path)
      .filter((path) => signal.test(path)),
  );
}

function numericProfile(rows: readonly JsonRecord[], key: string) {
  const values = rows
    .map((row) => positiveNumber(row[key]))
    .filter((value): value is number => value !== null);
  return Object.freeze({
    presentCount: values.length,
    positiveCount: values.filter((value) => value > 0).length,
    integerCount: values.filter(Number.isInteger).length,
    distinctCount: new Set(values).size,
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
  });
}

function containsIdentity(
  value: unknown,
  identities: ReadonlySet<string>,
): boolean {
  const visit = (current: unknown, depth: number): boolean => {
    if (depth > 16 || current === null) return false;
    if (typeof current === "string" || typeof current === "number") {
      return identities.has(String(current));
    }
    if (Array.isArray(current)) {
      return current.some((entry) => visit(entry, depth + 1));
    }
    if (typeof current !== "object") return false;
    return Object.entries(current as Record<string, unknown>).some(
      ([key, entry]) => identities.has(key) || visit(entry, depth + 1),
    );
  };
  return visit(value, 0);
}

describe("DNA API performance scan redaction helpers", () => {
  it("reports only structural candidate paths and aggregate numeric profiles", () => {
    const rows = [
      { hid: 123, rid: "private-race", cb: 12, time: 70.25, pos: 2 },
    ];
    expect(candidatePaths(rows)).toEqual(["$[].cb", "$[].pos", "$[].time"]);
    expect(numericProfile(rows, "time")).toEqual({
      presentCount: 1,
      positiveCount: 1,
      integerCount: 0,
      distinctCount: 1,
      minimum: 70.25,
      maximum: 70.25,
    });
    const serialized = JSON.stringify({
      paths: candidatePaths(rows),
      profile: numericProfile(rows, "time"),
    });
    expect(serialized).not.toContain("private-race");
    expect(serialized).not.toContain("123");
  });
});

describeConnected("hosted DNA API performance field scan", () => {
  it(
    "joins every current owned Core sample to result history and v1 race/Core families without logging private values",
    async () => {
      const apiKeys = [
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
      ] as const;
      for (const apiKey of apiKeys) {
        if (!API_KEY_PATTERN.test(apiKey)) {
          throw new Error("DNA API performance scan key shape is invalid");
        }
      }
      if (new Set(apiKeys).size !== apiKeys.length) {
        throw new Error("DNA API performance scan requires distinct keys");
      }
      const vault = requiredEnvironment("DNA_OPEN_LAB_VAULT");
      const clients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1Client({ apiKey }),
      );
      const budget = createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      });
      const request = <T>(operation: () => Promise<DnaOpenLabResponse<T>>) =>
        budget.execute(operation);

      for (const client of clients) await request(() => client.testAuth());
      const ownedResponse = await request(() => clients[0]!.vaultCores(vault));
      const ownedCoreIds = [...new Set(ownedResponse.result)]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .sort((left, right) => left - right);
      expect(ownedCoreIds.length).toBeGreaterThan(0);

      const legacyRows: JsonRecord[] = [];
      let legacyCoreSuccessCount = 0;
      let legacyCoreEmptyCount = 0;
      let legacyRequestedCoreMatchCount = 0;
      let legacyRequestIndex = 0;
      for (const hid of ownedCoreIds) {
        const client = clients[legacyRequestIndex % clients.length]!;
        legacyRequestIndex += 1;
        // The historical result endpoint is public and takes no credential.
        // It still shares the same conservative aggregate request gate.
        const response = await request(async () => {
          const rawResponse = await fetch(LEGACY_HISTORY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hid, page: 1 }),
            cache: "no-store",
          });
          const rateLimit = readDnaOpenLabRateLimit(rawResponse.headers);
          const body = (await rawResponse.json()) as unknown;
          const envelope = record(body);
          if (
            !rawResponse.ok ||
            envelope === null ||
            envelope.status !== "success" ||
            !Array.isArray(envelope.result)
          ) {
            throw new Error("DNA historical result endpoint was unavailable");
          }
          return Object.freeze({
            result: envelope.result as readonly unknown[],
            httpStatus: rawResponse.status,
            rateLimit,
          });
        });
        const rows = response.result
          .map(record)
          .filter((value): value is JsonRecord => value !== null);
        if (rows.length === 0) legacyCoreEmptyCount += 1;
        else legacyCoreSuccessCount += 1;
        for (const row of rows) {
          legacyRows.push(row);
          if (positiveInteger(row.hid) === hid) {
            legacyRequestedCoreMatchCount += 1;
          }
        }
        // Ensure no client value can accidentally enter the serialized report.
        void client;
      }

      const uniqueRaceIds: DnaRaceIdentifier[] = [];
      const raceIdKeys = new Set<string>();
      for (const row of legacyRows) {
        const identity = raceIdentity(row.rid);
        if (identity === null || raceIdKeys.has(identity)) continue;
        raceIdKeys.add(identity);
        uniqueRaceIds.push(typeof row.rid === "number" ? row.rid : identity);
        if (uniqueRaceIds.length >= MAXIMUM_RACE_IDS) break;
      }

      const raceDocs: DnaRaceDocument[] = [];
      const raceFills: DnaRaceFill[] = [];
      for (const [index, batch] of chunks(
        uniqueRaceIds,
        BULK_LIMIT,
      ).entries()) {
        const client = clients[index % clients.length]!;
        raceDocs.push(...(await request(() => client.raceDocs(batch))).result);
        try {
          raceFills.push(
            ...(await request(() => client.raceFills(batch))).result,
          );
        } catch {
          // Completed races need not retain a current fill document. The join
          // classification below records the observed coverage without values.
        }
      }

      const coreInfos: JsonRecord[] = [];
      const coreStats: JsonRecord[] = [];
      for (const [index, batch] of chunks(ownedCoreIds, BULK_LIMIT).entries()) {
        const client = clients[index % clients.length]!;
        coreInfos.push(
          ...(await request(() => client.coreInfoBulk(batch))).result,
        );
        coreStats.push(
          ...(await request(() => client.coreRacingStatsBulk(batch))).result,
        );
      }

      const finished = (
        await request(() => clients[0]!.racesFinished({ limit: 200 }))
      ).result;
      const recent = (await request(() => clients[1]!.vaultRecentRaces(vault)))
        .result;

      const docsByRaceId = new Map(
        raceDocs
          .map((document) => [raceIdentity(document.rid), document] as const)
          .filter(
            (entry): entry is readonly [string, DnaRaceDocument] =>
              entry[0] !== null,
          ),
      );
      const legacyRaceIds = new Set(
        legacyRows
          .map((row) => raceIdentity(row.rid))
          .filter((value): value is string => value !== null),
      );
      const infoIds = new Set(
        coreInfos
          .map((row) => positiveInteger(row.hid))
          .filter((value): value is number => value !== null),
      );
      const statsIds = new Set(
        coreStats
          .map((row) => positiveInteger(row.hid))
          .filter((value): value is number => value !== null),
      );

      let raceIdJoinCount = 0;
      let raceCoreEntrantJoinCount = 0;
      let cbComparableCount = 0;
      let cbEqualCount = 0;
      for (const row of legacyRows) {
        const rid = raceIdentity(row.rid);
        if (rid === null) continue;
        const document = docsByRaceId.get(rid);
        if (document === undefined) continue;
        raceIdJoinCount += 1;
        const hid = positiveInteger(row.hid);
        if (hid !== null && document.hids?.includes(hid)) {
          raceCoreEntrantJoinCount += 1;
        }
        const legacyCb = positiveNumber(row.cb);
        const documentCb = positiveNumber(document.cb);
        if (legacyCb !== null && documentCb !== null) {
          cbComparableCount += 1;
          if (legacyCb === documentCb) cbEqualCount += 1;
        }
      }

      const statsWithSampleRaceIdentityCount = coreStats.filter((row) =>
        containsIdentity(row, legacyRaceIds),
      ).length;
      const report = Object.freeze({
        version: 1,
        policy: Object.freeze({
          readOnly: true,
          persisted: false,
          aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
          legacyPagesPerOwnedCore: 1,
        }),
        coverage: Object.freeze({
          ownedCoreCount: ownedCoreIds.length,
          legacyCoreSuccessCount,
          legacyCoreEmptyCount,
          legacyRowCount: legacyRows.length,
          legacyRequestedCoreMatchCount,
          sampledUniqueRaceCount: uniqueRaceIds.length,
          v1RaceDocumentCount: raceDocs.length,
          v1RaceFillCount: raceFills.length,
          coreInfoCount: coreInfos.length,
          coreRacingStatsCount: coreStats.length,
          v1FinishedSampleCount: finished.length,
          vaultRecentRaceCount: recent.length,
        }),
        performanceFields: Object.freeze({
          legacyCandidatePaths: candidatePaths(legacyRows),
          raceDocumentCandidatePaths: candidatePaths(raceDocs),
          raceFillCandidatePaths: candidatePaths(raceFills),
          coreInfoCandidatePaths: candidatePaths(coreInfos),
          coreRacingStatsCandidatePaths: candidatePaths(coreStats),
          finishedCandidatePaths: candidatePaths(finished),
          recentCandidatePaths: candidatePaths(recent),
          cb: numericProfile(legacyRows, "cb"),
          elapsedTime: numericProfile(legacyRows, "time"),
          finishPosition: numericProfile(legacyRows, "pos"),
        }),
        joins: Object.freeze({
          raceIdJoinCount,
          raceCoreEntrantJoinCount,
          cbComparableCount,
          cbEqualCount,
          coreInfoJoinCount: ownedCoreIds.filter((hid) => infoIds.has(hid))
            .length,
          coreRacingStatsJoinCount: ownedCoreIds.filter((hid) =>
            statsIds.has(hid),
          ).length,
          statsWithSampleRaceIdentityCount,
        }),
        budget: budget.snapshot(),
      });

      expect(legacyCoreSuccessCount).toBeGreaterThan(0);
      expect(legacyRows.length).toBeGreaterThan(0);
      expect(numericProfile(legacyRows, "cb").positiveCount).toBeGreaterThan(0);
      expect(numericProfile(legacyRows, "time").positiveCount).toBeGreaterThan(
        0,
      );
      expect(numericProfile(legacyRows, "pos").positiveCount).toBeGreaterThan(
        0,
      );
      expect(raceIdJoinCount).toBeGreaterThan(0);
      expect(raceCoreEntrantJoinCount).toBeGreaterThan(0);
      expect(infoIds.size).toBe(ownedCoreIds.length);
      expect(statsIds.size).toBe(ownedCoreIds.length);

      const serialized = JSON.stringify(report);
      for (const apiKey of apiKeys) expect(serialized).not.toContain(apiKey);
      expect(serialized).not.toContain(vault);
      for (const hid of ownedCoreIds) {
        expect(Object.values(report.joins)).not.toContain(String(hid));
      }
      console.log(`DNA_API_PERFORMANCE_FIELD_SCAN=${serialized}`);
    },
    14 * 60 * 1_000,
  );
});
