import { describe, expect, it, vi } from "vitest";

import {
  dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment,
  type DnaPopulationEntrantAuthorityConnectedEnvironment,
} from "@/lib/dna-population-entrant-authority-connected-runtime";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
  type DnaPopulationEntrantAuthorityCohortCommandInvocation,
} from "@/lib/dna-population-entrant-authority-cohort-command";
import { createDnaPopulationEntrantAuthorityReadinessHandoff } from "@/lib/dna-population-entrant-authority-readiness-handoff";

const HEAD = "a".repeat(40);
const CONNECTED_HANDOFF = createDnaPopulationEntrantAuthorityReadinessHandoff(
  Object.freeze({
    status: "ready" as const,
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount: 1,
    unresolvedRaceSetSha256: "c".repeat(64),
    capacityObservedAt: "2026-09-26T08:00:30.000Z",
    previewOnly: true as const,
    dnaEntrantHydrationPerformed: false as const,
    checkpointInitializationPerformed: false as const,
    entrantChunkPersistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  }),
);

function environment(
  overrides: Partial<DnaPopulationEntrantAuthorityConnectedEnvironment> = {},
): DnaPopulationEntrantAuthorityConnectedEnvironment {
  return Object.freeze({
    authorizedOwnerId: "user_test",
    exactCodeHeadSha: HEAD,
    databaseUrl: "postgresql://example.invalid/dna",
    databaseOwnerId: "11111111-1111-4111-8111-111111111111",
    runtimeRole: "dna_app_runtime",
    dnaOpenLabApiKey: `dna_${"x".repeat(43)}`,
    cloudflareAccountId: "b".repeat(32),
    cloudflareApiToken: "test-cloudflare-token",
    cloudflareAnalyticsApiToken: "test-analytics-token",
    r2BucketName: "private-preview",
    r2StorageClass: "Standard",
    r2AccessKeyId: "test-r2-access",
    r2SecretAccessKey: "test-r2-value",
    neonApiKey: "test-neon-key",
    neonProjectId: "project-test",
    ...overrides,
  });
}

function invocation(
  overrides: Partial<DnaPopulationEntrantAuthorityCohortCommandInvocation> = {},
): DnaPopulationEntrantAuthorityCohortCommandInvocation {
  return Object.freeze({
    commandVersion: DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: "2026-09-26T08:00:00.000Z",
    expectedUnresolvedRaceCount: 1,
    expectedUnresolvedRaceSetSha256: "c".repeat(64),
    readinessCapacityObservedAt: CONNECTED_HANDOFF.readinessCapacityObservedAt,
    readinessReceiptSha256: CONNECTED_HANDOFF.readinessReceiptSha256,
    ...overrides,
  });
}

describe("population entrant connected runtime", () => {
  it("composes a ready exact-head runtime without provider access", () => {
    const fetcher = vi.fn();
    const runtime =
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment(),
        fetch: fetcher as unknown as typeof globalThis.fetch,
        now: () => new Date("2026-09-26T08:01:00.000Z"),
      });

    expect(runtime).toMatchObject({
      status: "ready",
      exactCodeHeadSha: HEAD,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(runtime)).toBe(
      JSON.stringify({ status: "ready", exactCodeHeadSha: HEAD }),
    );
  });

  it("fails closed for missing or non-Standard configuration", () => {
    expect(
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment({ databaseUrl: "" }),
      }),
    ).toEqual({ status: "not_configured" });

    expect(
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment({ r2StorageClass: "Infrequent" }),
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("fails closed for a malformed DNA API key", () => {
    expect(
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment({ dnaOpenLabApiKey: "invalid-key" }),
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("rejects missing write arming before any connected call", async () => {
    const fetcher = vi.fn();
    const runtime =
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment(),
        fetch: fetcher as unknown as typeof globalThis.fetch,
        now: () => new Date("2026-09-26T08:01:00.000Z"),
      });
    if (runtime.status !== "ready") {
      throw new Error("synthetic runtime unavailable");
    }

    const error = await runtime
      .execute({
        ...invocation(),
        allowPersistentWrite: false,
      } as unknown as DnaPopulationEntrantAuthorityCohortCommandInvocation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "not_explicitly_armed",
      message: "Population entrant commissioning command is unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects malformed authority binding before any connected call", async () => {
    const fetcher = vi.fn();
    const runtime =
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment(),
        fetch: fetcher as unknown as typeof globalThis.fetch,
        now: () => new Date("2026-09-26T08:01:00.000Z"),
      });
    if (runtime.status !== "ready") {
      throw new Error("synthetic runtime unavailable");
    }

    await expect(
      runtime.execute(invocation({ expectedUnresolvedRaceCount: 0 })),
    ).rejects.toMatchObject({
      diagnostic: "invalid_authority_binding",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects exact-head drift before any connected call", async () => {
    const fetcher = vi.fn();
    const runtime =
      dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
        environment: environment(),
        fetch: fetcher as unknown as typeof globalThis.fetch,
        now: () => new Date("2026-09-26T08:01:00.000Z"),
      });
    if (runtime.status !== "ready") {
      throw new Error("synthetic runtime unavailable");
    }

    await expect(
      runtime.execute(invocation({ exactCodeHeadSha: "f".repeat(40) })),
    ).rejects.toMatchObject({
      diagnostic: "exact_head_mismatch",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
