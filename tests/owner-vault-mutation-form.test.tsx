import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  OwnerVaultMutationForm,
  ownerVaultMutationMessage,
} from "@/components/owner-vault-mutation-form";
import type { OwnerVaultCatalogueCore } from "@/lib/owner-vault-catalogue-service";

vi.mock("@/app/(private)/vault/actions", () => ({
  updateVaultCoreFormAction: async () => "updated",
}));

const core: OwnerVaultCatalogueCore = {
  sourceCoreId: "synthetic-core-7",
  displayName: "Synthetic Seven",
  coreClass: "Genesis",
  element: "Fire",
  fNumber: 2,
  sex: "female",
  inMyVault: true,
  meEligible: true,
  version: 3,
  updatedAt: "2026-08-11T01:00:00.000Z",
};

describe("My Vault mutation feedback", () => {
  it("sends exactly one server-owned operation per form submission", () => {
    const html = renderToStaticMarkup(<OwnerVaultMutationForm core={core} />);
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('name="sourceCoreId"');
    expect(html).toContain('value="synthetic-core-7"');
    expect(html).toContain('name="expectedVersion"');
    expect(html).toContain('value="3"');
    expect(html).toContain('name="operation"');
    expect(html).toContain('value="remove"');
    expect(html).toContain('value="me_off"');
    expect(html).not.toContain('value="add"');
    expect(html).not.toContain('value="me_on"');
    expect(html).not.toContain("Vault change confirmed.");
  });

  it("renders add and Maiden toggle choices with one form", () => {
    const unowned = renderToStaticMarkup(
      <OwnerVaultMutationForm
        core={{ ...core, inMyVault: false, meEligible: false, version: 0 }}
      />,
    );
    expect(unowned.match(/<form /g)).toHaveLength(1);
    expect(unowned).toContain('value="add"');
    expect(unowned).not.toContain('value="remove"');
    const eligibleToggle = renderToStaticMarkup(
      <OwnerVaultMutationForm core={{ ...core, meEligible: false }} />,
    );
    expect(eligibleToggle).toContain('value="me_on"');
    expect(eligibleToggle).not.toContain('value="me_off"');
  });

  it("maps failure outcomes to actionable, privacy-safe feedback", () => {
    expect(ownerVaultMutationMessage("idle")).toBeNull();
    expect(ownerVaultMutationMessage("updated")).toContain("confirmed");
    expect(ownerVaultMutationMessage("conflict")).toContain("Refresh");
    expect(ownerVaultMutationMessage("identity_not_connected")).toContain(
      "authorised owner",
    );
    expect(ownerVaultMutationMessage("persistence_unavailable")).toContain(
      "might have completed",
    );
    expect(ownerVaultMutationMessage("idempotency_conflict")).toContain(
      "Verify",
    );
    for (const status of [
      "invalid_request",
      "core_unavailable",
      "persistence_not_configured",
    ] as const) {
      expect(ownerVaultMutationMessage(status)).toBeTruthy();
    }
    const messages = [
      ownerVaultMutationMessage("updated"),
      ownerVaultMutationMessage("conflict"),
      ownerVaultMutationMessage("persistence_unavailable"),
    ];
    expect(messages.join(" ")).not.toMatch(/postgresql|stack|secret-host/i);
  });

  it("renders no mutation form for an API-only ownership row", () => {
    const html = renderToStaticMarkup(
      <OwnerVaultMutationForm
        core={{
          ...core,
          meEligible: null,
          version: null,
          source: "accepted_owner_api_snapshot",
        }}
      />,
    );
    expect(html).toBe("");
  });
});
