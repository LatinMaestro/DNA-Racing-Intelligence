import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import {
  createDnaOpenLabP5FirstBackfillFamilyAdapter,
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_ENDPOINT_LIMITS,
} from "@/lib/dna-open-lab-p5-first-backfill-family-adapter";
import {
  DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
  runDnaOpenLabP5FirstBackfillInventory,
  type DnaOpenLabP5TemporaryCommissioningRateAuthorization,
} from "@/lib/dna-open-lab-p5-first-backfill-inventory-runner";
import { DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES } from "@/lib/dna-open-lab-p5-capacity-measurement";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY,
  projectDnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "@/lib/dna-open-lab-p5-first-backfill-projection-policy";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "@/lib/dna-open-lab-request-budget";
import {
  createDnaOpenLabV1Client,
  type DnaOpenLabScope,
} from "@/lib/dna-open-lab-v1-client";
import { createNeonImportStorageBytesReader } from "@/lib/neon-import-capacity-reader";

const connected =
  process.env.DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT === "1";
const describeConnected = connected ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const HISTORY_START_AT = "1970-01-01T00:00:00.000Z";
const PRICE_AUTHORITY_REF = "https://developers.cloudflare.com/r2/pricing/";
const PRICE_EFFECTIVE_AT = "2026-08-07T00:00:00.000Z";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function commissioningRate(): Readonly<{
  requestsPerMinute: number;
  authorization?: DnaOpenLabP5TemporaryCommissioningRateAuthorization;
}> {
  const requestsPerMinute = requiredEnvironment(
    "DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_REQUESTS_PER_MINUTE",
  );
  const temporaryApproval = requiredEnvironment(
    "DNA_OPEN_LAB_P5_FIRST_BACKFILL_TEMPORARY_150_RPM_APPROVED",
  );
  if (requestsPerMinute === "30" && temporaryApproval === "false") {
    return Object.freeze({
      requestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    });
  }
  if (requestsPerMinute === "150" && temporaryApproval === "true") {
    return Object.freeze({
      requestsPerMinute:
        DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
      authorization: Object.freeze({
        kind: "owner_approved_one_run_non_persistent_measurement" as const,
        maximumAggregateRequestsPerMinute:
          DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
      }),
    });
  }
  throw new Error("P5 commissioning measurement rate is not authorized");
}

describeConnected("hosted P5 complete first-backfill measurement", () => {
  it("emits only aggregate exact-main evidence after a complete read-only inventory", async () => {
    try {
      const apiKeys = [
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
      ] as const;
      if (
        apiKeys.some((key) => !API_KEY_PATTERN.test(key)) ||
        new Set(apiKeys).size !== apiKeys.length
      ) {
        throw new Error("three distinct DNA Open Lab API keys are required");
      }
      const vault = requiredEnvironment("DNA_OPEN_LAB_VAULT");
      const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const exactMainCommit = requiredEnvironment("GITHUB_SHA").toLowerCase();
      const repository = requiredEnvironment("GITHUB_REPOSITORY");
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const authorityCutoffAt = new Date().toISOString();
      const rate = commissioningRate();
      const scopes = Object.freeze([
        "vault",
        "races",
        "cores",
        "tokens",
        "splice",
      ] as const satisfies readonly DnaOpenLabScope[]);
      const clients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1Client({ apiKey }),
      );
      const clientPool = createDnaOpenLabClientPool({
        lanes: clients.map((client, index) => ({
          id: `key-${index + 1}`,
          client,
          scopes,
        })),
        aggregateRequestsPerMinute: rate.requestsPerMinute,
        maximumLaneRequestsPerMinute: rate.requestsPerMinute,
        allowIndependentRateBuckets: false,
      });
      const readNeonBytes = createNeonImportStorageBytesReader({
        authorizedOwnerId,
        databaseOwnerId,
        databaseUrl,
        runtimeRole: "dna_app_runtime",
      });
      const neonBaselineBytes = await readNeonBytes({
        ownerId: authorizedOwnerId,
      });
      const adapter = createDnaOpenLabP5FirstBackfillFamilyAdapter({
        vault,
        finishedRaceHistoryStartAt: HISTORY_START_AT,
        authorityCutoffAt,
        projectUpperBounds: projectDnaOpenLabP5FirstBackfillFamilyUpperBounds,
      });
      const planAuthority = Object.freeze({
        schemaVersion: 1,
        source: "dna_open_lab_api_only_first_backfill",
        historyStartAt: HISTORY_START_AT,
        authorityCutoffAt,
        aggregateRequestCeilingPerMinute: rate.requestsPerMinute,
        temporaryCommissioningRateAuthorization:
          rate.authorization?.kind ?? null,
        independentRateBucketsEnabled: false,
        endpointLimits: DNA_OPEN_LAB_P5_FIRST_BACKFILL_ENDPOINT_LIMITS,
        projectionPolicy: DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY,
      });

      const evidence = await runDnaOpenLabP5FirstBackfillInventory({
        clientPool,
        ...(rate.authorization === undefined
          ? {}
          : { temporaryCommissioningRateAuthorization: rate.authorization }),
        measurement: {
          exactMainCommit,
          acquisitionPlanChecksum: sha256(planAuthority),
          measuredAt: authorityCutoffAt,
          authorityCutoffAt,
          repositoryRef: "refs/heads/main",
          worktreeClean: true,
          executionMode: "non_persistent_complete_inventory",
          connectedRecoverySuite: {
            status: "passed",
            exactMainCommit,
            runRef: `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
          },
          neon: {
            limitBytes: DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
            baselineBytes: neonBaselineBytes,
          },
          pricing: {
            authorityRef: PRICE_AUTHORITY_REF,
            effectiveAt: PRICE_EFFECTIVE_AT,
            bytesPerBillableGb: 1_000_000_000,
            storageMicroUsdPerGbMonth: 15_000,
            classAMicroUsdPerMillion: 4_500_000,
            classBMicroUsdPerMillion: 360_000,
            dnaApiCostMicroUsdUpperBound: 0,
            neonCostMicroUsdUpperBound: 0,
          },
        },
        measurementCompletedAt: () => new Date().toISOString(),
        measureFamily: adapter.measureFamily,
        cleanupMeasurement: async () => ({
          persistentOwnerDataWriteCount: 0,
          temporaryProviderResidueCount:
            (await readNeonBytes({ ownerId: authorizedOwnerId })) ===
            neonBaselineBytes
              ? 0
              : 1,
          rawPayloadIncludedInEvidence: false,
          secretMaterialIncludedInEvidence: false,
        }),
        emitEvidence: async (canonicalJson) => {
          await writeFile(
            join(runnerTemp, "dna-open-lab-p5-first-backfill-measurement.json"),
            `${canonicalJson}\n`,
            { encoding: "utf8", flag: "wx" },
          );
        },
        recordProgress: (stage) => {
          console.log(JSON.stringify({ firstBackfillProgressStage: stage }));
        },
        recordDiagnostic: (diagnostic) => {
          console.log(JSON.stringify({ firstBackfillDiagnostic: diagnostic }));
        },
      });

      expect(evidence).toMatchObject({
        schemaVersion: 1,
        evidenceKind: "dna_open_lab_p5_first_backfill_measurement",
        exactMainCommit,
        persistentOwnerDataWriteCount: 0,
        temporaryProviderResidueCount: 0,
        ownerApprovalRecorded: false,
        firstPersistentPrivatePreviewBackfillAllowed: false,
        productionChangesAllowed: false,
      });
    } catch {
      throw new Error("DNA Open Lab P5 first-backfill measurement failed");
    }
  }, 9_000_000);
});
