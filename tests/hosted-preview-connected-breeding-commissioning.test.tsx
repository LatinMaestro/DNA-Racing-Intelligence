import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BreedingWorkspace } from "@/components/breeding-workspace";
import { loadBreedingWorkspacePageState } from "@/lib/breeding-workspace-service";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";

const connected = process.env.BREEDING_COMMISSIONING_VERIFICATION === "1";
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

describeConnected("hosted Preview Breeding commissioning", () => {
  it("renders bounded accepted owner evidence without inventing a pair or executing a splice", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "BREEDING_COMMISSIONING_VERIFIED_AT",
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
      throw new Error("Breeding Vault repository is unavailable");
    }
    const vaultRead = vaultRepository.readCataloguePageByOwner
      ? await vaultRepository.readCataloguePageByOwner(ownerId, vaultFilters)
      : {
          cores: await vaultRepository.listCoresByOwner(ownerId, vaultFilters),
          publication: null,
        };
    expect(vaultRead.cores.length).toBeGreaterThan(0);
    expect(vaultRead.cores.length).toBeLessThanOrEqual(1_000);
    expect(vaultRead.cores.every(({ inMyVault }) => inMyVault)).toBe(true);
    expect(
      vaultRead.cores.some(({ sourceCoreId }) => sourceCoreId === "10457"),
    ).toBe(true);

    const repository =
      neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
        ...databaseEnvironment,
        ownerId,
      });
    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") {
      throw new Error("Breeding ranking repository is unavailable");
    }

    const state = await loadBreedingWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      vaultRepository,
      now,
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.rankings.length).toBeLessThanOrEqual(200);
    for (const ranking of state.rankings) {
      expect(ranking.recommendationAllowed).toBe(false);
      expect(ranking.breedingExecutionAllowed).toBe(false);
      expect(ranking.gateEPassed).toBe(false);
    }

    const wrongOwnerRejected = await repository
      .loadRankingEvidenceByOwner(`${ownerId}-wrong`)
      .then(
        () => false,
        () => true,
      );
    expect(wrongOwnerRejected).toBe(true);

    const rendered = renderToStaticMarkup(
      createElement(BreedingWorkspace, {
        rankings: state.rankings,
        connectionStatus: state.connectionStatus,
        generationId: state.generationId,
        payloadSha256: state.payloadSha256,
        publishedAt: state.publishedAt,
        ...(state.vaultInventory === undefined
          ? {}
          : { vaultInventory: state.vaultInventory }),
      }),
    );
    expect(rendered).toContain("Historical breeding evidence connected");
    expect(rendered).toContain("Breeding execution unavailable");
    expect(rendered).toContain("Gate E not passed");
    expect(rendered).not.toContain("Recommended pair");
    expect(rendered).toContain("Current Vault breeding inputs");
    expect(rendered).toContain("214");
    expect(rendered).toContain("do not prove family compatibility");
    if (state.rankings.length === 0) {
      expect(rendered).toContain("No accepted breeding rankings");
      expect(rendered).toContain("accepted snapshot contains no rankings");
    }

    const rankedCandidates = state.rankings.flatMap(
      ({ eliteUpsideRanking }) => eliteUpsideRanking,
    );
    const heldPairCount = state.rankings.reduce(
      (total, { heldPairs }) => total + heldPairs.length,
      0,
    );
    console.log(
      JSON.stringify({
        status: state.connectionStatus,
        ownedCoreCount: vaultRead.cores.length,
        selectedOwnedCorePresent: vaultRead.cores.some(
          ({ sourceCoreId }) => sourceCoreId === "10457",
        ),
        ownerSnapshotCoverage:
          "coverage" in vaultRead ? (vaultRead.coverage ?? null) : null,
        ownerSnapshotGeneration:
          "apiSnapshot" in vaultRead
            ? (vaultRead.apiSnapshot?.generationId ?? null)
            : null,
        breedingGenerationId: state.generationId,
        breedingPayloadSha256: state.payloadSha256,
        breedingPublishedAt: state.publishedAt,
        vaultInventory: state.vaultInventory,
        rankingCount: state.rankings.length,
        rankedCandidateCount: rankedCandidates.length,
        heldPairCount,
        modes: [...new Set(rankedCandidates.map(({ mode }) => mode))].sort(),
        exactDistancesM: [
          ...new Set(
            rankedCandidates.map(({ exactDistanceM }) => exactDistanceM),
          ),
        ].sort((left, right) => left - right),
        renderedEmptyAcceptedSnapshot:
          state.rankings.length === 0 &&
          rendered.includes("No accepted breeding rankings"),
        wrongOwnerRejected,
        pairRecommendationGenerated: false,
        breedingEconomicWritePerformed: false,
        spliceOrGameActionPerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 20_000);
});
