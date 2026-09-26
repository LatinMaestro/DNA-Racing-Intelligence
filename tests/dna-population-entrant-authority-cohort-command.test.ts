import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityCohortCommand,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND_VERSION,
  type DnaPopulationEntrantAuthorityCohortCommandInvocation,
  type DnaPopulationEntrantAuthorityCohortCommandRuntime,
  type DnaPopulationEntrantAuthorityLiveAudit,
} from "@/lib/dna-population-entrant-authority-cohort-command";
import type {
  DnaPopulationEntrantAuthorityCommittedCohortSummary,
  DnaPopulationEntrantAuthorityPreparedCohort,
} from "@/lib/dna-population-entrant-authority-cohort";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const FIRST_COMMIT_AT = "2026-09-26T06:05:00.000Z";
const SECOND_COMMIT_AT = "2026-09-26T06:06:00.000Z";
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

function committed(
  authority: DnaPopulationEntrantAuthorityLiveAudit["authority"],
  storageStatus: "created" | "existing" = "created",
): DnaPopulationEntrantAuthorityCommittedCohortSummary {
  return Object.freeze({
    version: 1 as const,
    status: "committed" as const,
    authority,
    chunkOrdinal: 1,
    rowCount: 1,
    bodySha256: "d".repeat(64),
    raceSetSha256: "c".repeat(64),
    recordSetSha256: "e".repeat(64),
    storageStatus,
    capacityObservedAt: "2026-09-26T06:04:00.000Z",
    checkpointRaceCountBefore: 0,
    checkpointRaceCountAfter: 1,
    authorityComplete: true,
    providerRequestPerformed: false,
    persistentWritePerformed: true,
    providerWritePerformed: false,
    paidUsageAllowed: false,
  });
}

function prepared(
  liveAudit: DnaPopulationEntrantAuthorityLiveAudit,
  commit: DnaPopulationEntrantAuthorityPreparedCohort["commit"] = vi.fn(
    async () => committed(liveAudit.authority),
  ),
): DnaPopulationEntrantAuthorityPreparedCohort {
  return Object.freeze({
    summary: Object.freeze({
      version: 1 as const,
      status: "prepared_uncommitted" as const,
      authority: liveAudit.authority,
      recoveredRaceCount: 0,
      chunkOrdinal: 1,
      selectedRaceCount: 1,
      providerRequestCount: 1,
      cohortSha256: "b".repeat(64),
      selectedRaceSetSha256: "c".repeat(64),
      preparedBodySha256: "d".repeat(64),
      preparedRecordSetSha256: "e".repeat(64),
      cohortObservedAt: OBSERVED_AT,
      aggregateRequestsPerMinute: 30,
      providerRequestPerformed: true,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    }),
    commit,
  });
}

