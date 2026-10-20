import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import {
  loadCoreIntelligencePageState,
  type CorePerformanceProfileRepository,
} from "@/lib/core-intelligence-workspace-service";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";

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

    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.profiles.length).toBeGreaterThan(0);
    expect(state.profiles.length).toBeLessThanOrEqual(250);
    expect(
      state.profiles.every(({ coreId }) => coreId === selectedCoreId),
    ).toBe(true);
    expect(state.profiles.every(({ mode }) => mode === "bike")).toBe(true);
    expect(state.publication).not.toBeNull();
    expect(state.publication?.sourceVersionSetSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(state.publication?.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);

    const selectedProfile = [...state.profiles].sort(
      (left, right) => left.distance - right.distance,
    )[0]!;
    expect(selectedProfile.distance).toBeGreaterThan(0);
    expect(selectedProfile.raceCount).toBeGreaterThan(0);
    expect(selectedProfile.elapsedTime.bestMilliseconds).toBeGreaterThan(0);
    expect(selectedProfile.elapsedTime.medianMilliseconds).toBeGreaterThan(0);

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
        selectedMode: selectedProfile.mode,
        selectedDistance: selectedProfile.distance,
      }),
    );
    expect(overview).toContain("Accepted aggregate publication");
    expect(overview).toContain(`Core ${selectedCoreId}`);
    expect(filtered).toContain("Normal-racing exact-distance profiles");
    expect(filtered).toContain(
      `${selectedProfile.distance.toLocaleString("en-AU")} m`,
    );
    expect(filtered).toContain(`Core ${selectedCoreId}`);

    console.log(
      JSON.stringify({
        status: state.connectionStatus,
        selectedCoreId,
        profileCount: state.profiles.length,
        modes: [...new Set(state.profiles.map(({ mode }) => mode))],
        distances: state.profiles.map(({ distance }) => distance),
        selectedDistance: selectedProfile.distance,
        selectedRaceCount: selectedProfile.raceCount,
        selectedBestMilliseconds: selectedProfile.elapsedTime.bestMilliseconds,
        selectedMedianMilliseconds:
          selectedProfile.elapsedTime.medianMilliseconds,
        publicationProfileCount: state.publication?.profileCount ?? null,
        publicationPayloadSha256: state.publication?.payloadSha256 ?? null,
        sourceVersionSetSha256:
          state.publication?.sourceVersionSetSha256 ?? null,
        lastImportedAt: state.lastImportedAt,
        wrongOwnerRejected: wrongOwner.connectionStatus === "read_failed",
        renderedOverview: overview.includes("Accepted aggregate publication"),
        renderedFilteredProfile: filtered.includes(`Core ${selectedCoreId}`),
        persistentWritePerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  });
});
