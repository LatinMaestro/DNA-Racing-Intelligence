import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
  DnaPopulationEntrantAuthorityContinuationCommandError,
} from "@/lib/dna-population-entrant-authority-continuation-command";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function required(name: string): string {
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
  const value = required(name);
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("count unavailable");
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error("count unavailable");
  return count;
}

function sha256(name: string): string {
  const value = required(name);
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("hash unavailable");
  return value;
}

function timestamp(name: string): string {
  const value = required(name);
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() > Date.now()
  ) {
    throw new Error("timestamp unavailable");
  }
  return value;
}

function diagnostic(error: unknown): string {
  return error instanceof DnaPopulationEntrantAuthorityContinuationCommandError
    ? error.diagnostic
    : "unexpected_failure";
}

describeConnected(
  "hosted Preview population entrant authority single-cohort continuation",
  () => {
    it(
      "revalidates the exact durable boundary and commits one bounded cohort",
      async () => {
        let stage = "environment";
        try {
          const exactCodeHeadSha = required("GITHUB_SHA").toLowerCase();
          if (
            !COMMIT_PATTERN.test(exactCodeHeadSha) ||
            required(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA",
            ).toLowerCase() !== exactCodeHeadSha
          ) {
            throw new Error("exact main unavailable");
          }

          stage = "runtime-composition";
          const runtime =
            dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
              acceptedUnresolvedAuthority: Object.freeze({
                unresolvedRaceCount: positiveCount(
                  "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
                ),
                unresolvedRaceSetSha256: sha256(
                  "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
                ),
              }),
              environment: Object.freeze({
                authorizedOwnerId: required("AUTHORIZED_CLERK_USER_ID"),
                exactCodeHeadSha,
                databaseUrl: required("DATABASE_URL"),
                databaseOwnerId: required("DNA_DATABASE_OWNER_ID"),
                runtimeRole: "dna_app_runtime",
                dnaOpenLabApiKeys: [
                  required("DNA_OPEN_LAB_API_KEY_1"),
                  required("DNA_OPEN_LAB_API_KEY_2"),
                  required("DNA_OPEN_LAB_API_KEY_3"),
                ],
                cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
                cloudflareApiToken: required("CLOUDFLARE_API_TOKEN"),
                cloudflareAnalyticsApiToken: required(
                  "CLOUDFLARE_ANALYTICS_API_TOKEN",
                ),
                r2BucketName: required("DNA_R2_BUCKET_NAME"),
                r2StorageClass: required("DNA_R2_STORAGE_CLASS"),
                r2AccessKeyId: required("DNA_R2_ACCESS_KEY_ID"),
                r2SecretAccessKey: required("DNA_R2_SECRET_ACCESS_KEY"),
                neonApiKey: required("NEON_API_KEY"),
                neonProjectId: required("NEON_PROJECT_ID"),
              }),
            });
          if (runtime.status !== "ready")
            throw new Error("runtime unavailable");

          stage = "preflight-and-prepare";
          const session = await runtime.executeContinuation({
            commandVersion:
              DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
            intent:
              DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
            allowPersistentWrite: true,
            exactCodeHeadSha,
            cohortObservedAt: timestamp(
              "DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_OBSERVED_AT",
            ),
            expectedUnresolvedRaceCount: positiveCount(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
            ),
            expectedUnresolvedRaceSetSha256: sha256(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
            ),
            expectedRecoveredChunkCount: positiveCount(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_CHUNK_COUNT",
            ),
            expectedRecoveredRaceCount: positiveCount(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_RACE_COUNT",
            ),
            expectedNextChunkOrdinal: positiveCount(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_NEXT_CHUNK_ORDINAL",
            ),
            expectedCheckpointUpdatedAt: timestamp(
              "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_CHECKPOINT_UPDATED_AT",
            ),
            readinessCapacityObservedAt: timestamp(
              "DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_CAPACITY_OBSERVED_AT",
            ),
            durableBoundarySha256: sha256(
              "DNA_POPULATION_ENTRANT_AUTHORITY_DURABLE_BOUNDARY_SHA256",
            ),
          });
          expect(session.prepared).toMatchObject({
            status: "prepared_uncommitted",
            exactCodeHeadSha,
            persistentWriteArmed: true,
            previewOnly: true,
            entrantChunkPersistentWritePerformed: false,
            paidUsageAllowed: false,
          });

          stage = "commit";
          const receipt = await session.commit();
          expect(receipt).toMatchObject({
            status: "committed",
            exactCodeHeadSha,
            checkpointRaceCountBefore: session.prepared.recoveredRaceCount,
            persistentWriteArmed: true,
            previewOnly: true,
            persistentWritePerformed: true,
            paidUsageAllowed: false,
          });

          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_RESULT=" +
              JSON.stringify({
                status: receipt.status,
                exactCodeHeadSha: receipt.exactCodeHeadSha,
                preparationSource: session.prepared.preparationSource,
                providerRequestCount: session.prepared.providerRequestCount,
                chunkOrdinal: receipt.chunkOrdinal,
                checkpointRaceCountBefore: receipt.checkpointRaceCountBefore,
                checkpointRaceCountAfter: receipt.checkpointRaceCountAfter,
                authorityComplete: receipt.authorityComplete,
                persistentWriteArmed: receipt.persistentWriteArmed,
                previewOnly: receipt.previewOnly,
                paidUsageAllowed: receipt.paidUsageAllowed,
              }),
          );
        } catch (error) {
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_FAILURE=" +
              JSON.stringify({ stage, diagnostic: diagnostic(error) }),
          );
          throw new Error("DNA entrant continuation command failed");
        }
      },
      30 * 60_000,
    );
  },
);
