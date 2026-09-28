import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDnaPopulationEntrantAuthorityAutonomousRunner,
  DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
  DnaPopulationEntrantAuthorityAutonomousRunnerError,
  type DnaPopulationEntrantAuthorityAutonomousBoundary,
} from "@/lib/dna-population-entrant-authority-autonomous-runner";
import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
// The first accelerated connected session proved that eight cohorts can cross
// the 145-minute test deadline before the sanitized handoff is written. Bound
// each session to four committed cohorts so recovery, handoff validation and
// the next non-overlapping dispatch retain deterministic runtime headroom.
const SESSION_COHORT_LIMIT = 4;
const RESULT_FILENAME = "dna-entrant-autonomous-session.json";
const FAILURE_FILENAME = "dna-entrant-autonomous-failure.json";

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

function acceptedBoundary(
  exactCodeHeadSha: string,
): DnaPopulationEntrantAuthorityAutonomousBoundary {
  const status = required(
    "DNA_POPULATION_ENTRANT_AUTHORITY_ACCEPTED_BOUNDARY_STATUS",
  );
  if (status !== "ready_for_continuation" && status !== "authority_complete") {
    throw new Error("boundary status unavailable");
  }
  return Object.freeze({
    version: 1 as const,
    status,
    exactCodeHeadSha,
    unresolvedRaceCount: positiveCount(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
    ),
    unresolvedRaceSetSha256: sha256(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
    ),
    recoveredChunkCount: positiveCount(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_CHUNK_COUNT",
    ),
    recoveredRaceCount: positiveCount(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_RACE_COUNT",
    ),
    nextChunkOrdinal: positiveCount(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_NEXT_CHUNK_ORDINAL",
    ),
    checkpointUpdatedAt: timestamp(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_CHECKPOINT_UPDATED_AT",
    ),
    capacityObservedAt: timestamp(
      "DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_CAPACITY_OBSERVED_AT",
    ),
    durableBoundarySha256: sha256(
      "DNA_POPULATION_ENTRANT_AUTHORITY_DURABLE_BOUNDARY_SHA256",
    ),
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function diagnostic(error: unknown): string {
  return error instanceof DnaPopulationEntrantAuthorityAutonomousRunnerError
    ? error.diagnostic
    : "unexpected_failure";
}

describeConnected("hosted Preview population entrant autonomous runner", () => {
  it(
    "advances one bounded session and emits only a sanitized durable handoff",
    async () => {
      let stage = "environment";
      try {
        if (
          required("DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_WRITE_ARM") !==
          "true"
        ) {
          throw new Error("autonomous runner is not armed");
        }
        const exactCodeHeadSha = required("GITHUB_SHA").toLowerCase();
        if (
          !COMMIT_PATTERN.test(exactCodeHeadSha) ||
          required(
            "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA",
          ).toLowerCase() !== exactCodeHeadSha
        ) {
          throw new Error("exact main unavailable");
        }
        const repository = required("GITHUB_REPOSITORY");
        if (!REPOSITORY_PATTERN.test(repository)) {
          throw new Error("repository unavailable");
        }
        const githubToken = required("GITHUB_TOKEN");

        stage = "runtime-composition";
        const runtime =
          dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
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
        if (runtime.status !== "ready") {
          throw new Error("runtime unavailable");
        }

        const assertCurrentExactHead = async (expectedHead: string) => {
          const response = await fetch(
            `https://api.github.com/repos/${repository}/commits/main`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${githubToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
              },
              cache: "no-store",
            },
          );
          if (!response.ok) throw new Error("current main unavailable");
          const current = (await response.json()) as { sha?: unknown };
          if (current.sha !== expectedHead) {
            throw new Error("current main changed");
          }
        };

        stage = "bounded-session";
        const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
          runtimeCodeHeadSha: exactCodeHeadSha,
          boundaryInspector: {
            inspect: runtime.inspectAutonomousBoundary,
          },
          continuationCommand: {
            executeContinuation: runtime.executeContinuation,
          },
          cohortGuard: { assertCurrentExactHead },
        });
        const receipt = await runner.runBoundedSession(
          Object.freeze({
            runnerVersion:
              DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
            intent: DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT,
            allowPersistentWrite: true as const,
            exactCodeHeadSha,
            acceptedBoundary: acceptedBoundary(exactCodeHeadSha),
          }),
          SESSION_COHORT_LIMIT,
        );

        stage = "sanitized-handoff";
        const resultPath = join(required("RUNNER_TEMP"), RESULT_FILENAME);
        await writeFile(resultPath, JSON.stringify(receipt), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        expect(receipt.boundary.exactCodeHeadSha).toBe(exactCodeHeadSha);
        expect(receipt.boundary.providerRequestPerformed).toBe(false);
        expect(receipt.boundary.persistentWritePerformed).toBe(false);
        expect(receipt.previewOnly).toBe(true);
        expect(receipt.providerWritePerformed).toBe(false);
        expect(receipt.paidUsageAllowed).toBe(false);
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RESULT=" +
            JSON.stringify({
              status: receipt.status,
              completedCohortCount: receipt.completedCohortCount,
              recoveredChunkCount: receipt.boundary.recoveredChunkCount,
              recoveredRaceCount: receipt.boundary.recoveredRaceCount,
              unresolvedRaceCount: receipt.boundary.unresolvedRaceCount,
              previewOnly: receipt.previewOnly,
              paidUsageAllowed: receipt.paidUsageAllowed,
            }),
        );
      } catch (error) {
        const failure = Object.freeze({ stage, diagnostic: diagnostic(error) });
        try {
          await writeFile(
            join(required("RUNNER_TEMP"), FAILURE_FILENAME),
            JSON.stringify(failure),
            {
              encoding: "utf8",
              flag: "wx",
              mode: 0o600,
            },
          );
        } catch {
          // Preserve the original fail-closed diagnostic path.
        }
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_FAILURE=" +
            JSON.stringify(failure),
        );
        throw new Error("DNA entrant autonomous session failed");
      }
    },
    145 * 60_000,
  );
});
