import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaidenWorkspace } from "@/components/maiden-workspace";
import { loadMaidenWorkspacePageState } from "@/lib/maiden-workspace-service";
import { neonMaidenAllocationRepositoryFromEnvironment } from "@/lib/neon-maiden-allocation-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";

const connected = process.env.MAIDEN_COMMISSIONING_VERIFICATION === "1";
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

describeConnected("hosted Preview Maiden commissioning", () => {
  it("renders bounded owner evidence without inventing Maiden eligibility or commitment", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment("MAIDEN_COMMISSIONING_VERIFIED_AT");
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
      throw new Error("Maiden Vault repository is unavailable");
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

    const repository = neonMaidenAllocationRepositoryFromEnvironment({
      ...databaseEnvironment,
      authenticatedOwnerId: ownerId,
    });
    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") {
      throw new Error("Maiden allocation repository is unavailable");
    }

    const state = await loadMaidenWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      vaultRepository,
      now,
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.eligibilitySummary?.ownedCoreCount).toBe(
      vaultRead.cores.length,
    );
    expect(state.eligibilitySummary?.unknownEligibilityCount).toBe(
      vaultRead.cores.filter(({ meEligible }) => meEligible === null).length,
    );
    if (state.allocation !== null) {
      expect(state.allocation.actionableRecommendationAllowed).toBe(false);
      expect(state.allocation.maidenCommitmentAllowed).toBe(false);
      expect(state.allocation.automaticEntryAllowed).toBe(false);
      expect(
        state.allocation.candidates.every(({ mode }) =>
          ["bike", "car", "horse"].includes(mode),
        ),
      ).toBe(true);
    }

    const wrongOwnerRejected = await repository
      .loadAllocationEvidenceByOwner(`${ownerId}-wrong`)
      .then(
        () => false,
        () => true,
      );
    expect(wrongOwnerRejected).toBe(true);

    const rendered = renderToStaticMarkup(
      createElement(MaidenWorkspace, {
        allocation: state.allocation,
        connectionStatus: state.connectionStatus,
        eligibilitySummary: state.eligibilitySummary ?? null,
        lastImportedAt: state.lastImportedAt,
        materializedAt: state.materializedAt,
        snapshotSha256: state.snapshotSha256,
        sourceEvidenceSha256: state.sourceEvidenceSha256,
      }),
    );
    expect(rendered).toContain("Current Maiden review evidence connected");
    expect(rendered).toContain("Current Vault Maiden eligibility");
    expect(rendered).toContain("Unknown means the accepted owner snapshot");
    expect(rendered).toContain("Maiden commitment unavailable");
    if (state.allocation === null) {
      expect(rendered).toContain("No accepted Maiden evidence");
      expect(rendered).toContain("does not mean no cores are Maiden eligible");
    }

    console.log(
      JSON.stringify({
        status: state.connectionStatus,
        ownedCoreCount: vaultRead.cores.length,
        ownerSnapshotCoverage:
          "coverage" in vaultRead ? (vaultRead.coverage ?? null) : null,
        ownerSnapshotGeneration:
          "apiSnapshot" in vaultRead
            ? (vaultRead.apiSnapshot?.generationId ?? null)
            : null,
        knownMaidenEligibleCount: vaultRead.cores.filter(
          ({ meEligible }) => meEligible === true,
        ).length,
        unknownMaidenEligibilityCount: vaultRead.cores.filter(
          ({ meEligible }) => meEligible === null,
        ).length,
        allocationEvidencePresent: state.allocation !== null,
        candidateCount: state.allocation?.candidates.length ?? 0,
        assignmentCount: state.allocation?.assignments.length ?? 0,
        sourceEvidenceSha256: state.sourceEvidenceSha256,
        snapshotSha256: state.snapshotSha256,
        lastImportedAt: state.lastImportedAt,
        wrongOwnerRejected,
        renderedUnavailable: rendered.includes("No accepted Maiden evidence"),
        entitlementMutationPerformed: false,
        gameActionPerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 20_000);
});
