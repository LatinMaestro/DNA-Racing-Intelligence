import { describe, expect, it } from "vitest";

import {
  safeDnaOpenLabRateLimitEvidence,
  summarizeDnaOpenLabShape,
  type DnaOpenLabConnectedProbeEvidence,
} from "../lib/dna-open-lab-discovery-evidence";
import { createDnaOpenLabClientPool } from "../lib/dna-open-lab-client-pool";
import { createDnaOpenLabRequestBudget } from "../lib/dna-open-lab-request-budget";
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
        initialRequestsPerMinute: 30,
        maximumRequestsPerMinute: 30,
      });
      const pool = createDnaOpenLabClientPool({
        lanes: clients.map((client, index) => ({
          id: SAFE_LANE_IDS[index]!,
          client,
          scopes: ["vault", "races", "cores", "tokens", "splice"] as const,
        })),
        aggregateRequestsPerMinute: 30,
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
      await directProbe({
        endpoint: "cores.telemetry_benchmark",
        scope: "cores",
        laneId: "key-3",
        request: () =>
          telemetryClients[2]!.coreTelemetryBenchmark(sampleCoreId),
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

      const ownedCores: readonly DnaVaultCore[] = vaultCoresFull ?? [];
      const arenaCores = Array.isArray(arena) ? arena : [];
      const pairCandidates = [...ownedCores, ...arenaCores];
      const father = pairCandidates.find(
        (core) => core.gender.toLowerCase() === "male",
      );
      const mother = pairCandidates.find(
        (core) => core.gender.toLowerCase() === "female",
      );
      if (
        father !== undefined &&
        mother !== undefined &&
        father.hid !== mother.hid
      ) {
        await poolProbe({
          endpoint: "splice.pair_info",
          scope: "splice",
          request: (client) =>
            client.splicePairInfo({
              fatherCoreId: father.hid,
              motherCoreId: mother.hid,
            }),
        });
        await poolProbe({
          endpoint: "splice.pair_validate",
          scope: "splice",
          request: (client) =>
            client.splicePairValidate({
              fatherCoreId: father.hid,
              motherCoreId: mother.hid,
            }),
        });
      } else {
        evidence.push(notProbed("splice.pair_info", "splice", "key-2"));
        evidence.push(notProbed("splice.pair_validate", "splice", "key-3"));
      }

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

      const safeOutput = Object.freeze({
        version: 1,
        independentRateBucketsEnabled: false,
        independentRateBucketsProven: false,
        globalBudget: globalBudget.snapshot(),
        pool: pool.snapshot(),
        probes: Object.freeze(evidence),
      });
      const serialized = JSON.stringify(safeOutput);
      for (const key of apiKeys) expect(serialized).not.toContain(key);
      expect(serialized).not.toContain(vault);
      for (const hid of sampleCoreIds)
        expect(serialized).not.toContain(String(hid));
      expect(evidence.length).toBeGreaterThan(20);
      expect(
        evidence.filter((entry) => entry.outcome === "success").length,
      ).toBeGreaterThan(15);

      console.log(`DNA_OPEN_LAB_DISCOVERY_EVIDENCE=${serialized}`);
    },
    12 * 60 * 1_000,
  );
});
