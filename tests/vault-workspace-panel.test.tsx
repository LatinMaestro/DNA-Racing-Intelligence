import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VaultWorkspace } from "@/components/vault-workspace";
import type { OwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

const baseState: OwnerVaultCataloguePageState = {
  connectionStatus: "connected",
  filters: {
    scope: "vault",
    query: null,
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  },
  cores: [],
};

function render(state: OwnerVaultCataloguePageState): string {
  return renderToStaticMarkup(<VaultWorkspace state={state} />);
}

describe("Vault workspace presentation", () => {
  it.each([
    ["identity_not_connected", "Owner identity not connected"],
    ["persistence_not_configured", "Private Vault storage not connected"],
    ["connected", "Private Vault connected"],
  ] as const)("renders the %s boundary safely", (connectionStatus, copy) => {
    const markup = render({ ...baseState, connectionStatus });
    expect(markup).toContain(copy);
    expect(markup).toContain("Race results never infer whether a core is currently owned");
    expect(markup).not.toContain("configured-owner");
  });

  it("renders owner filters and current Vault evidence", () => {
    const markup = render({
      ...baseState,
      filters: {
        scope: "vault",
        query: "Seven",
        element: "Fire",
        coreClass: "Genesis",
        sex: "female",
        fNumber: 2,
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
          version: 3,
          updatedAt: "2026-08-11T01:00:00.000Z",
        },
      ],
    });

    expect(markup).toContain('name="query"');
    expect(markup).toContain('name="element"');
    expect(markup).toContain('name="coreClass"');
    expect(markup).toContain('name="sex"');
    expect(markup).toContain('name="fNumber"');
    expect(markup).toContain("Seven");
    expect(markup).toContain("core-7");
    expect(markup).toContain("Fire · Genesis · female · F2");
    expect(markup).toContain("ME eligible");
  });

  it("keeps Search Core separate from an empty owned Vault", () => {
    const markup = render(baseState);
    expect(markup).toContain("Use Search Core");
    expect(markup).toContain("game-wide core that is not currently in My Vault");
  });
});
