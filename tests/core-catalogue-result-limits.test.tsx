import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OwnerVaultWorkspace } from "@/components/owner-vault-workspace";
import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import {
  OWNER_CORE_CATALOGUE_LIST_LIMIT,
  OWNER_VAULT_LIST_LIMIT,
  normalizeOwnerVaultCatalogueFilters,
  type OwnerVaultCatalogueCore,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";
import type { SearchCorePageState } from "@/lib/search-core-service";

vi.mock("@/app/(private)/vault/actions", () => ({
  updateVaultCoreFormAction: async () => "updated",
}));

function core(index: number): OwnerVaultCatalogueCore {
  return {
    sourceCoreId: `synthetic-core-${index}`,
    displayName: `Synthetic Core ${index}`,
    coreClass: "Genesis",
    element: "Fire",
    fNumber: 1,
    sex: "female",
    inMyVault: true,
    meEligible: false,
    version: 0,
    updatedAt: null,
  };
}

function cores(count: number): readonly OwnerVaultCatalogueCore[] {
  return Array.from({ length: count }, (_, index) => core(index));
}

function vaultState(
  scope: "vault" | "catalogue",
  count: number,
): OwnerVaultCataloguePageState {
  return {
    connectionStatus: "connected",
    filters: normalizeOwnerVaultCatalogueFilters({ scope }),
    cores: cores(count),
  };
}

function searchState(count: number): SearchCorePageState {
  return {
    connectionStatus: "connected",
    query: "Synthetic",
    results: cores(count),
    selectedCore: null,
    performanceStatus: "not_connected",
    performanceProfiles: [],
    performanceLastImportedAt: null,
    archiveHistoryStatus: "not_connected",
    archiveHistoryVersionCount: 0,
    archiveHistoryPartitionCount: 0,
    archiveHistoryRowCount: 0,
  };
}

describe("bounded private Core catalogue results", () => {
  it("discloses the game-wide catalogue cap", () => {
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={searchState(OWNER_CORE_CATALOGUE_LIST_LIMIT)}
      />,
    );

    expect(html).toContain("50 cores shown");
    expect(html).toContain("50-core");
    expect(html).toContain("result limit.");
    expect(html).toContain("not a verified count of");
    expect(html).toContain("More cores may match.");
    expect(html).toContain("search by");
    expect(html).toContain("exact Core ID.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("50 matching cores");
  });

  it("omits cap warnings below the search limit or without identity", () => {
    const below = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={searchState(OWNER_CORE_CATALOGUE_LIST_LIMIT - 1)}
      />,
    );
    expect(below).toContain("49 cores shown");
    expect(below).not.toContain("More cores may match.");
    const unconnected = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={{
          ...searchState(0),
          connectionStatus: "identity_not_connected",
        }}
      />,
    );
    expect(unconnected).toContain("Core catalogue not connected");
    expect(unconnected).not.toContain("result limit.");
  });

  it("discloses the separate add-to-Vault catalogue cap", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultWorkspace
        state={vaultState("catalogue", OWNER_CORE_CATALOGUE_LIST_LIMIT)}
      />,
    );
    expect(html).toContain("50 cores shown");
    expect(html).toContain("Core catalogue");
    expect(html).toContain("50-core result limit");
    expect(html).toContain("not verified totals");
    expect(html).toContain('role="status"');
  });

  it("discloses the different 500-result My Vault bound", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultWorkspace
        state={vaultState("vault", OWNER_VAULT_LIST_LIMIT)}
      />,
    );
    expect(html).toContain("500 cores shown");
    expect(html).toContain("My Vault");
    expect(html).toContain("500-core result limit");
    expect(html).toContain("additional matching");
    expect(html).not.toContain("50-core result limit");
  });

  it("omits cap warnings below the Vault limit or when disconnected", () => {
    const below = renderToStaticMarkup(
      <OwnerVaultWorkspace state={vaultState("vault", 1)} />,
    );
    expect(below).toContain("1 core shown");
    expect(below).not.toContain("result limit");

    const unconnected = renderToStaticMarkup(
      <OwnerVaultWorkspace
        state={{
          ...vaultState("vault", 0),
          connectionStatus: "identity_not_connected",
        }}
      />,
    );
    expect(unconnected).toContain("Vault data not connected");
    expect(unconnected).not.toContain("result limit");
  });
});
