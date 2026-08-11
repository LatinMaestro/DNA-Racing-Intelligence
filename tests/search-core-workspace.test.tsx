import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import type { OwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

const baseState: OwnerVaultCataloguePageState = {
  connectionStatus: "connected",
  filters: {
    scope: "catalogue",
    query: "Seven",
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  },
  cores: [],
};

function render(state: OwnerVaultCataloguePageState): string {
  return renderToStaticMarkup(<SearchCoreWorkspace state={state} />);
}

describe("Search Core workspace", () => {
  it("keeps game-wide research separate from ownership inference and wallet actions", () => {
    const markup = render(baseState);
    expect(markup).toContain("Search Core");
    expect(markup).toContain("does not connect a wallet");
    expect(markup).toContain("infer current ownership from race history");
    expect(markup).not.toContain("Buy now");
  });

  it("renders the supported Core Details filters and bounded result evidence", () => {
    const markup = render({
      ...baseState,
      cores: [
        {
          sourceCoreId: "core-7",
          displayName: "Seven",
          coreClass: "Genesis",
          element: "Fire",
          fNumber: 2,
          sex: "female",
          inMyVault: false,
          meEligible: false,
          version: 0,
          updatedAt: null,
        },
      ],
    });

    expect(markup).toContain('name="q"');
    expect(markup).toContain('name="element"');
    expect(markup).toContain('name="coreClass"');
    expect(markup).toContain('name="sex"');
    expect(markup).toContain('name="fNumber"');
    expect(markup).toContain("Seven");
    expect(markup).toContain("Core ID core-7");
    expect(markup).toContain("Not in My Vault");
    expect(markup).toContain("Results are bounded to 50");
  });

  it.each([
    ["identity_not_connected", "authorised private owner account"],
    ["persistence_not_configured", "private database runtime"],
  ] as const)("renders the %s connection boundary", (connectionStatus, copy) => {
    const markup = render({ ...baseState, connectionStatus });
    expect(markup).toContain("Search Core is not connected");
    expect(markup).toContain(copy);
  });
});
