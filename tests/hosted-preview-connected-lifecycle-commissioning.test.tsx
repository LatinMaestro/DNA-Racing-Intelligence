import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import { loadLifecycleWorkspacePageState } from "@/lib/lifecycle-workspace-service";
import { neonLifecycleRankingRepositoryFromEnvironment } from "@/lib/neon-lifecycle-ranking-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";

const connected = process.env.LIFECYCLE_COMMISSIONING_VERIFICATION === "1";
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

describeConnected("hosted Preview Lifecycle commissioning", () => {
  it("renders bounded accepted owner evidence without executing sale, burn or ledger actions", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "LIFECYCLE_COMMISSIONING_VERIFIED_AT",
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
      throw new Error("Lifecycle Vault repository is unavailable");
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

    const repository = neonLifecycleRankingRepositoryFromEnvironment({
      ...databaseEnvironment,
      authenticatedOwnerId: ownerId,
    });
    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") {
      throw new Error("Lifecycle ranking repository is unavailable");
    }

    const state = await loadLifecycleWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      vaultRepository,
      now,
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.ranking?.cores.length ?? 0).toBeLessThanOrEqual(1_000);
    expect(state.ranking?.sourceFactsMutated ?? false).toBe(false);
    expect(state.ranking?.noStarEvidenceCanCauseBurn ?? false).toBe(false);
    for (const core of state.ranking?.cores ?? []) {
      expect(core.finalRecommendationAllowed).toBe(false);
      expect(core.saleExecutionAllowed).toBe(false);
      expect(core.burnExecutionAllowed).toBe(false);
      expect(core.ledgerMutationAllowed).toBe(false);
      expect(core.burnCreditUsedInRanking).toBe(false);
      expect(core.saleProfitUsedInRanking).toBe(false);
      if (core.coreClass === "Genesis") {
        expect(core.rankedActions.some(({ action }) => action === "burn")).toBe(
          false,
        );
      }
    }

    const wrongOwnerRejected = await repository
      .loadRankingEvidenceByOwner(`${ownerId}-wrong`)
      .then(
        () => false,
        () => true,
      );
    expect(wrongOwnerRejected).toBe(true);

    const rendered = renderToStaticMarkup(
      createElement(LifecycleWorkspace, {
        ranking: state.ranking,
        publishedAt: state.publishedAt,
        snapshotSha256: state.snapshotSha256,
        connectionStatus: state.connectionStatus,
        ...(state.vaultProtection === undefined
          ? {}
          : { vaultProtection: state.vaultProtection }),
      }),
    );
    expect(rendered).toContain("Historical lifecycle evidence connected");
    expect(rendered).toContain("Sale unavailable");
    expect(rendered).toContain("Burn unavailable");
    expect(rendered).toContain("No final recommendation");
    expect(rendered).not.toContain("Recommended disposal");
    expect(rendered).toContain("Current Vault protection evidence");
    expect(rendered).toContain("Genesis protected");
    expect(rendered).toContain("does not create a lifecycle recommendation");
    if (state.ranking === null || state.ranking.cores.length === 0) {
      expect(rendered).toContain("No accepted lifecycle evidence");
      expect(rendered).toContain("Missing evidence is unavailable");
    }

    const cores = state.ranking?.cores ?? [];
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
        lifecycleRankingId: state.ranking?.rankingId ?? null,
        lifecyclePublishedAt: state.publishedAt,
        lifecycleSnapshotSha256: state.snapshotSha256,
        vaultProtection: state.vaultProtection,
        lifecycleCoreCount: cores.length,
        rankedActionCount: cores.reduce(
          (total, core) => total + core.rankedActions.length,
          0,
        ),
        heldActionCount: cores.reduce(
          (total, core) => total + core.heldActions.length,
          0,
        ),
        renderedEmptyAcceptedSnapshot:
          cores.length === 0 &&
          rendered.includes("No accepted lifecycle evidence"),
        wrongOwnerRejected,
        finalRecommendationGenerated: false,
        saleOrBurnExecuted: false,
        lifecycleEconomicWritePerformed: false,
        walletOrGameActionPerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 20_000);
});
