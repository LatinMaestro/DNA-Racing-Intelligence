import type {
  OwnerVaultCatalogueCore,
  OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";
import type { ActiveSelectedDnaCoreRaceHistoryReadRepository } from "@/lib/neon-active-dna-core-race-history-generation";
import {
  readAcceptedCoreHistory,
  type AcceptedCoreHistoryRead,
} from "@/lib/search-core-service";

export type OwnerVaultSelectedHistory = Readonly<{
  selectionRequested: boolean;
  selectedCore: OwnerVaultCatalogueCore | null;
  acceptedHistory: AcceptedCoreHistoryRead | null;
}>;

/**
 * A single explicit selection, never a scan of the Vault. Read history only
 * after the authenticated owner has a matching owned Core in the validated
 * catalogue. The existing Search Core reader pins source generation/hash.
 */
export async function loadOwnerVaultSelectedHistory(input: Readonly<{
  catalogue: OwnerVaultCataloguePageState;
  selectedCoreId?: unknown;
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  acceptedHistoryRepository: ActiveSelectedDnaCoreRaceHistoryReadRepository | null;
}>): Promise<OwnerVaultSelectedHistory> {
  const raw = input.selectedCoreId;
  if (raw === undefined || raw === null || raw === "") {
    return { selectionRequested: false, selectedCore: null, acceptedHistory: null };
  }
  if (
    typeof raw !== "string" ||
    raw.trim() !== raw ||
    raw.length > 256 ||
    raw.length === 0
  ) {
    throw new Error("Selected Vault Core ID is invalid.");
  }
  if (
    input.catalogue.connectionStatus !== "connected" ||
    input.authenticatedOwnerId === null ||
    input.configuredOwnerId === null
  ) {
    return { selectionRequested: true, selectedCore: null, acceptedHistory: null };
  }
  if (input.authenticatedOwnerId !== input.configuredOwnerId) {
    throw new Error("Selected Vault Core access denied.");
  }
  const selectedCore =
    input.catalogue.cores.find(
      (core) => core.inMyVault && core.sourceCoreId === raw,
    ) ?? null;
  if (selectedCore === null) {
    return { selectionRequested: true, selectedCore: null, acceptedHistory: null };
  }
  return {
    selectionRequested: true,
    selectedCore,
    acceptedHistory: await readAcceptedCoreHistory({
      repository: input.acceptedHistoryRepository,
      ownerId: input.authenticatedOwnerId,
      sourceCoreId: selectedCore.sourceCoreId,
    }),
  };
}
