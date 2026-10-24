import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import {
  createDiscoveryProbeRepository,
  loadDiscoveryWorkspacePageState,
} from "@/lib/discovery-workspace-service";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonDiscoveryBenchmarkRepositoryFromEnvironment } from "@/lib/neon-discovery-benchmark-repository";
import { neonDiscoveryLineageHypothesisRepositoryFromEnvironment } from "@/lib/neon-discovery-lineage-hypothesis-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";
import { neonTournamentConfigurationRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-repository";
import { neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment } from "@/lib/neon-active-dna-core-race-history-generation";

const connected = process.env.DISCOVERY_COMMISSIONING_VERIFICATION === "1";
const describeConnected = connected ? describe : describe.skip;

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

const vaultFilters = Object.freeze({
  scope: "vault" as const,
  query: null,
  element: null,
  coreClass: null,
  sex: null,
  fNumber: null,
});

describeConnected("hosted Preview Discovery commissioning", () => {
  it("renders bounded accepted owner evidence without inventing probes", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "DISCOVERY_COMMISSIONING_VERIFIED_AT",
    );
    const now = new Date(verifiedAt);
    expect(now.toISOString()).toBe(verifiedAt);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());

    const databaseEnvironment = {
      databaseUrl: requiredEnvironment("DATABASE_URL"),
      databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
      runtimeRole: "dna_app_runtime",
    };
    const vaultRepository =
      ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment(
        databaseEnvironment,
        verifiedAt,
      );
    expect(vaultRepository.status).toBe("ready");
    if (vaultRepository.status !== "ready") {
      throw new Error("Discovery Vault repository is unavailable");
    }
    const ownedCores = await vaultRepository.listCoresByOwner(
      ownerId,
      vaultFilters,
    );
    expect(ownedCores.length).toBeGreaterThan(0);
    expect(ownedCores.length).toBeLessThanOrEqual(1_000);
    expect(ownedCores.every(({ inMyVault }) => inMyVault)).toBe(true);

    const repository = createDiscoveryProbeRepository({
      vaultRepository: {
        status: "ready",
        listCoresByOwner: async (authenticatedOwnerId) => {
          expect(authenticatedOwnerId).toBe(ownerId);
          return ownedCores;
        },
      },
      performanceRepository:
        neonCorePerformanceProfileRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      lineageRepository:
        neonDiscoveryLineageHypothesisRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      benchmarkRepository:
        neonDiscoveryBenchmarkRepositoryFromEnvironment(databaseEnvironment),
      tournamentRepository:
        neonTournamentConfigurationRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      acceptedHistoryRepository:
        neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment({
          ...databaseEnvironment,
          ownerId,
        }),
      acceptedHistoryNow: now,
    });
    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") {
      throw new Error("Discovery repository is unavailable");
    }

    const evidence = await repository.listCandidateEvidenceByOwner(ownerId);
    expect(evidence.candidates.length).toBeLessThanOrEqual(750);
    expect(evidence.benchmarks.length).toBeLessThanOrEqual(5_000);

    const state = await loadDiscoveryWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: {
        status: "ready",
        listCandidateEvidenceByOwner: async (authenticatedOwnerId) => {
          expect(authenticatedOwnerId).toBe(ownerId);
          return evidence;
        },
      },
      now,
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(
      state.candidates.every(({ mode }) =>
        ["bike", "car", "horse"].includes(mode),
      ),
    ).toBe(true);
    expect(
      state.candidates.every(
        ({ automaticEntryAllowed, automaticStopAllowed }) =>
          !automaticEntryAllowed && !automaticStopAllowed,
      ),
    ).toBe(true);
    expect(
      state.candidates.every(({ directRaceCount }) => directRaceCount < 10),
    ).toBe(true);

    const wrongOwnerRejected = await vaultRepository
      .listCoresByOwner(`${ownerId}-wrong`, vaultFilters)
      .then(
        () => false,
        () => true,
      );
    expect(wrongOwnerRejected).toBe(true);

    const rendered = renderToStaticMarkup(
      createElement(DiscoveryWorkspace, {
        candidates: state.candidates,
        acceptedHistoryCoverage: state.acceptedHistoryCoverage,
        connectionStatus: state.connectionStatus,
        lastImportedAt: state.lastImportedAt,
        publication: state.publication,
      }),
    );
    expect(rendered).toContain("Owned-core Discovery planner connected");
    expect(rendered).toContain("Recommended test probes");
    if (state.candidates.length === 0) {
      expect(rendered).toContain("No current Discovery candidates");
    }

    console.log(
      JSON.stringify({
        status: state.connectionStatus,
        ownedCoreCount: ownedCores.length,
        sourceCandidateCount: evidence.candidates.length,
        renderedCandidateCount: state.candidates.length,
        benchmarkCount: evidence.benchmarks.length,
        benchmarkPublicationRefreshId: state.publication?.refreshId ?? null,
        benchmarkPublicationPayloadSha256:
          state.publication?.payloadSha256 ?? null,
        benchmarkPublicationSourceVersionSetSha256:
          state.publication?.sourceVersionSetSha256 ?? null,
        acceptedHistoryCoverage: state.acceptedHistoryCoverage,
        modes: [...new Set(state.candidates.map(({ mode }) => mode))],
        distances: [
          ...new Set(
            state.candidates.map(({ distanceMetres }) => distanceMetres),
          ),
        ].sort((left, right) => left - right),
        decisionGuidance: state.candidates.reduce<Record<string, number>>(
          (counts, candidate) => ({
            ...counts,
            [candidate.decisionGuidance]:
              (counts[candidate.decisionGuidance] ?? 0) + 1,
          }),
          {},
        ),
        lastImportedAt: state.lastImportedAt,
        wrongOwnerRejected,
        renderedEmptyState: rendered.includes(
          "No current Discovery candidates",
        ),
        persistentWritePerformed: false,
        gameActionPerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 20_000);
});
