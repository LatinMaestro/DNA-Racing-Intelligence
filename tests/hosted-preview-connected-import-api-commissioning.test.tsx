import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImportWorkspacePanel } from "@/components/import-workspace";
import { loadImportWorkspacePageState } from "@/lib/import-workspace-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";
import { neonImportAggregateRetryRepositoryFromEnvironment } from "@/lib/neon-import-aggregate-retry-repository";
import { neonImportRollbackRepositoryFromEnvironment } from "@/lib/neon-import-rollback-repository";

const connected = process.env.IMPORT_API_COMMISSIONING === "1";
const describeConnected = connected ? describe : describe.skip;
const absentBatchId = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const absentRefreshId = "ffffffff-ffff-4fff-8fff-fffffffffff2";

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

describeConnected("hosted Preview Import/API commissioning", () => {
  it("renders accepted import truth and proves non-mutating recovery boundaries", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "IMPORT_API_COMMISSIONING_VERIFIED_AT",
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
    const importRepository =
      importBatchRepositoryFromEnvironment(databaseEnvironment);
    const rollbackRepository =
      neonImportRollbackRepositoryFromEnvironment(databaseEnvironment);
    const aggregateRetryRepository =
      neonImportAggregateRetryRepositoryFromEnvironment(databaseEnvironment);
    expect(importRepository.status).toBe("ready");
    expect(rollbackRepository.status).toBe("ready");
    expect(aggregateRetryRepository).not.toBeNull();
    if (
      importRepository.status !== "ready" ||
      rollbackRepository.status !== "ready" ||
      aggregateRetryRepository === null
    ) {
      throw new Error("Import/API repositories are unavailable");
    }

    const state = await loadImportWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: importRepository,
      now,
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.workspace.recentBatches.length).toBeLessThanOrEqual(200);

    const [missingRollback, missingRetry] = await Promise.all([
      rollbackRepository.rollbackActiveSourceVersion({
        ownerId,
        batchId: absentBatchId,
        reason: "Verify missing rollback remains non-mutating.",
        idempotencyKey: `commissioning:${exactHeadSha.slice(0, 16)}:rollback`,
        requestedAt: verifiedAt,
      }),
      aggregateRetryRepository.reserveRetry({
        ownerId,
        failedRefreshId: absentRefreshId,
        reason: "Verify missing refresh retry remains non-mutating.",
        idempotencyKey: `commissioning:${exactHeadSha.slice(0, 16)}:retry`,
        requestedAt: verifiedAt,
      }),
    ]);
    expect(missingRollback).toEqual({ status: "not_found" });
    expect(missingRetry).toEqual({ status: "not_found" });

    const [
      wrongImportOwnerRejected,
      wrongRollbackOwnerRejected,
      wrongRetryOwnerRejected,
    ] = await Promise.all([
      importRepository.listBatchesByOwner(`${ownerId}-wrong`).then(
        () => false,
        () => true,
      ),
      rollbackRepository
        .rollbackActiveSourceVersion({
          ownerId: `${ownerId}-wrong`,
          batchId: absentBatchId,
          reason: "Verify wrong-owner rollback remains rejected.",
          idempotencyKey: `commissioning:${exactHeadSha.slice(0, 16)}:wrong-rollback`,
          requestedAt: verifiedAt,
        })
        .then(
          () => false,
          () => true,
        ),
      aggregateRetryRepository
        .reserveRetry({
          ownerId: `${ownerId}-wrong`,
          failedRefreshId: absentRefreshId,
          reason: "Verify wrong-owner retry remains rejected.",
          idempotencyKey: `commissioning:${exactHeadSha.slice(0, 16)}:wrong-retry`,
          requestedAt: verifiedAt,
        })
        .then(
          () => false,
          () => true,
        ),
    ]);
    expect(wrongImportOwnerRejected).toBe(true);
    expect(wrongRollbackOwnerRejected).toBe(true);
    expect(wrongRetryOwnerRejected).toBe(true);

    const markup = renderToStaticMarkup(
      createElement(ImportWorkspacePanel, {
        workspace: state.workspace,
        connectionStatus: state.connectionStatus,
        rollbackActionStatus: "ready",
        aggregateRetryActionStatus: "ready",
      }),
    );
    expect(markup).toContain("Imports &amp; recovery");
    expect(markup).toContain("Historical status connected");
    if (state.workspace.recentBatches.length === 0) {
      expect(markup).toContain("No private import has been accepted");
    }

    console.log(
      JSON.stringify({
        status: "import_api_connected",
        importConnectionStatus: state.connectionStatus,
        importBatchCount: state.workspace.recentBatches.length,
        activeSourceCount: state.workspace.sources.filter(
          ({ activeBatchId }) => activeBatchId !== null,
        ).length,
        recoveryQueueCount: state.workspace.recoveryQueue.length,
        missingRollbackStatus: missingRollback.status,
        missingRetryStatus: missingRetry.status,
        wrongImportOwnerRejected,
        wrongRollbackOwnerRejected,
        wrongRetryOwnerRejected,
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
});
