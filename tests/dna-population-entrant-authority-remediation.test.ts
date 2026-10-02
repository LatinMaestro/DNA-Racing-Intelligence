import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND_VERSION,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND_VERSION,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_INTENT,
  createDnaPopulationEntrantAuthorityRemediation,
  createDnaPopulationEntrantAuthorityRemediationManifestStore,
  DnaPopulationEntrantAuthorityRemediationError,
  type DnaPopulationEntrantAuthorityRemediationStoragePort,
} from "@/lib/dna-population-entrant-authority-remediation";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
} from "@/lib/dna-population-entrant-authority-record";
import {
  adaptDnaRaceDocument,
  dnaOpenLabRawEvidenceSha256,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import type { DnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";

const OWNER = "private-owner";
const HEAD = "a".repeat(40);
const STARTED_AT = "2026-10-01T00:00:00.000Z";
const OBSERVED_AT = "2026-10-01T01:00:00.000Z";
const CONTINUATION_OBSERVED_AT = "2026-10-01T02:00:00.000Z";
const COHORT_3_OBSERVED_AT = "2026-10-01T03:00:00.000Z";

function raceId(index: number): string {
  return `race-${String(index).padStart(4, "0")}`;
}

function rawRace(sourceRaceId: DnaRaceIdentifier): DnaRaceDocument {
  const numeric = Number(String(sourceRaceId).replace(/\D/gu, "")) || 1;
  return Object.freeze({
    rid: sourceRaceId,
    rvmode: "bike",
    hids: [numeric],
  }) as DnaRaceDocument;
}

function response(
  documents: readonly DnaRaceDocument[],
): DnaOpenLabResponse<readonly DnaRaceDocument[]> {
  return Object.freeze({
    result: documents,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function requestBudget(): DnaOpenLabRequestBudget {
  return Object.freeze({
    async execute<T>(
      request: () => Promise<DnaOpenLabResponse<T>>,
    ): Promise<DnaOpenLabResponse<T>> {
      return request();
    },
    observeRateLimit: () => undefined,
    reduceEffectiveRequestsPerMinute: () => undefined,
    snapshot: () =>
      Object.freeze({
        effectiveRequestsPerMinute: 90,
        requestsInCurrentWindow: 0,
        blockedUntilMilliseconds: null,
      }),
  });
}

function bodyStream(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
  })();
}

function memoryStorage() {
  const objects = new Map<
    string,
    Readonly<{
      body: Uint8Array;
      contentType: string;
      checksumSha256: string;
      metadata: Readonly<Record<string, string>>;
    }>
  >();

  const storage: DnaPopulationEntrantAuthorityRemediationStoragePort =
    Object.freeze({
      readBucketPrivacy: vi.fn(async () =>
        Object.freeze({
          publicAccessDisabled: true,
          r2DevDisabled: true,
          customDomainCount: 0,
        }),
      ),
      putObjectIfAbsent: vi.fn(async (input) => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of input.body) chunks.push(chunk);
        const body = new Uint8Array(
          chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (objects.has(input.key)) {
          return Object.freeze({ status: "existing" as const });
        }
        objects.set(
          input.key,
          Object.freeze({
            body,
            contentType: input.contentType,
            checksumSha256: input.checksumSha256,
            metadata: input.metadata,
          }),
        );
        return Object.freeze({ status: "created" as const });
      }),
      headObject: vi.fn(async (input) => {
        const stored = objects.get(input.key);
        if (stored === undefined) {
          return Object.freeze({ status: "missing" as const });
        }
        return Object.freeze({
          status: "ready" as const,
          contentType: stored.contentType,
          byteLength: stored.body.byteLength,
          checksumSha256: stored.checksumSha256,
          metadata: stored.metadata,
        });
      }),
      getObject: vi.fn(async (input) => {
        const stored = objects.get(input.key);
        if (stored === undefined) {
          return Object.freeze({ status: "missing" as const });
        }
        return Object.freeze({
          status: "ready" as const,
          body: bodyStream(stored.body),
        });
      }),
    });

  return { storage, objects };
}

function rewriteRetainedManifestRateToLegacy(
  objects: Map<
    string,
    Readonly<{
      body: Uint8Array;
      contentType: string;
      checksumSha256: string;
      metadata: Readonly<Record<string, string>>;
    }>
  >,
): void {
  const entries = [...objects.entries()];
  const firstEntry = entries.find(([key]) => key.endsWith("/000001.json"));
  const secondEntry = entries.find(([key]) => key.endsWith("/000002.json"));
  if (firstEntry === undefined || secondEntry === undefined) {
    throw new Error("test remediation manifests are unavailable");
  }

  const rewrite = (
    key: string,
    stored: (typeof firstEntry)[1],
    bodyText: string,
  ): string => {
    const body = new TextEncoder().encode(bodyText);
    const checksumSha256 = createHash("sha256")
      .update(bodyText, "utf8")
      .digest("hex");
    objects.set(
      key,
      Object.freeze({
        body,
        contentType: stored.contentType,
        checksumSha256,
        metadata: Object.freeze({
          ...stored.metadata,
          "dna-body-sha256": checksumSha256,
        }),
      }),
    );
    return checksumSha256;
  };

  const [firstKey, firstStored] = firstEntry;
  const firstCurrent = new TextDecoder().decode(firstStored.body);
  const firstLegacy = firstCurrent.replace(
    '"aggregateRequestsPerMinute":90',
    '"aggregateRequestsPerMinute":30',
  );
  if (firstLegacy === firstCurrent) {
    throw new Error("test first manifest did not contain the current rate");
  }
  const firstLegacySha256 = rewrite(firstKey, firstStored, firstLegacy);

  const [secondKey, secondStored] = secondEntry;
  const secondCurrent = new TextDecoder().decode(secondStored.body);
  const secondLegacy = secondCurrent
    .replace(
      '"aggregateRequestsPerMinute":90',
      '"aggregateRequestsPerMinute":30',
    )
    .replace(
      /"priorManifestSha256":"[a-f0-9]{64}"/u,
      `"priorManifestSha256":"${firstLegacySha256}"`,
    );
  if (secondLegacy === secondCurrent) {
    throw new Error("test continuation manifest was not rewritten");
  }
  rewrite(secondKey, secondStored, secondLegacy);
}

function harness(raceCount = 25) {
  const raceIds = Object.freeze(
    Array.from({ length: raceCount }, (_, index) => raceId(index + 1)),
  );
  const generationId = dnaPopulationEntrantAuthorityRaceSetSha256(raceIds);
  const authority = Object.freeze({
    version: 1 as const,
    generationId,
    unresolvedRaceCount: raceIds.length,
    unresolvedRaceSetSha256: generationId,
  });
  const records: readonly DnaPopulationEntrantAuthorityRecord[] = Object.freeze(
    raceIds.map((sourceRaceId, index) =>
      dnaPopulationEntrantAuthorityQuarantineRecord({
        sourceRaceId,
        observedAt: STARTED_AT,
        quarantineReason:
          index < 20
            ? "provider_document_unusable"
            : "entrant_authority_unresolved",
        sourceEvidenceSha256: "b".repeat(64),
      }),
    ),
  );
  const chunk = buildDnaPopulationEntrantAuthorityChunk({
    generationId,
    chunkOrdinal: 1,
    records,
  });
  const manifest = Object.freeze({
    ...chunk.receipt,
    objectKey: "private-base-object",
    registeredAt: STARTED_AT,
  });
  const checkpoint = Object.freeze({
    ...authority,
    chunkCount: 1,
    persistedRaceCount: raceIds.length,
    lastSourceRaceId: raceIds.at(-1)!,
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
  });
  const checkpointRepository = Object.freeze({
    read: vi.fn(async () => checkpoint),
    listChunkManifests: vi.fn(async () => Object.freeze([manifest])),
  });
  const r2Store = Object.freeze({
    read: vi.fn(async () => chunk),
  });
  const authoritySource = Object.freeze({
    load: vi.fn(async () =>
      Object.freeze({
        exactCodeHeadSha: HEAD,
        plan: Object.freeze({}) as never,
        raceDocuments: Object.freeze([]),
        authority,
      }),
    ),
  });
  const capacityGate = Object.freeze({
    assertFreshCurrentCapacity: vi.fn(async () =>
      Object.freeze({
        version: 1 as const,
        generationId,
        unresolvedRaceCount: raceIds.length,
        unresolvedRaceSetSha256: generationId,
        observedAt: OBSERVED_AT,
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      }),
    ),
  });
  const providerCalls: readonly DnaRaceIdentifier[][] = [];
  const mutableProviderCalls = providerCalls as DnaRaceIdentifier[][];
  const client = Object.freeze({
    raceDocs: vi.fn(async (requested: readonly DnaRaceIdentifier[]) => {
      mutableProviderCalls.push([...requested]);
      return response(requested.map(rawRace));
    }),
  });
  const storage = memoryStorage();
  const manifestStore =
    createDnaPopulationEntrantAuthorityRemediationManifestStore({
      ownerId: OWNER,
      bucketName: "private-preview",
      storage: storage.storage,
    });
  const raceDocumentReader = Object.freeze({
    read: vi.fn(
      async (reference: {
        sourceRaceId: string;
        observedAt: string;
        rawEvidenceSha256: string;
      }) => {
        const raw = rawRace(reference.sourceRaceId);
        expect(dnaOpenLabRawEvidenceSha256(raw)).toBe(
          reference.rawEvidenceSha256,
        );
        return adaptDnaRaceDocument({
          raw,
          observedAt: reference.observedAt,
          endpoint: "races.docs",
        });
      },
    ),
  });
  const mainGuard = Object.freeze({
    assertCurrentMain: vi.fn(async () => ({ currentMainSha: HEAD })),
  });
  const remediation = createDnaPopulationEntrantAuthorityRemediation({
    ownerId: OWNER,
    runtimeCodeHeadSha: HEAD,
    mainGuard,
    authoritySource,
    checkpointRepository,
    r2Store,
    capacityGate,
    client,
    requestBudget: requestBudget(),
    manifestStore,
    raceDocumentReader,
  });
  return {
    remediation,
    mainGuard,
    authoritySource,
    capacityGate,
    client,
    providerCalls: mutableProviderCalls,
    storage,
    manifestStore,
    raceDocumentReader,
  };
}

const invocation = Object.freeze({
  commandVersion: DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND_VERSION,
  intent: DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_INTENT,
  allowPersistentWrite: true as const,
  exactCodeHeadSha: HEAD,
  cohortObservedAt: OBSERVED_AT,
});

const continuationInvocation = Object.freeze({
  commandVersion:
    DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND_VERSION,
  intent: DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_INTENT,
  allowPersistentWrite: true as const,
  exactCodeHeadSha: HEAD,
  cohortObservedAt: CONTINUATION_OBSERVED_AT,
});

const cohort3Invocation = Object.freeze({
  commandVersion:
    DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION,
  intent: DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT,
  allowPersistentWrite: true as const,
  exactCodeHeadSha: HEAD,
  cohortObservedAt: COHORT_3_OBSERVED_AT,
});

describe("population entrant authority bounded remediation", () => {
  it("persists one 20-Race private Preview remediation cohort and verifies its raw evidence", async () => {
    const test = harness();

    await expect(test.remediation.execute(invocation)).resolves.toMatchObject({
      status: "committed_unpublished",
      exactCodeHeadSha: HEAD,
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      quarantinedRaceCountBefore: 25,
      quarantinedRaceCountAfterEvidence: 5,
      providerRequestCount: 1,
      storageStatus: "created",
      aggregateRequestsPerMinute: 90,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(1);
    expect(test.providerCalls[0]).toHaveLength(20);
    expect(test.capacityGate.assertFreshCurrentCapacity).toHaveBeenCalledTimes(
      2,
    );
    expect(
      test.capacityGate.assertFreshCurrentCapacity,
    ).toHaveBeenNthCalledWith(1, expect.any(Object), 100);
    expect(
      test.capacityGate.assertFreshCurrentCapacity,
    ).toHaveBeenNthCalledWith(2, expect.any(Object), 100);
    expect(test.mainGuard.assertCurrentMain).toHaveBeenCalledTimes(4);

    await expect(test.remediation.verify()).resolves.toMatchObject({
      status: "verified_replacements",
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      quarantinedRaceCountBefore: 25,
      quarantinedRaceCountAfterEvidence: 5,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
    });
    expect(test.raceDocumentReader.read).toHaveBeenCalledTimes(40);
  });

  it("proves the next remediation cohort read-only without rescanning the first cohort", async () => {
    const test = harness();

    await test.remediation.execute(invocation);
    const providerCallsBefore = test.providerCalls.length;
    const writesBefore = vi.mocked(test.storage.storage.putObjectIfAbsent).mock
      .calls.length;

    await expect(
      test.remediation.inspectContinuationReadiness(),
    ).resolves.toMatchObject({
      status: "ready_for_continuation",
      exactCodeHeadSha: HEAD,
      completedCohortCount: 1,
      nextCohortOrdinal: 2,
      priorSelectedRaceCount: 20,
      priorReplacementRaceCount: 20,
      nextSelectedRaceCount: 5,
      quarantinedRaceCountBefore: 25,
      remainingUnscannedQuarantineCount: 0,
      aggregateRequestsPerMinute: 90,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(providerCallsBefore);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBefore);
  });

  it("replays an existing first cohort without another DNA request or write", async () => {
    const test = harness();

    await test.remediation.execute(invocation);
    const callsAfterFirst = test.providerCalls.length;
    const putAfterFirst = vi.mocked(test.storage.storage.putObjectIfAbsent).mock
      .calls.length;

    await expect(test.remediation.execute(invocation)).resolves.toMatchObject({
      status: "existing_verified",
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      persistentWritePerformed: false,
      storageStatus: "existing",
    });
    expect(test.providerCalls).toHaveLength(callsAfterFirst);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(putAfterFirst);
  });

  it("fails closed before provider access when exact main is not authorized", async () => {
    const test = harness();

    const error = await test.remediation
      .execute({
        ...invocation,
        exactCodeHeadSha: "c".repeat(40),
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DnaPopulationEntrantAuthorityRemediationError);
    expect(error).toMatchObject({ diagnostic: "exact_head_mismatch" });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
  });

  it("fails closed before the manifest write when main changes during hydration", async () => {
    const test = harness();
    test.mainGuard.assertCurrentMain
      .mockResolvedValueOnce({ currentMainSha: HEAD })
      .mockResolvedValueOnce({ currentMainSha: HEAD })
      .mockResolvedValueOnce({ currentMainSha: HEAD })
      .mockResolvedValueOnce({ currentMainSha: "b".repeat(40) });

    await expect(test.remediation.execute(invocation)).rejects.toMatchObject({
      diagnostic: "exact_head_mismatch",
    });
    expect(test.providerCalls).toHaveLength(1);
    expect(test.storage.storage.putObjectIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects a capacity receipt that is not bound to the loaded authority", async () => {
    const test = harness();
    test.capacityGate.assertFreshCurrentCapacity.mockResolvedValueOnce(
      Object.freeze({
        version: 1 as const,
        generationId: "f".repeat(64),
        unresolvedRaceCount: 25,
        unresolvedRaceSetSha256: "f".repeat(64),
        observedAt: OBSERVED_AT,
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      }),
    );

    await expect(test.remediation.execute(invocation)).rejects.toMatchObject({
      diagnostic: "capacity_unavailable",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.storage.storage.putObjectIfAbsent).not.toHaveBeenCalled();
  });

  it("persists and independently verifies exactly one continuation remediation cohort", async () => {
    const test = harness();

    await test.remediation.execute(invocation);
    const providerCallsAfterFirst = test.providerCalls.length;
    const writesAfterFirst = vi.mocked(test.storage.storage.putObjectIfAbsent)
      .mock.calls.length;

    await expect(
      test.remediation.executeContinuation(continuationInvocation),
    ).resolves.toMatchObject({
      status: "committed_unpublished",
      exactCodeHeadSha: HEAD,
      cohortOrdinal: 2,
      priorSelectedRaceCount: 20,
      priorReplacementRaceCount: 20,
      selectedRaceCount: 5,
      replacementRaceCount: 5,
      baseRecordSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedRaceSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      replacementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantinedRaceCountBefore: 25,
      quarantinedRaceCountAfterEvidence: 0,
      providerRequestCount: 1,
      storageStatus: "created",
      aggregateRequestsPerMinute: 90,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(providerCallsAfterFirst + 1);
    expect(test.providerCalls.at(-1)).toHaveLength(5);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesAfterFirst + 1);

    const providerCallsBeforeVerify = test.providerCalls.length;
    const writesBeforeVerify = vi.mocked(test.storage.storage.putObjectIfAbsent)
      .mock.calls.length;
    await expect(test.remediation.verifyContinuation()).resolves.toMatchObject({
      status: "verified_replacements",
      exactCodeHeadSha: HEAD,
      cohortOrdinal: 2,
      priorSelectedRaceCount: 20,
      priorReplacementRaceCount: 20,
      selectedRaceCount: 5,
      replacementRaceCount: 5,
      baseRecordSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedRaceSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      replacementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantinedRaceCountBefore: 25,
      quarantinedRaceCountAfterEvidence: 0,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(providerCallsBeforeVerify);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBeforeVerify);
  });

  it("replays an existing continuation cohort without another provider request or write", async () => {
    const test = harness();

    await test.remediation.execute(invocation);
    await test.remediation.executeContinuation(continuationInvocation);
    const providerCallsBeforeReplay = test.providerCalls.length;
    const writesBeforeReplay = vi.mocked(test.storage.storage.putObjectIfAbsent)
      .mock.calls.length;

    await expect(
      test.remediation.executeContinuation(continuationInvocation),
    ).resolves.toMatchObject({
      status: "existing_verified",
      cohortOrdinal: 2,
      priorSelectedRaceCount: 20,
      selectedRaceCount: 5,
      replacementRaceCount: 5,
      persistentWritePerformed: false,
      storageStatus: "existing",
    });
    expect(test.providerCalls).toHaveLength(providerCallsBeforeReplay);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBeforeReplay);
  });

  it("rejects a continuation observation that is not strictly newer than cohort 1", async () => {
    const test = harness();

    await test.remediation.execute(invocation);
    const providerCallsBefore = test.providerCalls.length;
    const writesBefore = vi.mocked(test.storage.storage.putObjectIfAbsent).mock
      .calls.length;

    await expect(
      test.remediation.executeContinuation({
        ...continuationInvocation,
        cohortObservedAt: OBSERVED_AT,
      }),
    ).rejects.toMatchObject({ diagnostic: "invalid_observation_time" });
    expect(test.providerCalls).toHaveLength(providerCallsBefore);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBefore);
  });

  it("proves, persists and independently verifies exactly one third remediation cohort", async () => {
    const test = harness(65);

    await test.remediation.execute(invocation);
    await test.remediation.executeContinuation(continuationInvocation);

    const providerCallsBeforeReadiness = test.providerCalls.length;
    const writesBeforeReadiness = vi.mocked(
      test.storage.storage.putObjectIfAbsent,
    ).mock.calls.length;
    await expect(
      test.remediation.inspectCohort3Readiness(),
    ).resolves.toMatchObject({
      status: "ready_for_cohort_3",
      exactCodeHeadSha: HEAD,
      completedCohortCount: 2,
      nextCohortOrdinal: 3,
      priorSelectedRaceCount: 40,
      priorReplacementRaceCount: 40,
      nextSelectedRaceCount: 20,
      quarantinedRaceCountBefore: 65,
      remainingUnscannedQuarantineCount: 5,
      aggregateRequestsPerMinute: 90,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(providerCallsBeforeReadiness);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBeforeReadiness);

    await expect(
      test.remediation.executeCohort3(cohort3Invocation),
    ).resolves.toMatchObject({
      status: "committed_unpublished",
      exactCodeHeadSha: HEAD,
      cohortOrdinal: 3,
      priorSelectedRaceCount: 40,
      priorReplacementRaceCount: 40,
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      baseRecordSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedRaceSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      replacementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantinedRaceCountBefore: 65,
      quarantinedRaceCountAfterEvidence: 5,
      providerRequestCount: 1,
      storageStatus: "created",
      aggregateRequestsPerMinute: 90,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });

    const providerCallsBeforeVerify = test.providerCalls.length;
    const writesBeforeVerify = vi.mocked(test.storage.storage.putObjectIfAbsent)
      .mock.calls.length;
    await expect(test.remediation.verifyCohort3()).resolves.toMatchObject({
      status: "verified_replacements",
      exactCodeHeadSha: HEAD,
      cohortOrdinal: 3,
      priorSelectedRaceCount: 40,
      priorReplacementRaceCount: 40,
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      baseRecordSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedRaceSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      replacementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantinedRaceCountBefore: 65,
      quarantinedRaceCountAfterEvidence: 5,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      previewOnly: true,
      paidUsageAllowed: false,
      lastGoodBasePreserved: true,
    });
    expect(test.providerCalls).toHaveLength(providerCallsBeforeVerify);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBeforeVerify);

    const providerCallsBeforeReplay = test.providerCalls.length;
    const writesBeforeReplay = vi.mocked(test.storage.storage.putObjectIfAbsent)
      .mock.calls.length;
    await expect(
      test.remediation.executeCohort3(cohort3Invocation),
    ).resolves.toMatchObject({
      status: "existing_verified",
      cohortOrdinal: 3,
      priorSelectedRaceCount: 40,
      selectedRaceCount: 20,
      replacementRaceCount: 20,
      persistentWritePerformed: false,
      storageStatus: "existing",
    });
    expect(test.providerCalls).toHaveLength(providerCallsBeforeReplay);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBeforeReplay);
  });

  it("accepts immutable cohort 1 and 2 manifests retained under the legacy 30 aggregate limit", async () => {
    const test = harness(65);

    await test.remediation.execute(invocation);
    await test.remediation.executeContinuation(continuationInvocation);
    rewriteRetainedManifestRateToLegacy(test.storage.objects);

    const providerCallsBefore = test.providerCalls.length;
    const writesBefore = vi.mocked(test.storage.storage.putObjectIfAbsent).mock
      .calls.length;

    await expect(
      test.remediation.inspectCohort3Readiness(),
    ).resolves.toMatchObject({
      status: "ready_for_cohort_3",
      exactCodeHeadSha: HEAD,
      completedCohortCount: 2,
      nextCohortOrdinal: 3,
      priorSelectedRaceCount: 40,
      nextSelectedRaceCount: 20,
      aggregateRequestsPerMinute: 90,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });

    expect(test.providerCalls).toHaveLength(providerCallsBefore);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBefore);
  });

  it("rejects cohort 3 when its observation is not newer than cohort 2", async () => {
    const test = harness(65);
    await test.remediation.execute(invocation);
    await test.remediation.executeContinuation(continuationInvocation);
    const providerCallsBefore = test.providerCalls.length;
    const writesBefore = vi.mocked(test.storage.storage.putObjectIfAbsent).mock
      .calls.length;

    await expect(
      test.remediation.executeCohort3({
        ...cohort3Invocation,
        cohortObservedAt: CONTINUATION_OBSERVED_AT,
      }),
    ).rejects.toMatchObject({ diagnostic: "invalid_observation_time" });
    expect(test.providerCalls).toHaveLength(providerCallsBefore);
    expect(
      vi.mocked(test.storage.storage.putObjectIfAbsent).mock.calls,
    ).toHaveLength(writesBefore);
  });
});
