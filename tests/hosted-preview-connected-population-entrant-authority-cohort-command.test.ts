import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
  DnaPopulationEntrantAuthorityCohortCommandError,
} from "@/lib/dna-population-entrant-authority-cohort-command";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";

type DiagnosticStage =
  | "environment"
  | "runtime-composition"
  | "preflight-and-prepare"
  | "commit"
  | "receipt-validation";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error("required environment is unavailable");
  }
  return value;
}

function positiveCount(name: string): number {
  const value = requiredEnvironment(name);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("commissioning count authority is unavailable");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("commissioning count authority is unavailable");
  }
  return parsed;
}

function sha256(name: string): string {
  const value = requiredEnvironment(name);
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("commissioning hash authority is unavailable");
  }
  return value;
}

function exactTimestamp(name: string): string {
  const value = requiredEnvironment(name);
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() > Date.now()
  ) {
    throw new Error("commissioning timestamp is unavailable");
  }
  return value;
}

function connectedFailureId(error: unknown): string {
  if (error instanceof DnaPopulationEntrantAuthorityCohortCommandError) {
    return error.diagnostic;
  }
  return "unexpected_failure";
}

describeConnected(
  "hosted Preview population entrant authority single-cohort commissioning",
  () => {
    it(
      "preflights, prepares and commits exactly one bounded private Preview cohort",
      async () => {
        let stage: DiagnosticStage = "environment";
        try {
          const exactCodeHeadSha =
            requiredEnvironment("GITHUB_SHA").toLowerCase();
          const expectedMainSha = requiredEnvironment(
            "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA",
          ).toLowerCase();
          if (
            !COMMIT_PATTERN.test(exactCodeHeadSha) ||
            expectedMainSha !== exactCodeHeadSha
          ) {
            throw new Error("exact main commit is unavailable");
          }
          const cohortObservedAt = exactTimestamp(
            "DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_OBSERVED_AT",
          );
          const expectedUnresolvedRaceCount = positiveCount(
            "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
          );
          const expectedUnresolvedRaceSetSha256 = sha256(
            "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
          );

          stage = "runtime-composition";
          const runtime =
            dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
              environment: Object.freeze({
                authorizedOwnerId: requiredEnvironment(
                  "AUTHORIZED_CLERK_USER_ID",
                ),
                exactCodeHeadSha,
                databaseUrl: requiredEnvironment("DATABASE_URL"),
                databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
                runtimeRole: RUNTIME_ROLE,
                dnaOpenLabApiKey: requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
                cloudflareAccountId: requiredEnvironment(
                  "CLOUDFLARE_ACCOUNT_ID",
                ),
                cloudflareApiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
                cloudflareAnalyticsApiToken: requiredEnvironment(
                  "CLOUDFLARE_ANALYTICS_API_TOKEN",
                ),
                r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
                r2StorageClass: requiredEnvironment("DNA_R2_STORAGE_CLASS"),
                r2AccessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
                r2SecretAccessKey: requiredEnvironment(
                  "DNA_R2_SECRET_ACCESS_KEY",
                ),
                neonApiKey: requiredEnvironment("NEON_API_KEY"),
                neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
              }),
            });
          if (runtime.status !== "ready") {
            throw new Error("entrant commissioning runtime is unavailable");
          }
          expect(runtime.exactCodeHeadSha).toBe(exactCodeHeadSha);

          stage = "preflight-and-prepare";
          const session = await runtime.execute({
            commandVersion:
              DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
            intent: DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
            allowPersistentWrite: true,
            exactCodeHeadSha,
            cohortObservedAt,
            expectedUnresolvedRaceCount,
            expectedUnresolvedRaceSetSha256,
          });
          expect(session.prepared).toMatchObject({
            status: "prepared_uncommitted",
            exactCodeHeadSha,
            persistentWriteArmed: true,
            previewOnly: true,
            entrantChunkPersistentWritePerformed: false,
            providerWritePerformed: false,
            paidUsageAllowed: false,
            preserveLastGood: true,
          });
          expect(
            session.prepared.resolvedRaceCount +
              session.prepared.quarantinedRaceCount,
          ).toBe(session.prepared.selectedRaceCount);

          stage = "commit";
          const receipt = await session.commit();

          stage = "receipt-validation";
          expect(receipt).toMatchObject({
            status: "committed",
            exactCodeHeadSha,
            chunkOrdinal: session.prepared.chunkOrdinal,
            rowCount: session.prepared.selectedRaceCount,
            resolvedRaceCount: session.prepared.resolvedRaceCount,
            quarantinedRaceCount: session.prepared.quarantinedRaceCount,
            checkpointRaceCountBefore:
              session.prepared.checkpointRaceCountBeforePreparation,
            persistentWriteArmed: true,
            previewOnly: true,
            providerRequestPerformed: false,
            persistentWritePerformed: true,
            providerWritePerformed: false,
            paidUsageAllowed: false,
            preserveLastGood: true,
          });
          expect(receipt.checkpointRaceCountAfter).toBe(
            receipt.checkpointRaceCountBefore + receipt.rowCount,
          );

          const report = Object.freeze({
            status: receipt.status,
            exactCodeHeadSha: receipt.exactCodeHeadSha,
            cohortObservedAt: receipt.cohortObservedAt,
            preparationSource: session.prepared.preparationSource,
            providerRequestCount: session.prepared.providerRequestCount,
            selectedRaceCount: session.prepared.selectedRaceCount,
            resolvedRaceCount: receipt.resolvedRaceCount,
            quarantinedRaceCount: receipt.quarantinedRaceCount,
            chunkOrdinal: receipt.chunkOrdinal,
            checkpointRaceCountBefore: receipt.checkpointRaceCountBefore,
            checkpointRaceCountAfter: receipt.checkpointRaceCountAfter,
            authorityComplete: receipt.authorityComplete,
            storageStatus: receipt.storageStatus,
            preflightCapacityObservedAt:
              session.prepared.preflightCapacityObservedAt,
            commitCapacityObservedAt: receipt.capacityObservedAt,
            persistentWriteArmed: receipt.persistentWriteArmed,
            previewOnly: receipt.previewOnly,
            paidUsageAllowed: receipt.paidUsageAllowed,
            preserveLastGood: receipt.preserveLastGood,
          });
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_RESULT=" +
              JSON.stringify(report),
          );
        } catch (error) {
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_FAILURE=" +
              JSON.stringify({
                stage,
                diagnostic: connectedFailureId(error),
              }),
          );
          throw new Error(
            "DNA population entrant authority private Preview cohort failed",
          );
        }
      },
      30 * 60_000,
    );
  },
);
