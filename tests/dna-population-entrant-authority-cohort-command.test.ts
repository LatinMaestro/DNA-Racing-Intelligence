import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityCohortCommand,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
  type DnaPopulationEntrantAuthorityCohortCommandInvocation,
  type DnaPopulationEntrantAuthorityCohortCommandRuntime,
  type DnaPopulationEntrantAuthorityLiveAudit,
} from "@/lib/dna-population-entrant-authority-cohort-command";
import type { DnaPopulationEntrantAuthorityCohortResult } from "@/lib/dna-population-entrant-authority-cohort";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const NOW = "2026-09-26T06:05:00.000Z";
const OWNER = "private-owner";

const invocation: DnaPopulationEntrantAuthorityCohortCommandInvocation =
  Object.freeze({
    commandVersion: DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: OBSERVED_AT,
  });

function audit(): DnaPopulationEntrantAuthorityLiveAudit {
  const raceDocuments: readonly CanonicalRaceDocumentMetadata[] = Object.freeze([
    Object.freeze({
      sourceType: "race_document" as const,
      sourceRaceId: "race-1",
      mode: "bike" as const,
    }),
  ]);
  const plan: DnaPopulationHistoryAcquisitionPlan =
    planDnaPopulationHistoryAcquisition({ raceDocuments });
  if (plan.unresolvedRaceSetSha256 === null) {
    throw new Error("synthetic unresolved authority is unavailable");
  }
  return Object.freeze({
    exactCodeHeadSha: HEAD,
    plan,
    raceDocuments,
    authority: Object.freeze({
      version: 1 as const,
      generationId: plan.unresolvedRaceSetSha256,
      unresolvedRaceCount: plan.unresolvedRaceCount,
      unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
    }),
  });
}

function result(
  authority: DnaPopulationEntrantAuthorityLiveAudit["authority"],
): DnaPopulationEntrantAuthorityCohortResult {
  return Object.freeze({
    authority,
    chunkOrdinal: 1,
    selectedRaceCount: 1,
    providerRequestCount: 1,
    cohortSha256: "c".repeat(64),
    preparedBodySha256: "d".repeat(64),
    preparedRecordSetSha256: "e".repeat(64),
    checkpointRaceCountBefore: 0,
    checkpointRaceCountAfter: 1,
    authorityComplete: true,
    storageStatus: "created" as const,
    cohortObservedAt: OBSERVED_AT,
    capacityObservedAt: "2026-09-26T06:04:00.000Z",
    providerRequestPerformed: true as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function runtime(): DnaPopulationEntrantAuthorityCohortCommandRuntime {
  return Object.freeze({
    client: {
      raceDocs: vi.fn(),
    },
    requestBudget: createDnaOpenLabRequestBudget(),
    capacityGate: {
      assertFreshCurrentCapacity: vi.fn(),
    },
    checkpointRepository: {
      read: vi.fn(),
      listChunkManifests: vi.fn(),
      registerChunk: vi.fn(),
    },
    r2Store: {
      read: vi.fn(),
      write: vi.fn(),
    },
  }) as unknown as DnaPopulationEntrantAuthorityCohortCommandRuntime;
}

describe("DNA population entrant authority cohort command", () => {
  it("rejects an invocation that is not explicitly write-armed before loading authority", async () => {
    const load = vi.fn(async () => audit());
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner: vi.fn(),
    });

    const error = await command
      .execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as DnaPopulationEntrantAuthorityCohortCommandInvocation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "DnaPopulationEntrantAuthorityCohortCommandError",
      diagnostic: "not_explicitly_armed",
      message: "Population entrant commissioning command is unavailable",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects a head that differs from the exact runtime code before loading authority", async () => {
    const load = vi.fn(async () => audit());
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner: vi.fn(),
    });

    await expect(
      command.execute({
        ...invocation,
        exactCodeHeadSha: OTHER_HEAD,
      }),
    ).rejects.toMatchObject({
      diagnostic: "exact_head_mismatch",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects a future or non-canonical observation timestamp before loading authority", async () => {
    const load = vi.fn(async () => audit());
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner: vi.fn(),
    });

    await expect(
      command.execute({
        ...invocation,
        cohortObservedAt: "2026-09-26T06:06:00.000Z",
      }),
    ).rejects.toMatchObject({
      diagnostic: "invalid_observation_time",
    });
    await expect(
      command.execute({
        ...invocation,
        cohortObservedAt: "2026-09-26T06:00:00Z",
      }),
    ).rejects.toMatchObject({
      diagnostic: "invalid_observation_time",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("reloads exact-head authority at execution time and invokes exactly one bounded cohort", async () => {
    const liveAudit = audit();
    const load = vi.fn(async () => liveAudit);
    const cohortRunner = vi.fn(async () => result(liveAudit.authority));
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner,
    });

    const receipt = await command.execute(invocation);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });
    expect(cohortRunner).toHaveBeenCalledTimes(1);
    expect(cohortRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: OWNER,
        plan: liveAudit.plan,
        raceDocuments: liveAudit.raceDocuments,
        authority: liveAudit.authority,
        cohortObservedAt: OBSERVED_AT,
        registeredAt: NOW,
      }),
    );
    expect(receipt).toEqual({
      status: "committed",
      exactCodeHeadSha: HEAD,
      cohortObservedAt: OBSERVED_AT,
      chunkOrdinal: 1,
      selectedRaceCount: 1,
      providerRequestCount: 1,
      cohortSha256: "c".repeat(64),
      preparedBodySha256: "d".repeat(64),
      preparedRecordSetSha256: "e".repeat(64),
      checkpointRaceCountBefore: 0,
      checkpointRaceCountAfter: 1,
      authorityComplete: true,
      storageStatus: "created",
      capacityObservedAt: "2026-09-26T06:04:00.000Z",
      persistentWriteArmed: true,
      previewOnly: true,
      providerRequestPerformed: true,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(JSON.stringify(receipt)).not.toContain(OWNER);
    expect(JSON.stringify(receipt)).not.toContain("race-1");
  });

  it("fails closed if the freshly loaded authority is bound to another code head", async () => {
    const liveAudit = Object.freeze({
      ...audit(),
      exactCodeHeadSha: OTHER_HEAD,
    });
    const cohortRunner = vi.fn();
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner,
    });

    await expect(command.execute(invocation)).rejects.toMatchObject({
      diagnostic: "authority_head_mismatch",
    });
    expect(cohortRunner).not.toHaveBeenCalled();
  });

  it("sanitizes authority-source failures before a cohort can start", async () => {
    const secret = "postgres://private-secret";
    const cohortRunner = vi.fn();
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: {
        load: vi.fn(async () => {
          throw new Error(secret);
        }),
      },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner,
    });

    const error = await command
      .execute(invocation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "authority_unavailable",
      message: "Population entrant commissioning command is unavailable",
    });
    expect(String(error)).not.toContain(secret);
    expect(cohortRunner).not.toHaveBeenCalled();
  });

  it("sanitizes cohort failures without exposing Race or provider detail", async () => {
    const liveAudit = audit();
    const privateDetail = "race-1 provider-response-secret";
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: () => new Date(NOW),
      cohortRunner: vi.fn(async () => {
        throw new Error(privateDetail);
      }),
    });

    const error = await command
      .execute(invocation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "cohort_unavailable",
      message: "Population entrant commissioning command is unavailable",
    });
    expect(String(error)).not.toContain(privateDetail);
  });
});
