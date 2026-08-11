import { describe, expect, it } from "vitest";

import { parseOwnerVaultMutationFormData } from "../lib/owner-vault-form";

function form(
  operation: string,
  sourceCoreId = "core-7",
  expectedVersion = "3",
) {
  const data = new FormData();
  data.set("sourceCoreId", sourceCoreId);
  data.set("expectedVersion", expectedVersion);
  data.set("operation", operation);
  return data;
}

describe("owner Vault form parser", () => {
  it.each([
    ["add", true, false],
    ["remove", false, false],
    ["me_on", true, true],
    ["me_off", true, false],
  ] as const)("derives the server-owned %s state", (operation, inMyVault, meEligible) => {
    const parsed = parseOwnerVaultMutationFormData(form(operation));
    expect(parsed).toMatchObject({
      sourceCoreId: "core-7",
      expectedVersion: 3,
      inMyVault,
      meEligible,
    });
    expect(parsed.idempotencyKey).toMatch(/^vault:[a-f0-9]{64}$/);
  });

  it("produces the same idempotency key for an exact retry", () => {
    expect(parseOwnerVaultMutationFormData(form("me_on"))).toEqual(
      parseOwnerVaultMutationFormData(form("me_on")),
    );
  });

  it.each([
    form("unsupported"),
    form("add", ""),
    form("add", "core-7", "-1"),
  ])("rejects malformed or unsupported form state", (input) => {
    expect(() => parseOwnerVaultMutationFormData(input)).toThrow();
  });

  it("rejects duplicate form controls instead of selecting one", () => {
    const input = form("add");
    input.append("operation", "remove");
    expect(() => parseOwnerVaultMutationFormData(input)).toThrow(
      "Vault operation is invalid.",
    );
  });
});
