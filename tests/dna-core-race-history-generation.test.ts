import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DNA_CORE_RACE_HISTORY_GENERATION_STAGE_BATCH_SIZE,
  publishDnaCoreRaceHistoryGeneration,
  type DnaCoreRaceHistoryGenerationMetadata,
  type DnaCoreRaceHistoryGenerationRepository,
  type DnaCoreRaceHistoryGenerationStageRow,
  type DnaCoreRaceHistoryPublishedGeneration,
} from "@/lib/dna-core-race-history-generation";
import type {
  DnaCoreRaceHistoryJoinedObservation,
  DnaCoreRaceHistoryMaterialization,
} from "@/lib/dna-core-race-history-materialization";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const ownerId = "owner-private";
const workerId = "core-history-worker";
const materializedAt = "2026-09-15T08:00:00.000Z";
const publishedAt = "2026-09-15T08:01:00.000Z";

function observation(index: number): DnaCoreRaceHistoryJoinedObservation {
  const coreId = String(1000 + index);
  const raceId = `race-${String(index).padStart(4, "0")}`;
  return Object.freeze({
    sourceType: "joined_core_race_history_result",
    naturalKey: `core-result:${coreId}:bike:${raceId}`,
    resultEvidenceSha256: "a".repeat(64),
    raceDocumentEvidenceSha256: "b".repeat(64),
    sourceCoreId: coreId,
    sourceRaceId: raceId,
    mode: "bike",
    distanceMetres: 1000,
    distanceAuthority: "result_and_race_document",
    elapsedMilliseconds: 60_000 + index,
    finishPosition: 1,
    eventAt: "2026-09-15T07:00:00.000Z",
    gateCount: 6,
    payoutMechanismSourceValue: "6v6",
    sourceFormat: "6v6",
    sourceRaceClass: 1,
    goldStar: false,
    blueStar: false,
    starEvidenceStatus: "available",
    publishedCellStatus: "accepted",
    raceType: "6v6",
    mapIds: Object.freeze(["anchor"]),
  });
}

function materialization(
  count = 3,
  entrantAuthorityOmissionCount = 0,
  entrantMismatchOmissionCount = 0,
): DnaCoreRaceHistoryMaterialization {
  const observations = Object.freeze(
    Array.from({ length: count }, (_, index) => observation(index)).sort(
      (left, right) => left.naturalKey.localeCompare(right.naturalKey),
    ),
  );
  return Object.freeze({
    ownerId,
    materializedAt,
    cycleSetSha256: "c".repeat(64),
    observationSetSha256: dnaOpenLabRawEvidenceSha256(observations),
    inputCycleCount: 1,
    inputPageCount: 2,
    inputResultCount:
      count + entrantAuthorityOmissionCount + entrantMismatchOmissionCount,
    replayDuplicateCount: 0,
    raceDocumentCount: count,
    entrantAuthorityOmissionCount,
    entrantMismatchOmissionCount,
    exactDistanceConfirmedCount: count,
    acceptedPublishedCellCount: count,
    missingFormatCount: 0,
    unsupportedFormatCount: 0,
    unpublishedCellCount: 0,
    observations,
  });
}

function repository() {
  let generation: DnaCoreRaceHistoryGenerationMetadata | null = null;
  let published: DnaCoreRaceHistoryPublishedGeneration | null = null;
  const rows = new Map<number, DnaCoreRaceHistoryGenerationStageRow>();
  const begin = vi.fn<DnaCoreRaceHistoryGenerationRepository["begin"]>(
    async (requestedOwnerId, input) => {
      if (requestedOwnerId !== ownerId)
        throw new Error("synthetic owner denied");
      if (generation !== null) {
        if (
          dnaOpenLabRawEvidenceSha256(generation) !==
          dnaOpenLabRawEvidenceSha256(input.generation)
        ) {
          throw new Error("synthetic generation conflict");
        }
        return published === null ? "staging" : "published";
      }
      generation = input.generation;
      return "staging";
    },
  );
  const stageRows = vi.fn<DnaCoreRaceHistoryGenerationRepository["stageRows"]>(
    async (requestedOwnerId, input) => {
      if (requestedOwnerId !== ownerId || generation === null) {
        throw new Error("synthetic stage denied");
      }
      for (const entry of input.rows) {
        const existing = rows.get(entry.ordinal);
        if (
          existing !== undefined &&
          dnaOpenLabRawEvidenceSha256(existing) !==
            dnaOpenLabRawEvidenceSha256(entry)
        ) {
          throw new Error("synthetic row conflict");
        }
        rows.set(entry.ordinal, entry);
      }
      return input.rows.map(({ ordinal, rowSha256 }) => ({
        ordinal,
        rowSha256,
      }));
    },
  );
  const publish = vi.fn<DnaCoreRaceHistoryGenerationRepository["publish"]>(
    async (requestedOwnerId, input) => {
      if (
        requestedOwnerId !== ownerId ||
        generation === null ||
        input.generationId !== generation.generationId ||
        input.expectedObservationCount !== rows.size
      ) {
        throw new Error("synthetic publication denied");
      }
      const ordered = [...rows.values()].sort(
        (left, right) => left.ordinal - right.ordinal,
      );
      const payloadSha256 = createHash("sha256")
        .update(
          ordered
            .map(
              ({ ordinal, naturalKey, rowSha256 }) =>
                `${ordinal}:${naturalKey}:${rowSha256}\n`,
            )
            .join(""),
          "utf8",
        )
        .digest("hex");
      if (payloadSha256 !== input.payloadSha256) {
        throw new Error("synthetic payload conflict");
      }
      published ??= Object.freeze({
        ...generation,
        state: "published" as const,
        publishedAt: input.publishedAt,
      });
      return published;
    },
  );
  const load = vi.fn<DnaCoreRaceHistoryGenerationRepository["load"]>(
    async (requestedOwnerId, generationId) =>
      requestedOwnerId === ownerId && published?.generationId === generationId
        ? published
        : null,
  );
  return {
    value: Object.freeze({ begin, stageRows, publish, load }),
    begin,
    stageRows,
    publish,
    load,
    rows,
    setPublished(value: DnaCoreRaceHistoryPublishedGeneration | null) {
      published = value;
    },
  };
}

