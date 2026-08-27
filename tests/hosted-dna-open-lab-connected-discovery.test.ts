import { describe, expect, it } from "vitest";

import {
  buildDnaOpenLabPairCandidates,
  hasProvenDnaOpenLabIndependentRateBuckets,
  planDnaOpenLabHistoryWindows,
  safeDnaOpenLabRateLimitEvidence,
  summarizeDnaOpenLabHistoryWindow,
  summarizeDnaOpenLabShape,
  type DnaOpenLabConnectedProbeEvidence,
  type DnaOpenLabHistoryWindowEvidence,
  type DnaOpenLabPairCandidate,
} from "../lib/dna-open-lab-discovery-evidence";
import { createDnaOpenLabClientPool } from "../lib/dna-open-lab-client-pool";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "../lib/dna-open-lab-request-budget";
import {
  createDnaOpenLabV1Client,
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
  type DnaOpenLabScope,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
  type DnaVaultCore,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1SpliceDocumentPostClient } from "../lib/dna-open-lab-v1-splice-doc-post-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const SAFE_LANE_IDS = ["key-1", "key-2", "key-3"] as const;
type SafeLaneId = (typeof SAFE_LANE_IDS)[number];

type SafeHistoryWindowEvidence =
  | Readonly<
      DnaOpenLabHistoryWindowEvidence & {
        outcome: "success";
      }
    >
  | Readonly<{
      windowId: DnaOpenLabHistoryWindowEvidence["windowId"];
      outcome: "api_error";
    }>;

const connected = process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY === "1";
const describeConnected = connected ? describe : describe.skip;

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

function optionalEnvironment(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  if (value.trim() !== value || value.length > 4_096) {
    throw new Error(`${name} is padded or unexpectedly large`);
  }
  return value;
}

function safeLaneId(value: string): SafeLaneId {
  if (value === "key-1" || value === "key-2" || value === "key-3") {
    return value;
  }
  throw new Error(
    "DNA Open Lab connected discovery selected an unsafe lane id",
  );
}

function boundedShapeValue(value: unknown): unknown {
  return Array.isArray(value) ? value.slice(0, 20) : value;
}

function stringLeaves(value: unknown): readonly string[] {
  const leaves: string[] = [];
  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      leaves.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const entry of Object.values(current)) visit(entry);
    }
  };
  visit(value);
  return Object.freeze(leaves);
}

function notProbed(
  endpoint: string,
  scope: DnaOpenLabScope,
  laneId: SafeLaneId,
): DnaOpenLabConnectedProbeEvidence {
  return Object.freeze({
    endpoint,
    scope,
    laneId,
    outcome: "not_probed",
    httpStatus: null,
    errorKind: null,
    rateLimit: null,
    shape: null,
  });
}

function uniquePositiveCoreIds(values: readonly number[]): readonly number[] {
  return Object.freeze(
    [...new Set(values)].filter(
      (value) => Number.isSafeInteger(value) && value > 0,
    ),
  );
}

