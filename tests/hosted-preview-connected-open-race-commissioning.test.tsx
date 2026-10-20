import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import { loadOpenRacePredictionPageState } from "@/lib/open-race-prediction-page-service";
import { loadOpenRaceWorkspacePageState } from "@/lib/open-race-workspace-service";
import { neonOpenRacePredictionRepositoryFromEnvironment } from "@/lib/neon-open-race-prediction-repository";
import { neonOpenRaceWorkspaceRepositoryFromEnvironment } from "@/lib/neon-open-race-workspace-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";

const connected = process.env.OPEN_RACE_COMMISSIONING_VERIFICATION === "1";
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

describeConnected("hosted Preview Open Race commissioning", () => {
  it("renders bounded frozen owner evidence without publishing or executing a game action", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "OPEN_RACE_COMMISSIONING_VERIFIED_AT",
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
      throw new Error("Open Race Vault repository is unavailable");
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

    const repositoryEnvironment = {
      ...databaseEnvironment,
      authenticatedOwnerId: ownerId,
    };
    const workspaceRepository = neonOpenRaceWorkspaceRepositoryFromEnvironment(
      repositoryEnvironment,
    );
    const predictionRepository =
      neonOpenRacePredictionRepositoryFromEnvironment(repositoryEnvironment);
    expect(workspaceRepository.status).toBe("ready");
    expect(predictionRepository.status).toBe("ready");
    if (
      workspaceRepository.status !== "ready" ||
      predictionRepository.status !== "ready"
    ) {
      throw new Error("Open Race repositories are unavailable");
    }

    const workspaceState = await loadOpenRaceWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: workspaceRepository,
      now,
    });
    expect(workspaceState.connectionStatus).toBe("read_model_connected");
    expect(workspaceState.sessions.length).toBeLessThanOrEqual(24);

    const [snapshots, reconciliations] = await Promise.all([
      predictionRepository.listSnapshotsByOwner(ownerId),
      predictionRepository.listReconciliationsByOwner(ownerId),
    ]);
    expect(snapshots.length).toBeLessThanOrEqual(24);
    expect(reconciliations.length).toBeLessThanOrEqual(48);

    const predictionState = await loadOpenRacePredictionPageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: predictionRepository,
      sessions: workspaceState.sessions,
    });
    expect(predictionState.connectionStatus).toBe("read_model_connected");
    expect(predictionState.evidence.length).toBeLessThanOrEqual(
      workspaceState.sessions.length,
    );

    for (const session of workspaceState.sessions) {
      expect(session.mutationAllowed).toBe(false);
      expect(session.liveGameConnection).toBe(false);
      expect(session.gateCPassed).toBe(false);
      if (session.lock !== null) {
        expect(session.ranking).not.toBeNull();
        expect(
          session.ranking?.rankedCandidates.some(
            ({ coreId }) => coreId === session.lock?.selectedOwnedCoreId,
          ),
        ).toBe(true);
        expect(session.lock.replacementRecommendationAllowed).toBe(false);
        expect(session.lock.coreSwitchAllowed).toBe(false);
        expect(session.lock.raceEntryAllowed).toBe(false);
      }
      if (session.observation !== null || session.comparison !== null) {
        expect(session.lock).not.toBeNull();
      }
      if (session.comparison !== null) {
        expect(session.comparison.frozenPreEntryRanking).toBe(true);
      }
    }

    const requiredTargets = new Set([
      "win",
      "place",
      "blue_star",
      "yellow_star",
    ]);
    for (const snapshot of snapshots) {
      expect(snapshot.frozen).toBe(true);
      expect(snapshot.predictionMutationAllowed).toBe(false);
      expect(snapshot.sameEventEvidenceIncluded).toBe(false);
      expect(snapshot.observedOutcomeIncluded).toBe(false);
      expect(snapshot.fairExOddsIncluded).toBe(false);
      expect(snapshot.reconciliationStatus).toBe("pending");
      for (const coreId of snapshot.field.enteredCoreIds) {
        expect(
          new Set(
            snapshot.predictions
              .filter((prediction) => prediction.coreId === coreId)
              .map(({ target }) => target),
          ),
        ).toEqual(requiredTargets);
      }
    }
    expect(
      reconciliations.every(
        ({ frozenPredictionMutated }) => !frozenPredictionMutated,
      ),
    ).toBe(true);

    const [wrongWorkspaceOwnerRejected, wrongPredictionOwnerRejected] =
      await Promise.all([
        workspaceRepository.listSessionEvidenceByOwner(`${ownerId}-wrong`).then(
          () => false,
          () => true,
        ),
        predictionRepository.listSnapshotsByOwner(`${ownerId}-wrong`).then(
          () => false,
          () => true,
        ),
      ]);
    expect(wrongWorkspaceOwnerRejected).toBe(true);
    expect(wrongPredictionOwnerRejected).toBe(true);

    const rendered = renderToStaticMarkup(
      createElement(OpenRaceWorkspace, {
        sessions: workspaceState.sessions,
        connectionStatus: workspaceState.connectionStatus,
        predictionConnectionStatus: predictionState.connectionStatus,
        predictionEvidence: predictionState.evidence,
      }),
    );
    expect(rendered).toContain("Open Race review evidence connected");
    expect(rendered).toContain("No live game connection");
    expect(rendered).toContain("Gate C not passed");
    if (workspaceState.sessions.length === 0) {
      expect(rendered).toContain("No accepted Open Race session");
      expect(rendered).toContain("No ranking");
      expect(rendered).toContain("entry action is available");
    }

    console.log(
      JSON.stringify({
        status: workspaceState.connectionStatus,
        predictionStatus: predictionState.connectionStatus,
        ownedCoreCount: vaultRead.cores.length,
        selectedOwnedCorePresent: vaultRead.cores.some(
          ({ sourceCoreId }) => sourceCoreId === "10457",
        ),
        ownerSnapshotGeneration:
          "apiSnapshot" in vaultRead
            ? (vaultRead.apiSnapshot?.generationId ?? null)
            : null,
        sessionCount: workspaceState.sessions.length,
        frozenSnapshotCount: snapshots.length,
        reconciliationCount: reconciliations.length,
        availablePredictionSessionCount: predictionState.evidence.filter(
          ({ status }) => status === "available",
        ).length,
        wrongWorkspaceOwnerRejected,
        wrongPredictionOwnerRejected,
        workspaceWritePerformed: false,
        predictionWritePerformed: false,
        walletOrGameActionPerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
        verifiedAt,
      }),
    );
  }, 20_000);
});