describe("DNA Core race history generation", () => {
  it("stages bounded rows and publishes one complete exact generation", async () => {
    const repo = repository();
    const result = await publishDnaCoreRaceHistoryGeneration({
      ownerId,
      workerId,
      materialization: materialization(
        DNA_CORE_RACE_HISTORY_GENERATION_STAGE_BATCH_SIZE + 1,
      ),
      publishedAt,
      repository: repo.value,
    });

    expect(result.state).toBe("published");
    expect(result.observationCount).toBe(251);
    expect(repo.stageRows).toHaveBeenCalledTimes(2);
    expect(
      repo.stageRows.mock.calls.map((call) => call[1].rows.length),
    ).toEqual([250, 1]);
    expect(repo.publish).toHaveBeenCalledTimes(1);
  });

  it("retains quarantined entrant omissions outside analytical rows", async () => {
    const repo = repository();

    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: materialization(2, 1, 1),
        publishedAt,
        repository: repo.value,
      }),
    ).resolves.toMatchObject({
      inputResultCount: 4,
      entrantAuthorityOmissionCount: 1,
      entrantMismatchOmissionCount: 1,
      observationCount: 2,
    });
    expect(repo.rows.size).toBe(2);
  });

  it("resumes exact staged rows after an interrupted response", async () => {
    const repo = repository();
    const original = repo.value.stageRows;
    let interrupted = false;
    const replaying = Object.freeze({
      ...repo.value,
      async stageRows(
        requestedOwnerId: string,
        input: Parameters<typeof original>[1],
      ) {
        const result = await original(requestedOwnerId, input);
        if (!interrupted) {
          interrupted = true;
          throw new Error("synthetic response interruption");
        }
        return result;
      },
    });
    const request = {
      ownerId,
      workerId,
      materialization: materialization(),
      publishedAt,
      repository: replaying,
    };

    await expect(publishDnaCoreRaceHistoryGeneration(request)).rejects.toThrow(
      "synthetic response interruption",
    );
    await expect(
      publishDnaCoreRaceHistoryGeneration(request),
    ).resolves.toMatchObject({ state: "published", observationCount: 3 });
    expect(repo.rows.size).toBe(3);
  });

  it("returns an exact already-published generation without restaging", async () => {
    const repo = repository();
    const request = {
      ownerId,
      workerId,
      materialization: materialization(),
      publishedAt,
      repository: repo.value,
    };
    const first = await publishDnaCoreRaceHistoryGeneration(request);
    const stageCalls = repo.stageRows.mock.calls.length;

    await expect(publishDnaCoreRaceHistoryGeneration(request)).resolves.toEqual(
      first,
    );
    expect(repo.stageRows).toHaveBeenCalledTimes(stageCalls);
    expect(repo.load).toHaveBeenCalledTimes(1);
  });

  it("rejects changed observation content before repository access", async () => {
    const repo = repository();
    const candidate = materialization();

    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: {
          ...candidate,
          observations: [
            { ...candidate.observations[0]!, elapsedMilliseconds: 1 },
            ...candidate.observations.slice(1),
          ],
        },
        publishedAt,
        repository: repo.value,
      }),
    ).rejects.toThrow("observation authority is invalid");
    expect(repo.begin).not.toHaveBeenCalled();
  });

  it("rejects materialization totals that do not exactly reconcile", async () => {
    const repo = repository();
    const candidate = materialization();

    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: {
          ...candidate,
          inputResultCount: candidate.inputResultCount + 1,
        },
        publishedAt,
        repository: repo.value,
      }),
    ).rejects.toThrow("materialization counts disagree");
    expect(repo.begin).not.toHaveBeenCalled();
  });

  it("rejects a drifted staged checksum and never asks to publish", async () => {
    const repo = repository();
    const drifted = Object.freeze({
      ...repo.value,
      async stageRows(
        requestedOwnerId: string,
        input: Parameters<typeof repo.value.stageRows>[1],
      ) {
        const accepted = await repo.value.stageRows(requestedOwnerId, input);
        return accepted.map((entry, index) =>
          index === 0 ? { ...entry, rowSha256: "f".repeat(64) } : entry,
        );
      },
    });

    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: materialization(),
        publishedAt,
        repository: drifted,
      }),
    ).rejects.toThrow("staged row authority drifted");
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("preserves repository publication failures for last-good handling", async () => {
    const repo = repository();
    const failed = Object.freeze({
      ...repo.value,
      publish: vi.fn(async () => {
        throw new Error("synthetic publication interruption");
      }),
    });

    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: materialization(),
        publishedAt,
        repository: failed,
      }),
    ).rejects.toThrow("synthetic publication interruption");
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("rejects cross-owner and backwards publication authority", async () => {
    const repo = repository();
    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId: "other-owner",
        workerId,
        materialization: materialization(),
        publishedAt,
        repository: repo.value,
      }),
    ).rejects.toThrow("owner authority is invalid");
    await expect(
      publishDnaCoreRaceHistoryGeneration({
        ownerId,
        workerId,
        materialization: materialization(),
        publishedAt: "2026-09-15T07:59:59.000Z",
        repository: repo.value,
      }),
    ).rejects.toThrow("publishedAt predates materialization");
    expect(repo.begin).not.toHaveBeenCalled();
  });
});
