import {
  buildImportWorkspace,
  type ImportWorkspace,
  type PrivateImportBatch,
} from "@/domain/import-workflow";

export type ImportBatchRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listBatchesByOwner: (
        ownerId: string,
      ) => Promise<readonly PrivateImportBatch[]>;
    }>;

export type ImportWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type ImportWorkspacePageState = Readonly<{
  workspace: ImportWorkspace;
  connectionStatus: ImportWorkspaceConnectionStatus;
}>;

export const unavailableImportBatchRepository: ImportBatchRepository =
  Object.freeze({ status: "not_configured" });

function normalizedOwnerId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadImportWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ImportBatchRepository;
    now: Date;
  }>,
): Promise<ImportWorkspacePageState> {
  const authenticatedOwnerId = normalizedOwnerId(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedOwnerId(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      workspace: buildImportWorkspace([], input.now),
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Import workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      workspace: buildImportWorkspace([], input.now),
      connectionStatus: "persistence_not_configured",
    };
  }

  const batches =
    await input.repository.listBatchesByOwner(authenticatedOwnerId);
  return {
    workspace: buildImportWorkspace(batches, input.now),
    connectionStatus: "read_model_connected",
  };
}
