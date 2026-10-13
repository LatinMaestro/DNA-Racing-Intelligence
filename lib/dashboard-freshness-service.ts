import {
  buildImportWorkspace,
  type ImportWorkspace,
} from "@/domain/import-workflow";
import {
  loadImportWorkspacePageState,
  type ImportBatchRepository,
  type ImportWorkspaceConnectionStatus,
} from "@/lib/import-workspace-service";

export type DashboardFreshnessConnectionStatus =
  ImportWorkspaceConnectionStatus | "read_failed";

export type DashboardFreshnessPageState = Readonly<{
  workspace: ImportWorkspace;
  connectionStatus: DashboardFreshnessConnectionStatus;
}>;

function normalizedOwnerId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadDashboardFreshnessPageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ImportBatchRepository;
    now: Date;
  }>,
): Promise<DashboardFreshnessPageState> {
  if (Number.isNaN(input.now.getTime())) throw new Error("now must be valid");

  const authenticatedOwnerId = normalizedOwnerId(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedOwnerId(input.configuredOwnerId);
  if (
    authenticatedOwnerId !== null &&
    configuredOwnerId !== null &&
    authenticatedOwnerId !== configuredOwnerId
  ) {
    throw new Error("Dashboard freshness access denied.");
  }

  if (
    authenticatedOwnerId === null ||
    configuredOwnerId === null ||
    input.repository.status === "not_configured"
  ) {
    return loadImportWorkspacePageState(input);
  }

  try {
    return await loadImportWorkspacePageState(input);
  } catch (error) {
    if (
      error instanceof Error &&
      /(access denied|owner scope denied)/i.test(error.message)
    ) {
      throw error;
    }
    return {
      workspace: buildImportWorkspace([], input.now),
      connectionStatus: "read_failed",
    };
  }
}
