import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import {
  loadCoreIntelligencePageState,
  type CorePerformanceProfileRepository,
} from "@/lib/core-intelligence-workspace-service";
import {
  neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment,
  type ActiveDnaCoreRaceHistoryGenerationRow,
} from "@/lib/neon-active-dna-core-race-history-generation";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { readAcceptedCoreHistory } from "@/lib/search-core-service";

const connected =
  process.env.CORE_INTELLIGENCE_COMMISSIONING_VERIFICATION === "1";
const describeConnected = connected ? describe : describe.skip;
const selectedCoreId = "10457";

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

function isJoinedHistoryRow(
  row: ActiveDnaCoreRaceHistoryGenerationRow,
): row is ActiveDnaCoreRaceHistoryGenerationRow & {
  payload: Extract<
    ActiveDnaCoreRaceHistoryGenerationRow["payload"],
    { sourceType: "joined_core_race_history_result" }
  >;
} {
  return row.payload.sourceType === "joined_core_race_history_result";
}

describeConnected("hosted Preview Core Intelligence commissioning", () => {
  it("renders accepted exact-distance evidence for owned Core 10457 and rejects another owner", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "CORE_INTELLIGENCE_COMMISSIONING_VERIFIED_AT",
    );
    const now = new Date(verifiedAt);
    expect(now.toISOString()).toBe(verifiedAt);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());

    const connectedRepository =
      neonCorePerformanceProfileRepositoryFromEnvironment({
        databaseUrl: requiredEnvironment("DATABASE_URL"),
        databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
        runtimeRole: "dna_app_runtime",
      });
    expect(connectedRepository.status).toBe("ready");
    if (
      connectedRepository.status !== "ready" ||
      typeof connectedRepository.listProfilesByOwner !== "function"
    ) {
      throw new Error("Core Intelligence repository is unavailable");
    }

    const selectedRepository: CorePerformanceProfileRepository = {
      status: "ready",
      listProfilesByOwner: (authenticatedOwnerId) =>
        connectedRepository.listProfilesByOwner(
          authenticatedOwnerId,
          selectedCoreId,
        ),
    };
    const state = await loadCoreIntelligencePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: selectedRepository,
      now,
    });

    const acceptedHistoryRepository =
      neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment({
        databaseUrl: requiredEnvironment("DATABASE_URL"),
        databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
        ownerId,
        runtimeRole: "dna_app_runtime",
      });
    const acceptedHistory = await readAcceptedCoreHistory({
      repository: acceptedHistoryRepository,
      ownerId,
      sourceCoreId: selectedCoreId,
    });
    const joinedHistoryRows =
      acceptedHistory.acceptedHistoryRows.filter(isJoinedHistoryRow);

    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.profiles).toEqual([]);
    expect(state.publication ?? null).toBeNull();
    expect(acceptedHistory.acceptedHistoryStatus).toBe("connected");
    expect(acceptedHistory.acceptedHistoryRows.length).toBeGreaterThan(0);
    expect(acceptedHistory.acceptedHistoryRows.length).toBeLessThanOrEqual(
      1_000,
    );
    expect(joinedHistoryRows).toHaveLength(
      acceptedHistory.acceptedHistoryRows.length,
    );
    expect(
      joinedHistoryRows.every(
        ({ payload }) =>
          payload.sourceCoreId === selectedCoreId && payload.mode === "bike",
      ),
    ).toBe(true);
    expect(
      acceptedHistory.acceptedHistoryRows.every(({ rowSha256 }) =>
        /^[a-f0-9]{64}$/u.test(rowSha256),
      ),
    ).toBe(true);

    const wrongOwner = await loadCoreIntelligencePageState({
      authenticatedOwnerId: `${ownerId}-wrong`,
      configuredOwnerId: `${ownerId}-wrong`,
      repository: selectedRepository,
      now,
    });
    expect(wrongOwner.connectionStatus).toBe("read_failed");
    expect(wrongOwner.profiles).toEqual([]);

    const overview = renderToStaticMarkup(
      createElement(CoreIntelligenceWorkspace, {
        connectionStatus: state.connectionStatus,
        esportsConnectionStatus: state.esportsConnectionStatus,
        esportsLastSyncedAt: state.esportsLastSyncedAt,
        esportsProfiles: state.esportsProfiles,
        lastImportedAt: state.lastImportedAt,
        publication: state.publication ?? null,
        profiles: state.profiles,
      }),
    );
    const filtered = renderToStaticMarkup(
      createElement(CoreIntelligenceWorkspace, {
        connectionStatus: state.connectionStatus,
        esportsConnectionStatus: state.esportsConnectionStatus,
        esportsLastSyncedAt: state.esportsLastSyncedAt,
        esportsProfiles: state.esportsProfiles,
        lastImportedAt: state.lastImportedAt,
        publication: state.publication ?? null,
        profiles: state.profiles,
        selectedEvidenceView: "normal",
        selectedMode: "bike",
        selectedDistance: 1_000,
      }),
    );
    expect(overview).not.toContain("Accepted aggregate publication");
    expect(overview).toContain("No commissioned Core evidence");
    expect(filtered).toContain("Normal-racing exact-distance profiles");
    expect(filtered).toContain("No validated normal-racing profiles");

    console.log(
      JSON.stringify({
        status: state.connectionStatus,
        selectedCoreId,
        profileCount: state.profiles.length,
        acceptedHistoryRowCount: acceptedHistory.acceptedHistoryRows.length,
        acceptedHistoryGeneration:
          acceptedHistory.acceptedHistoryGeneration?.generationId ?? null,
        acceptedHistoryObservationSetSha256:
          acceptedHistory.acceptedHistoryGeneration?.observationSetSha256 ??
          null,
        modes: [
          ...new Set(joinedHistoryRows.map(({ payload }) => payload.mode)),
        ],
        distances: joinedHistoryRows.map(
          ({ payload }) => payload.distanceMetres,
        ),
        gates: joinedHistoryRows.map(({ payload }) => payload.gateCount),
        formats: joinedHistoryRows.map(({ payload }) => payload.sourceFormat),
        publishedCellStatuses: joinedHistoryRows.map(
          ({ payload }) => payload.publishedCellStatus,
        ),
        rowSha256: acceptedHistory.acceptedHistoryRows.map(
          ({ rowSha256 }) => rowSha256,
        ),
        publicationProfileCount: state.publication?.profileCount ?? null,
        publicationPayloadSha256: state.publication?.payloadSha256 ?? null,
        sourceVersionSetSha256:
          state.publication?.sourceVersionSetSha256 ?? null,
        lastImportedAt: state.lastImportedAt,
        wrongOwnerRejected: wrongOwner.connectionStatus === "read_failed",
        renderedUnavailableOverview: overview.includes(
          "No commissioned Core evidence",
        ),
        renderedUnavailableProfile: filtered.includes(
          "No validated normal-racing profiles",
        ),
        persistentWritePerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 15_000);
});