function runtime(): DnaPopulationEntrantAuthorityCohortCommandRuntime {
  return Object.freeze({
    client: { raceDocs: vi.fn() },
    requestBudget: createDnaOpenLabRequestBudget(),
    capacityGate: { assertFreshCurrentCapacity: vi.fn() },
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

function clock(values: readonly string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]!);
}

describe("DNA population entrant authority cohort command", () => {
  it("rejects an invocation that is not explicitly write-armed before loading authority", async () => {
    const load = vi.fn(async () => audit());
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      cohortPreparer: vi.fn(),
    });

    await expect(
      command.execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as DnaPopulationEntrantAuthorityCohortCommandInvocation),
    ).rejects.toMatchObject({ diagnostic: "not_explicitly_armed" });
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects exact-head and future-time drift before authority access", async () => {
    const load = vi.fn(async () => audit());
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(),
    });

    await expect(
      command.execute({ ...invocation, exactCodeHeadSha: OTHER_HEAD }),
    ).rejects.toMatchObject({ diagnostic: "exact_head_mismatch" });
    await expect(
      command.execute({
        ...invocation,
        cohortObservedAt: SECOND_COMMIT_AT,
      }),
    ).rejects.toMatchObject({ diagnostic: "invalid_observation_time" });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads exact-head authority once, prepares read-only evidence and exposes only sanitized summary data", async () => {
    const liveAudit = audit();
    const load = vi.fn(async () => liveAudit);
    const exactPrepared = prepared(liveAudit);
    const cohortPreparer = vi.fn(async () => exactPrepared);
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer,
    });

    const session = await command.execute(invocation);

    expect(load).toHaveBeenCalledOnce();
    expect(cohortPreparer).toHaveBeenCalledOnce();
    expect(session.prepared).toMatchObject({
      status: "prepared_uncommitted",
      exactCodeHeadSha: HEAD,
      cohortObservedAt: OBSERVED_AT,
      selectedRaceCount: 1,
      providerRequestCount: 1,
      persistentWriteArmed: true,
      previewOnly: true,
      providerRequestPerformed: true,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(JSON.stringify(session.prepared)).not.toContain(OWNER);
    expect(JSON.stringify(session.prepared)).not.toContain("race-1");
    expect(exactPrepared.commit).not.toHaveBeenCalled();
  });

  it("retries an interrupted commit on the same prepared cohort without preparing or hydrating again", async () => {
    const liveAudit = audit();
    const commit = vi
      .fn<DnaPopulationEntrantAuthorityPreparedCohort["commit"]>()
      .mockRejectedValueOnce(new Error("private Neon interruption"))
      .mockResolvedValueOnce(committed(liveAudit.authority, "existing"));
    const exactPrepared = prepared(liveAudit, commit);
    const cohortPreparer = vi.fn(async () => exactPrepared);
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: clock([FIRST_COMMIT_AT, FIRST_COMMIT_AT, SECOND_COMMIT_AT]),
      cohortPreparer,
    });
    const session = await command.execute(invocation);

    const firstError = await session.commit().catch((caught: unknown) => caught);
    expect(firstError).toMatchObject({
      diagnostic: "cohort_unavailable",
      message: "Population entrant commissioning command is unavailable",
    });
    expect(String(firstError)).not.toContain("private Neon interruption");

    const receipt = await session.commit();

    expect(receipt).toMatchObject({
      status: "committed",
      storageStatus: "existing",
      checkpointRaceCountBefore: 0,
      checkpointRaceCountAfter: 1,
      providerRequestPerformed: false,
      persistentWritePerformed: true,
      paidUsageAllowed: false,
    });
    expect(cohortPreparer).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenNthCalledWith(1, {
      registeredAt: FIRST_COMMIT_AT,
    });
    expect(commit).toHaveBeenNthCalledWith(2, {
      registeredAt: SECOND_COMMIT_AT,
    });
  });

  it("caches a successful commit receipt instead of attempting a second persistence", async () => {
    const liveAudit = audit();
    const commit = vi.fn(async () => committed(liveAudit.authority));
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(async () => prepared(liveAudit, commit)),
    });
    const session = await command.execute(invocation);

    const first = await session.commit();
    const second = await session.commit();

    expect(second).toEqual(first);
    expect(commit).toHaveBeenCalledOnce();
  });

  it("fails closed when the live audit or prepared authority is bound elsewhere", async () => {
    const mismatchedAudit = Object.freeze({
      ...audit(),
      exactCodeHeadSha: OTHER_HEAD,
    });
    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => mismatchedAudit) },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(),
    });

    await expect(command.execute(invocation)).rejects.toMatchObject({
      diagnostic: "authority_head_mismatch",
    });

    const liveAudit = audit();
    const driftedPrepared = Object.freeze({
      ...prepared(liveAudit),
      summary: Object.freeze({
        ...prepared(liveAudit).summary,
        authority: Object.freeze({
          ...liveAudit.authority,
          unresolvedRaceCount: liveAudit.authority.unresolvedRaceCount + 1,
        }),
      }),
    });
    const driftedCommand = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(async () => driftedPrepared),
    });

    await expect(driftedCommand.execute(invocation)).rejects.toMatchObject({
      diagnostic: "cohort_unavailable",
    });
  });

  it("sanitizes authority-source and cohort-preparation failures", async () => {
    const authorityCommand = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: {
        load: vi.fn(async () => {
          throw new Error("postgres://private-secret");
        }),
      },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(),
    });
    const authorityError = await authorityCommand
      .execute(invocation)
      .catch((caught: unknown) => caught);
    expect(authorityError).toMatchObject({ diagnostic: "authority_unavailable" });
    expect(String(authorityError)).not.toContain("private-secret");

    const liveAudit = audit();
    const cohortCommand = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => liveAudit) },
      runtime: runtime(),
      now: () => new Date(FIRST_COMMIT_AT),
      cohortPreparer: vi.fn(async () => {
        throw new Error("race-1 provider-response-secret");
      }),
    });
    const cohortError = await cohortCommand
      .execute(invocation)
      .catch((caught: unknown) => caught);
    expect(cohortError).toMatchObject({ diagnostic: "cohort_unavailable" });
    expect(String(cohortError)).not.toContain("provider-response-secret");
  });
});
