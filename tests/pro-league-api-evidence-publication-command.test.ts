import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  ActiveDnaCoreRaceHistoryGenerationRow,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type { NeonProLeagueEvidenceGenerationRepository } from "@/lib/neon-pro-league-evidence-generation-repository";
import {
  PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT,
  PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION,
  proLeagueApiEvidencePublicationCommandFromEnvironment,
} from "@/lib/pro-league-api-evidence-publication-command";

function sourceRow(
  ordinal: number,
  input: {
    coreId: string;
    finishPosition: number;
    elapsedMilliseconds: number;
  },
): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = Object.freeze({
    sourceType: "joined_core_race_history_result" as const,
    naturalKey: `bike:race-1:${input.coreId}`,
    resultEvidenceSha256: "b".repeat(64),
    raceDocumentEvidenceSha256: "c".repeat(64),
    sourceCoreId: input.coreId,
    sourceRaceId: "race-1",
    mode: "bike" as const,
    distanceMetres: 1_000,
    distanceAuthority: "result_and_race_document" as const,
    elapsedMilliseconds: input.elapsedMilliseconds,
    finishPosition: input.finishPosition,
    eventAt: "2026-09-16T09:00:00.000Z",
    gateCount: 2,
    payoutMechanismSourceValue: "Winner Take All",
    sourceFormat: "standard",
    sourceRaceClass: null,
    goldStar: false,
    blueStar: false,
    starEvidenceStatus: "available" as const,
    publishedCellStatus: "accepted" as const,
    raceType: "1v1",
    mapIds: ["anchor", "glory"],
  });
  return Object.freeze({
    generationId: "a".repeat(64),
    ordinal,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  });
}

function sourceGeneration(
  rows: readonly ActiveDnaCoreRaceHistoryGenerationRow[],
): DnaCoreRaceHistoryPublishedGeneration {
  const payloadDigest = createHash("sha256");
  for (const row of rows) {
    payloadDigest.update(
      `${row.ordinal}:${row.naturalKey}:${row.rowSha256}\n`,
      "utf8",
    );
  }
  return Object.freeze({
    version: 1,
    generationId: "a".repeat(64),
    materializedAt: "2026-09-16T10:00:00.000Z",
    cycleSetSha256: "b".repeat(64),
    observationSetSha256: "c".repeat(64),
    payloadSha256: payloadDigest.digest("hex"),
    inputCycleCount: 1,
    inputPageCount: 1,
    inputResultCount: rows.length,
    replayDuplicateCount: 0,
    raceDocumentCount: 1,
    entrantAuthorityOmissionCount: 0,
    entrantMismatchOmissionCount: 0,
    exactDistanceConfirmedCount: rows.length,
    acceptedPublishedCellCount: rows.length,
    missingFormatCount: 0,
    unsupportedFormatCount: 0,
    unpublishedCellCount: 0,
    observationCount: rows.length,
    state: "published",
    publishedAt: "2026-09-16T10:01:00.000Z",
  });
}

function sourceRepository(
  rows: readonly ActiveDnaCoreRaceHistoryGenerationRow[],
): ActiveDnaCoreRaceHistoryGenerationReadRepository {
  const generation = sourceGeneration(rows);
  return Object.freeze({
    readActiveGeneration: vi.fn(async () => generation),
    readActiveRows: vi.fn(async (_owner, afterOrdinal, limit) =>
      rows.filter((row) => row.ordinal > afterOrdinal).slice(0, limit),
    ),
  });
}

function evidenceRepository() {
  const beginCoreHistory = vi.fn(
    async (): Promise<"staging" | "published"> => "staging",
  );
  const stageRows = vi.fn(
    async (
      _owner: string,
      input: Parameters<
        NeonProLeagueEvidenceGenerationRepository["stageRows"]
      >[1],
    ) =>
      input.rows.map((row, index) => ({
        ordinal: input.startOrdinal + index,
        sha256: createHash("sha256")
          .update(JSON.stringify(row.payload), "utf8")
          .digest("hex"),
      })),
  );
  const publishCoreHistory = vi.fn(async (_owner, input) => ({
    disposition: "published" as const,
    benchmarkCount: input.expectedBenchmarkCount,
    profileCount: input.expectedProfileCount,
  }));
  const repository = {
    begin: vi.fn(),
    beginCoreHistory,
    stageRows,
    publish: vi.fn(),
    publishCoreHistory,
    readActiveGeneration: vi.fn(async () => null),
    listActiveRows: vi.fn(),
  } as unknown as NeonProLeagueEvidenceGenerationRepository;
  return { beginCoreHistory, publishCoreHistory, repository, stageRows };
}

const invocation = Object.freeze({
  commandVersion: PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION,
  intent: PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT,
  allowPersistentWrite: true as const,
  exactCodeHeadSha: "d".repeat(40),
  publishedAt: "2026-09-16T10:02:00.000Z",
});

describe("Pro League API evidence publication command", () => {
  it("publishes complete exact-format evidence from one active API generation", async () => {
    const rows = [
      sourceRow(0, {
        coreId: "101",
        finishPosition: 1,
        elapsedMilliseconds: 40_000,
      }),
      sourceRow(1, {
        coreId: "102",
        finishPosition: 2,
        elapsedMilliseconds: 42_000,
      }),
    ];
    const target = evidenceRepository();
    const command = proLeagueApiEvidencePublicationCommandFromEnvironment(
      {
        databaseUrl: "postgres://runtime@example.invalid/private",
        databaseOwnerId: "a1050000-0000-4000-8000-000000000001",
        ownerId: "private_owner",
      },
      {
        sourceRepository: sourceRepository(rows),
        evidenceRepository: target.repository,
      },
    );
    expect(command.status).toBe("ready");
    if (command.status !== "ready") throw new Error("command unavailable");

    await expect(command.execute(invocation)).resolves.toMatchObject({
      status: "published",
      inputObservationCount: 2,
      acceptedEntryCount: 2,
      benchmarkCount: 1,
      profileCount: 2,
      unbenchmarkedEntryCount: 0,
      persistentWriteArmed: true,
      previewOnly: true,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(target.beginCoreHistory).toHaveBeenCalledWith(
      "private_owner",
      expect.objectContaining({
        coreHistoryGenerationId: "a".repeat(64),
        sourceVersionSetSha256: "c".repeat(64),
        inputObservationCount: 2,
        acceptedEntryCount: 2,
        nonBikeEntryCount: 0,
      }),
    );
    expect(target.stageRows).toHaveBeenCalledTimes(2);
    expect(target.publishCoreHistory).toHaveBeenCalledOnce();
  });

  it("fails closed before reading when the write arm or source is unavailable", async () => {
    const target = evidenceRepository();
    const unavailable: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => null),
      readActiveRows: vi.fn(),
    };
    const command = proLeagueApiEvidencePublicationCommandFromEnvironment(
      {
        databaseUrl: "postgres://runtime@example.invalid/private",
        databaseOwnerId: "a1050000-0000-4000-8000-000000000001",
        ownerId: "private_owner",
      },
      {
        sourceRepository: unavailable,
        evidenceRepository: target.repository,
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    await expect(
      command.execute({ ...invocation, allowPersistentWrite: false as true }),
    ).rejects.toThrow("not explicitly armed");
    await expect(command.execute(invocation)).resolves.toMatchObject({
      status: "source_unavailable",
      inputObservationCount: 0,
    });
    expect(target.beginCoreHistory).not.toHaveBeenCalled();
  });
});
