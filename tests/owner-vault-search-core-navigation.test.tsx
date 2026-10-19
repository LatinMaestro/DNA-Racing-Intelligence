import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OwnerVaultWorkspace } from "@/components/owner-vault-workspace";
import type { OwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

vi.mock("@/app/(private)/vault/actions", () => ({
  updateVaultCoreFormAction: async () => "updated",
}));

const connectedState: OwnerVaultCataloguePageState = {
  connectionStatus: "connected",
  filters: {
    scope: "catalogue",
    query: null,
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  },
  cores: [
    {
      sourceCoreId: "core-7",
      displayName: "Seven",
      coreClass: "Genesis",
      element: "Fire",
      fNumber: 2,
      sex: "female",
      inMyVault: true,
      meEligible: true,
      version: 1,
      updatedAt: "2026-08-11T01:00:00.000Z",
    },
    {
      sourceCoreId: "core:8",
      displayName: "Eight",
      coreClass: "Freak",
      element: "Earth",
      fNumber: 4,
      sex: "male",
      inMyVault: false,
      meEligible: false,
      version: 0,
      updatedAt: null,
    },
  ],
};

describe("My Vault to existing Search Core navigation", () => {
  it("links both Vault cards to their selected Core evidence", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultWorkspace state={connectedState} />,
    );

    const evidenceLinks = html.match(/href="\/search-core\?[^"]+"/g) ?? [];
    expect(evidenceLinks).toEqual([
      'href="/search-core?q=core-7&amp;coreId=core-7"',
      'href="/search-core?q=core%3A8&amp;coreId=core%3A8"',
    ]);
    expect(html.match(/View race evidence/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Compact Vault roster"');
    expect(html).toContain('href="#vault-core-core%3A8"');
    expect(html).toContain('id="vault-core-core:8"');
    expect(html).toContain("ME eligible");
    expect(html).toContain('aria-current="page" href="/vault?scope=catalogue"');
    expect(html).toContain("In My Vault");
    expect(html).toContain("Not in My Vault");
  });

  it("does not expose a Core evidence link without a connected Vault", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultWorkspace
        state={{
          ...connectedState,
          connectionStatus: "identity_not_connected",
          cores: [],
        }}
      />,
    );

    expect(html).not.toContain("View race evidence");
    expect(html).toContain("Vault data not connected");
  });

  it.each([
    ["read_failed", "Vault records temporarily unavailable"],
    ["integrity_failed", "Vault records failed validation"],
  ] as const)(
    "renders the %s state without rows or controls",
    (status, copy) => {
      const html = renderToStaticMarkup(
        <OwnerVaultWorkspace
          state={{ ...connectedState, connectionStatus: status, cores: [] }}
        />,
      );

      expect(html).toContain(copy);
      expect(html).toContain("withheld");
      expect(html).not.toContain("View race evidence");
      expect(html).not.toContain("In My Vault");
    },
  );
});
