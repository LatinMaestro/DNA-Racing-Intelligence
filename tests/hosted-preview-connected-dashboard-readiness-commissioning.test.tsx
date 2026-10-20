import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardReadinessStatus } from "@/components/dashboard-readiness-status";
import { FreshnessStatus } from "@/components/freshness-status";
import { OwnerVaultStatus } from "@/components/owner-vault-status";
import { ReadinessWorkspace } from "@/components/readiness-workspace";
import type {
  HistoricalImportSource,
  ImportWorkspace,
  SourceImportStatus,
} from "@/domain/import-workflow";
import { loadDashboardFreshnessPageState } from "@/lib/dashboard-freshness-service";
import { loadDashboardReadinessPageState } from "@/lib/dashboard-readiness-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";
import { neonReadinessAssessmentRepositoryFromEnvironment } from "@/lib/neon-readiness-assessment-repository";
import { neonTournamentHorseScreeningRepositoryFromEnvironment } from "@/lib/neon-tournament-horse-screening-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";
import { loadOwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";
import { loadReadinessWorkspacePageState } from "@/lib/readiness-workspace-service";
import { loadTournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

const connected = process.env.DASHBOARD_READINESS_COMMISSIONING === "1";
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

function sourceStatus(
  workspace: ImportWorkspace,
  sourceType: HistoricalImportSource,
): SourceImportStatus | null {
  return (
    workspace.sources.find((source) => source.sourceType === sourceType) ?? null
  );
}

describeConnected(
  "hosted Preview Dashboard and Readiness commissioning",
  () => {
    it("renders bounded owner aggregates and truthful freshness/readiness states", async () => {
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const verifiedAt = requiredEnvironment(
        "DASHBOARD_READINESS_COMMISSIONING_VERIFIED_AT",
      );
      const exactHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
      const now = new Date(verifiedAt);
      expect(now.toISOString()).toBe(verifiedAt);
      expect(now.getTime()).toBeLessThanOrEqual(Date.now());
      expect(exactHeadSha).toMatch(/^[a-f0-9]{40}$/);

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
      const importRepository =
        importBatchRepositoryFromEnvironment(databaseEnvironment);
      const readinessRepository =
        neonReadinessAssessmentRepositoryFromEnvironment({
          ...databaseEnvironment,
          authenticatedOwnerId: ownerId,
        });
      const horseRepository =
        neonTournamentHorseScreeningRepositoryFromEnvironment(
          databaseEnvironment,
        );
      expect(vaultRepository.status).toBe("ready");
      expect(importRepository.status).toBe("ready");
      expect(readinessRepository.status).toBe("ready");
      expect(horseRepository.status).toBe("ready");
      if (
        vaultRepository.status !== "ready" ||
        importRepository.status !== "ready" ||
        readinessRepository.status !== "ready" ||
        horseRepository.status !== "ready"
      ) {
        throw new Error("Dashboard and Readiness repositories are unavailable");
      }

      const [vaultState, freshnessState, readinessState, workspaceState] =
        await Promise.all([
          loadOwnerVaultCataloguePageState({
            authenticatedOwnerId: ownerId,
            configuredOwnerId: ownerId,
            repository: vaultRepository,
            filters: { scope: "vault" },
          }),
          loadDashboardFreshnessPageState({
            authenticatedOwnerId: ownerId,
            configuredOwnerId: ownerId,
            repository: importRepository,
            now,
          }),
          loadDashboardReadinessPageState({
            authenticatedOwnerId: ownerId,
            configuredOwnerId: ownerId,
            repository: readinessRepository,
            expectedHeadSha: exactHeadSha,
            now,
          }),
          loadReadinessWorkspacePageState({
            authenticatedOwnerId: ownerId,
            configuredOwnerId: ownerId,
            repository: readinessRepository,
            expectedHeadSha: exactHeadSha,
            now,
          }),
        ]);
      const horseState = await loadTournamentHorseScreeningState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: horseRepository,
        now,
      });

      expect(vaultState.connectionStatus).toBe("connected");
      expect(vaultState.coverage).toBe("accepted_owner_api_snapshot");
      expect(vaultState.cores).toHaveLength(214);
      expect(vaultState.apiSnapshot?.coreCount).toBe(214);
      expect(
        vaultState.cores.some(({ sourceCoreId }) => sourceCoreId === "10457"),
      ).toBe(true);
      expect(freshnessState.connectionStatus).toBe("read_model_connected");
      expect(freshnessState.workspace.recentBatches.length).toBeLessThanOrEqual(
        200,
      );
      expect(workspaceState.connectionStatus).not.toBe(
        "assessment_read_failed",
      );
      expect(readinessState.connectionStatus).not.toBe(
        "assessment_read_failed",
      );
      if (readinessState.connectionStatus === "assessment_connected") {
        expect(readinessState.exactHeadSha).toBe(exactHeadSha);
        expect(readinessState.assessmentSnapshotSha256).toMatch(
          /^[a-f0-9]{64}$/,
        );
        expect(readinessState.readiness?.productionMutationAllowed).toBe(false);
      } else {
        expect([
          "assessment_unavailable",
          "assessment_integrity_failed",
        ]).toContain(readinessState.connectionStatus);
        expect(readinessState.readiness).toBeNull();
      }

      const [wrongImportOwnerRejected, wrongReadinessOwnerRejected] =
        await Promise.all([
          importRepository.listBatchesByOwner(`${ownerId}-wrong`).then(
            () => false,
            () => true,
          ),
          readinessRepository
            .loadLatestAssessmentByOwner(`${ownerId}-wrong`)
            .then(
              () => false,
              () => true,
            ),
        ]);
      expect(wrongImportOwnerRejected).toBe(true);
      expect(wrongReadinessOwnerRejected).toBe(true);

      const dashboardMarkup = renderToStaticMarkup(
        createElement("main", null, [
          createElement(OwnerVaultStatus, { key: "vault", state: vaultState }),
          createElement(FreshnessStatus, {
            key: "core",
            source: "Core",
            connectionStatus: freshnessState.connectionStatus,
            status: sourceStatus(freshnessState.workspace, "core_details"),
          }),
          createElement(FreshnessStatus, {
            key: "race",
            source: "Race",
            connectionStatus: freshnessState.connectionStatus,
            status: sourceStatus(freshnessState.workspace, "race_merge"),
          }),
          createElement(FreshnessStatus, {
            key: "arena",
            source: "Arena",
            connectionStatus: freshnessState.connectionStatus,
            status: sourceStatus(freshnessState.workspace, "current_arena"),
          }),
          createElement(DashboardReadinessStatus, {
            key: "readiness",
            state: readinessState,
          }),
        ]),
      );
      expect(dashboardMarkup).toContain("Owner API snapshot connected");
      expect(dashboardMarkup).toContain("214");
      expect(dashboardMarkup).toContain("Commissioning readiness");
      expect(dashboardMarkup).toContain(
        "This summary is read-only. It cannot deploy, enable Production or change provider settings.",
      );

      const readinessMarkup = renderToStaticMarkup(
        createElement(ReadinessWorkspace, {
          assessmentId: workspaceState.assessmentId,
          assessmentSnapshotSha256: workspaceState.assessmentSnapshotSha256,
          assessedAt: workspaceState.assessedAt,
          assessmentVersion: workspaceState.assessmentVersion,
          exactHeadSha: workspaceState.exactHeadSha,
          publishedAt: workspaceState.publishedAt,
          evidenceCurrentThrough: workspaceState.evidenceCurrentThrough,
          evidenceFreshness: workspaceState.evidenceFreshness,
          readiness: workspaceState.readiness,
          connectionStatus: workspaceState.connectionStatus,
          horseScreeningState: horseState,
        }),
      );
      expect(readinessMarkup).toContain("Readiness");
      expect(readinessMarkup).toContain("cannot enable");

      console.log(
        JSON.stringify({
          status: "dashboard_readiness_connected",
          ownedCoreCount: vaultState.cores.length,
          selectedOwnedCorePresent: vaultState.cores.some(
            ({ sourceCoreId }) => sourceCoreId === "10457",
          ),
          ownerSnapshotGeneration: vaultState.apiSnapshot?.generationId ?? null,
          importConnectionStatus: freshnessState.connectionStatus,
          importBatchCount: freshnessState.workspace.recentBatches.length,
          activeSourceReceipts: freshnessState.workspace.sources.filter(
            ({ activeBatchId }) => activeBatchId !== null,
          ).length,
          dashboardReadinessStatus: readinessState.connectionStatus,
          readinessWorkspaceStatus: workspaceState.connectionStatus,
          readinessAssessmentId: readinessState.assessmentId,
          readinessSnapshotSha256: readinessState.assessmentSnapshotSha256,
          horseScreeningStatus: horseState.connectionStatus,
          wrongImportOwnerRejected,
          wrongReadinessOwnerRejected,
          writePerformed: false,
          providerSettingChanged: false,
          deploymentPerformed: false,
          productionMutationPerformed: false,
          gameActionPerformed: false,
          exactCodeHeadSha: exactHeadSha,
          verifiedAt,
        }),
      );
    }, 30_000);
  },
);
