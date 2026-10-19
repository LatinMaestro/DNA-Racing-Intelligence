import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OwnerVaultStatus } from "@/components/owner-vault-status";
import {
  OWNER_VAULT_LIST_LIMIT,
  normalizeOwnerVaultCatalogueFilters,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

function state(count: number): OwnerVaultCataloguePageState {
  return {
    connectionStatus: "connected",
    filters: normalizeOwnerVaultCatalogueFilters({ scope: "vault" }),
    cores: Array.from({ length: count }, (_, index) => ({
      sourceCoreId: "synthetic-vault-core-" + index,
      displayName: "Synthetic Core " + index,
      coreClass: "Genesis" as const,
      element: "Fire" as const,
      fNumber: 1,
      sex: "female" as const,
      inMyVault: true,
      meEligible: index % 2 === 0,
      version: 0,
      updatedAt: null,
    })),
  };
}

describe("Dashboard owner-maintained Vault counts", () => {
  it("labels returned records rather than implying independent game totals", () => {
    const html = renderToStaticMarkup(<OwnerVaultStatus state={state(2)} />);
    expect(html).toContain("Active cores shown");
    expect(html).toContain("ME eligible shown");
    expect(html).toContain(">2</dd>");
    expect(html).toContain(">1</dd>");
    expect(html).not.toContain("list reached its");
  });

  it("discloses the potential truncation at the SQL-backed Vault limit", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultStatus state={state(OWNER_VAULT_LIST_LIMIT)} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("500-core limit");
    expect(html).toContain("not verified totals");
    expect(html).toContain("additional owned cores may be omitted");
    expect(html).toContain(">500</dd>");
    expect(html).toContain(">250</dd>");
  });

  it("does not expose empty registry counts when owner identity is missing", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultStatus
        state={{ ...state(0), connectionStatus: "identity_not_connected" }}
      />,
    );
    expect(html).toContain("Owner setup pending");
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(html).not.toContain("list reached its");
  });

  it.each([
    ["read_failed", "Vault read unavailable", "rather than shown as zero"],
    ["integrity_failed", "Vault validation failed", "failed validation"],
  ] as const)("withholds Dashboard counts for %s", (status, badge, detail) => {
    const html = renderToStaticMarkup(
      <OwnerVaultStatus
        state={{ ...state(0), connectionStatus: status, cores: [] }}
      />,
    );

    expect(html).toContain(badge);
    expect(html).toContain(detail);
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
  });
});