describeConnected("hosted DNA Open Lab connected discovery", () => {
  it(
    "probes all safe read-only endpoint families and logs only redacted structural evidence",
    async () => {
      const apiKeys = [
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
      ] as const;
      for (const key of apiKeys) {
        if (!API_KEY_PATTERN.test(key)) {
          throw new Error(
            "DNA Open Lab connected discovery key shape is invalid",
          );
        }
      }
      if (new Set(apiKeys).size !== apiKeys.length) {
        throw new Error(
          "DNA Open Lab connected discovery requires three distinct keys",
        );
      }
      const vault = requiredEnvironment("DNA_OPEN_LAB_VAULT");
      if (vault.length > 512 || /[\u0000-\u001f\u007f]/u.test(vault)) {
        throw new Error("DNA_OPEN_LAB_VAULT is invalid");
      }
      const spliceRequestId = optionalEnvironment(
        "DNA_OPEN_LAB_SPLICE_REQUEST_ID",
      );

      const clients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1Client({ apiKey }),
      );
      const telemetryClients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1TelemetryClient({ apiKey }),
      );
      const splicePostClients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1SpliceDocumentPostClient({ apiKey }),
      );
      const globalBudget = createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      });
      const pool = createDnaOpenLabClientPool({
        lanes: clients.map((client, index) => ({
          id: SAFE_LANE_IDS[index]!,
          client,
          scopes: ["vault", "races", "cores", "tokens", "splice"] as const,
        })),
        aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        allowIndependentRateBuckets: false,
      });
      const evidence: DnaOpenLabConnectedProbeEvidence[] = [];

      const directProbe = async <T>(input: {
        endpoint: string;
        scope: DnaOpenLabScope;
        laneId: SafeLaneId;
        request: () => Promise<DnaOpenLabResponse<T>>;
        required?: boolean;
      }): Promise<T | null> => {
        try {
          const response = await globalBudget.execute(input.request);
          evidence.push(
            Object.freeze({
              endpoint: input.endpoint,
              scope: input.scope,
              laneId: input.laneId,
              outcome: "success",
              httpStatus: response.httpStatus,
              errorKind: null,
              rateLimit: safeDnaOpenLabRateLimitEvidence(response.rateLimit),
              shape: summarizeDnaOpenLabShape(
                boundedShapeValue(response.result),
              ),
            }),
          );
          return response.result;
        } catch (error) {
          if (error instanceof DnaOpenLabApiError) {
            evidence.push(
              Object.freeze({
                endpoint: input.endpoint,
                scope: input.scope,
                laneId: input.laneId,
                outcome: "api_error",
                httpStatus: error.httpStatus,
                errorKind: error.kind,
                rateLimit:
                  error.rateLimit === null
                    ? null
                    : safeDnaOpenLabRateLimitEvidence(error.rateLimit),
                shape: null,
              }),
            );
            if (input.required === true) throw error;
            return null;
          }
          throw error;
        }
      };

      const poolProbe = async <T>(input: {
        endpoint: string;
        scope: DnaOpenLabScope;
        request: (client: DnaOpenLabClient) => Promise<DnaOpenLabResponse<T>>;
        required?: boolean;
      }): Promise<T | null> => {
        let selectedLane: SafeLaneId | null = null;
        try {
          const response = await globalBudget.execute(() =>
            pool.execute({
              scope: input.scope,
              request: (client, laneId) => {
                selectedLane = safeLaneId(laneId);
                return input.request(client);
              },
            }),
          );
          if (selectedLane === null) {
            throw new Error(
              "DNA Open Lab connected discovery did not select a lane",
            );
          }
          evidence.push(
            Object.freeze({
              endpoint: input.endpoint,
              scope: input.scope,
              laneId: selectedLane,
              outcome: "success",
              httpStatus: response.httpStatus,
              errorKind: null,
              rateLimit: safeDnaOpenLabRateLimitEvidence(response.rateLimit),
              shape: summarizeDnaOpenLabShape(
                boundedShapeValue(response.result),
              ),
            }),
          );
          return response.result;
        } catch (error) {
          if (error instanceof DnaOpenLabApiError && selectedLane !== null) {
            evidence.push(
              Object.freeze({
                endpoint: input.endpoint,
                scope: input.scope,
                laneId: selectedLane,
                outcome: "api_error",
                httpStatus: error.httpStatus,
                errorKind: error.kind,
                rateLimit:
                  error.rateLimit === null
                    ? null
                    : safeDnaOpenLabRateLimitEvidence(error.rateLimit),
                shape: null,
              }),
            );
            if (input.required === true) throw error;
            return null;
          }
          throw error;
        }
      };

      for (const [index, client] of clients.entries()) {
        await directProbe({
          endpoint: "test_auth.initial",
          scope: "vault",
          laneId: SAFE_LANE_IDS[index]!,
          request: () => client.testAuth(),
          required: true,
        });
        await directProbe({
          endpoint: "test_auth.repeat",
          scope: "vault",
          laneId: SAFE_LANE_IDS[index]!,
          request: () => client.testAuth(),
          required: true,
        });
      }

      const vaultInfo = await poolProbe({
        endpoint: "vault.info",
        scope: "vault",
        request: (client) => client.vaultInfo(vault),
        required: true,
      });
      await poolProbe({
        endpoint: "vault.info_bulk",
        scope: "vault",
        request: (client) => client.vaultInfoBulk([vault]),
        required: true,
      });
      if (
        vaultInfo !== null &&
        typeof vaultInfo.name === "string" &&
        vaultInfo.name.trim().length >= 2
      ) {
        await poolProbe({
          endpoint: "vault.search",
          scope: "vault",
          request: (client) =>
            client.vaultSearch({ query: vaultInfo.name.trim(), limit: 5 }),
        });
      } else {
        evidence.push(notProbed("vault.search", "vault", "key-1"));
      }

      const vaultCoreIds = await poolProbe({
        endpoint: "vault.cores",
        scope: "vault",
        request: (client) => client.vaultCores(vault),
        required: true,
      });
      const vaultCoresFull = await poolProbe({
        endpoint: "vault.cores_full",
        scope: "vault",
        request: (client) => client.vaultCoresFull(vault),
        required: true,
      });
      await poolProbe({
        endpoint: "vault.tier_badge",
        scope: "vault",
        request: (client) => client.vaultTierBadge(vault),
        required: true,
      });
      const recentRaces = await poolProbe({
        endpoint: "vault.recent_races",
        scope: "vault",
        request: (client) => client.vaultRecentRaces(vault),
        required: true,
      });

      const sampleCoreIds = (vaultCoreIds ?? [])
        .filter((hid) => Number.isSafeInteger(hid) && hid > 0)
        .slice(0, 5);
      if (sampleCoreIds.length < 1) {
        throw new Error(
          "DNA Open Lab connected discovery found no owned Core ids",
        );
      }
      const sampleCoreId = sampleCoreIds[0]!;

      await poolProbe({
        endpoint: "cores.info",
        scope: "cores",
        request: (client) => client.coreInfo(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.info_bulk",
        scope: "cores",
        request: (client) => client.coreInfoBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.racing_stats",
        scope: "cores",
        request: (client) => client.coreRacingStats(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.racing_stats_bulk",
        scope: "cores",
        request: (client) => client.coreRacingStatsBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.power",
        scope: "cores",
        request: (client) => client.corePower(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.power_bulk",
        scope: "cores",
        request: (client) => client.corePowerBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.listing_price",
        scope: "cores",
        request: (client) => client.coreListingPrice(sampleCoreId),
      });
      await poolProbe({
        endpoint: "cores.listing_price_bulk",
        scope: "cores",
        request: (client) => client.coreListingPriceBulk(sampleCoreIds),
      });
      await poolProbe({
        endpoint: "cores.attached_assets",
        scope: "cores",
        request: (client) => client.coreAttachedAssets(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.attached_assets_bulk",
        scope: "cores",
        request: (client) => client.coreAttachedAssetsBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.owner",
        scope: "cores",
        request: (client) => client.coreOwner(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.owner_bulk",
        scope: "cores",
        request: (client) => client.coreOwnerBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.stamina",
        scope: "cores",
        request: (client) => client.coreStamina(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.stamina_bulk",
        scope: "cores",
        request: (client) => client.coreStaminaBulk(sampleCoreIds),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.splicing_info",
        scope: "cores",
        request: (client) => client.coreSplicingInfo(sampleCoreId),
        required: true,
      });
      await poolProbe({
        endpoint: "cores.splicing_info_bulk",
        scope: "cores",
        request: (client) => client.coreSplicingInfoBulk(sampleCoreIds),
        required: true,
      });

      await directProbe({
        endpoint: "cores.telemetry",
        scope: "cores",
        laneId: "key-1",
        request: () => telemetryClients[0]!.coreTelemetry(sampleCoreId),
      });
      await directProbe({
        endpoint: "cores.telemetry_bulk",
        scope: "cores",
        laneId: "key-2",
        request: () => telemetryClients[1]!.coreTelemetryBulk(sampleCoreIds),
      });
      const activeRaces = await poolProbe({
        endpoint: "races.active",
        scope: "races",
        request: (client) => client.racesActive(),
        required: true,
      });
      const finishedRaces = await poolProbe({
        endpoint: "races.finished",
        scope: "races",
        request: (client) => client.racesFinished({ limit: 20 }),
        required: true,
      });
      const historyWindows: SafeHistoryWindowEvidence[] = [];
      for (const plan of planDnaOpenLabHistoryWindows(new Date())) {
        const endpoint = `races.finished.history.${plan.windowId}`;
        const windowRaces = await poolProbe({
          endpoint,
          scope: "races",
          request: (client) =>
            client.racesFinished({
              startTime: plan.startTime,
              endTime: plan.endTime,
              limit: plan.limit,
            }),
        });
        const observation = evidence[evidence.length - 1];
        if (observation?.endpoint !== endpoint) {
          throw new Error(
            "DNA Open Lab history discovery evidence ordering drifted",
          );
        }
        if (observation.outcome === "api_error") {
          historyWindows.push(
            Object.freeze({ windowId: plan.windowId, outcome: "api_error" }),
          );
          continue;
        }
        if (observation.outcome !== "success" || windowRaces === null) {
          throw new Error(
            "DNA Open Lab history discovery returned an invalid success contract",
          );
        }
        historyWindows.push(
          Object.freeze({
            outcome: "success",
            ...summarizeDnaOpenLabHistoryWindow({
              plan,
              races: windowRaces,
            }),
          }),
        );
      }

      const candidateRaceIds: DnaRaceIdentifier[] = [];
      const appendRaceIds = (races: readonly DnaRaceDocument[] | null) => {
        for (const race of races ?? []) {
          if (candidateRaceIds.length >= 5) break;
          const key = String(race.rid);
          if (!candidateRaceIds.some((rid) => String(rid) === key)) {
            candidateRaceIds.push(race.rid);
          }
        }
      };
      appendRaceIds(recentRaces);
      appendRaceIds(finishedRaces);
      appendRaceIds(activeRaces as readonly DnaRaceDocument[] | null);

      if (candidateRaceIds.length > 0) {
        await poolProbe({
          endpoint: "races.docs",
          scope: "races",
          request: (client) => client.raceDocs(candidateRaceIds),
          required: true,
        });
        await poolProbe({
          endpoint: "races.fills",
          scope: "races",
          request: (client) => client.raceFills(candidateRaceIds),
        });
      } else {
        evidence.push(notProbed("races.docs", "races", "key-1"));
        evidence.push(notProbed("races.fills", "races", "key-2"));
      }

      await poolProbe({
        endpoint: "tokens.prices",
        scope: "tokens",
        request: (client) => client.tokenPrices(),
        required: true,
      });

      const arena = await poolProbe({
        endpoint: "splice.arena",
        scope: "splice",
        request: (client) =>
          client.spliceArena({
            filter: { rvmode: "bike", use_powerstats: true },
          }),
        required: true,
      });

      const benchmarkCandidateIds = uniquePositiveCoreIds([
        ...sampleCoreIds,
        ...(arena?.cores ?? []).map((core) => core.hid),
      ]).slice(0, 10);
      let telemetryBenchmarkSucceeded = false;
      let telemetryBenchmarkSemanticRejectionCount = 0;
      let telemetryBenchmarkAttemptCount = 0;
      for (const [index, candidateCoreId] of benchmarkCandidateIds.entries()) {
        const laneIndex = index % telemetryClients.length;
        const endpoint = `cores.telemetry_benchmark.attempt_${index + 1}`;
        telemetryBenchmarkAttemptCount += 1;
        await directProbe({
          endpoint,
          scope: "cores",
          laneId: SAFE_LANE_IDS[laneIndex]!,
          request: () =>
            telemetryClients[laneIndex]!.coreTelemetryBenchmark(
              candidateCoreId,
            ),
        });
        const observation = evidence[evidence.length - 1];
        if (observation?.endpoint !== endpoint) {
          throw new Error(
            "DNA Open Lab telemetry benchmark evidence ordering drifted",
          );
        }
        if (observation.outcome === "success") {
          telemetryBenchmarkSucceeded = true;
          break;
        }
        if (
          observation.outcome === "api_error" &&
          observation.errorKind === "api_error" &&
          observation.httpStatus === 200
        ) {
          telemetryBenchmarkSemanticRejectionCount += 1;
        }
      }
      const telemetryBenchmark = Object.freeze({
        attemptCount: telemetryBenchmarkAttemptCount,
        success: telemetryBenchmarkSucceeded,
        classification: telemetryBenchmarkSucceeded
          ? ("compatible_sample_found" as const)
          : telemetryBenchmarkAttemptCount > 0 &&
              telemetryBenchmarkSemanticRejectionCount ===
                telemetryBenchmarkAttemptCount
            ? ("bounded_candidates_semantically_rejected" as const)
            : ("inconclusive" as const),
      });

      const ownedCores: readonly DnaVaultCore[] = vaultCoresFull ?? [];
      const arenaCores = arena?.cores ?? [];
      const pairCandidates = buildDnaOpenLabPairCandidates({
        owned: ownedCores,
        arena: arenaCores,
        maximum: 12,
      });
      let validatedPair: DnaOpenLabPairCandidate | null = null;
      let pairValidationSemanticRejectionCount = 0;
      let pairValidationAttemptCount = 0;
      for (const [index, candidate] of pairCandidates.entries()) {
        const endpoint = `splice.pair_validate.attempt_${index + 1}`;
        pairValidationAttemptCount += 1;
        const validation = await poolProbe({
          endpoint,
          scope: "splice",
          request: (client) => client.splicePairValidate(candidate),
        });
        const observation = evidence[evidence.length - 1];
        if (observation?.endpoint !== endpoint) {
          throw new Error(
            "DNA Open Lab pair-validation evidence ordering drifted",
          );
        }
        if (observation.outcome === "api_error") {
          if (
            observation.errorKind === "api_error" &&
            observation.httpStatus === 200
          ) {
            pairValidationSemanticRejectionCount += 1;
          }
          continue;
        }
        if (observation.outcome === "success" && validation?.valid === true) {
          validatedPair = candidate;
          break;
        }
      }

      let validatedPairInfoSucceeded = false;
      if (validatedPair !== null) {
        await poolProbe({
          endpoint: "splice.pair_info.validated_pair",
          scope: "splice",
          request: (client) => client.splicePairInfo(validatedPair!),
        });
        validatedPairInfoSucceeded =
          evidence[evidence.length - 1]?.outcome === "success";
      }
      const pairValidation = Object.freeze({
        attemptCount: pairValidationAttemptCount,
        validPairFound: validatedPair !== null,
        validatedPairInfoSucceeded,
        classification:
          validatedPair !== null
            ? ("valid_pair_found" as const)
            : pairValidationAttemptCount === 0
              ? ("no_candidate_pair" as const)
              : pairValidationSemanticRejectionCount ===
                  pairValidationAttemptCount
                ? ("bounded_candidates_semantically_rejected" as const)
                : ("bounded_candidates_not_valid" as const),
      });

      if (spliceRequestId !== null) {
        await poolProbe({
          endpoint: "splice.doc.get",
          scope: "splice",
          request: (client) => client.spliceDocument(spliceRequestId),
        });
        await directProbe({
          endpoint: "splice.doc.post",
          scope: "splice",
          laneId: "key-3",
          request: () =>
            splicePostClients[2]!.spliceDocumentPost(spliceRequestId),
        });
      } else {
        evidence.push(notProbed("splice.doc.get", "splice", "key-1"));
        evidence.push(notProbed("splice.doc.post", "splice", "key-3"));
      }

      const independentRateBucketsProven =
        hasProvenDnaOpenLabIndependentRateBuckets(evidence);
      expect(independentRateBucketsProven).toBe(true);

      const safeOutput = Object.freeze({
        version: 2,
        independentRateBucketsEnabled: false,
        independentRateBucketsProven,
        globalBudget: globalBudget.snapshot(),
        pool: pool.snapshot(),
        followup: Object.freeze({
          historyWindows: Object.freeze(historyWindows),
          telemetryBenchmark,
          pairValidation,
        }),
        probes: Object.freeze(evidence),
      });
      const serialized = JSON.stringify(safeOutput);
      for (const key of apiKeys) expect(serialized).not.toContain(key);
      expect(serialized).not.toContain(vault);
      const redactedStringLeaves = stringLeaves(safeOutput);
      for (const hid of sampleCoreIds) {
        // Short numeric ids can occur innocently inside bounded counters or a
        // SHA-256 fingerprint. Assert against complete retained string values
        // instead of treating such substrings as leaked Core identifiers.
        expect(redactedStringLeaves).not.toContain(String(hid));
      }
      for (const hid of uniquePositiveCoreIds([
        ...benchmarkCandidateIds,
        ...pairCandidates.flatMap((candidate) => [
          candidate.fatherCoreId,
          candidate.motherCoreId,
        ]),
      ])) {
        expect(redactedStringLeaves).not.toContain(String(hid));
      }
      expect(evidence.length).toBeGreaterThan(20);
      expect(
        evidence.filter((entry) => entry.outcome === "success").length,
      ).toBeGreaterThan(15);

      console.log(`DNA_OPEN_LAB_DISCOVERY_EVIDENCE=${serialized}`);
    },
    12 * 60 * 1_000,
  );
});
