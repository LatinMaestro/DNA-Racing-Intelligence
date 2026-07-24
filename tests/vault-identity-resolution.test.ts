import { describe, expect, it } from "vitest";
import {
  resolveVaultIdentities,
  type CoreIdentityRecord,
  type VaultIdentityEvidence,
} from "@/domain/vault-identity-resolution";

function core(
  coreId: string,
  displayName: string,
  overrides: Partial<CoreIdentityRecord> = {},
): CoreIdentityRecord {
  return {
    coreId,
    displayName,
    coreClass: "Morphed",
    element: "Fire",
    fNumber: 3,
    sex: "male",
    ...overrides,
  };
}

function vault(
  entryId: string,
  displayName: string,
  overrides: Partial<VaultIdentityEvidence> = {},
): VaultIdentityEvidence {
  return {
    entryId,
    displayName,
    coreClass: "Morphed",
    element: "Fire",
    fNumber: 3,
    sex: "male",
    maidenEligible: false,
    maidenDataStatus: "valid",
    ...overrides,
  };
}

function resolve(
  entries: readonly VaultIdentityEvidence[],
  cores: readonly CoreIdentityRecord[],
  priorConfirmations: readonly {
    identitySignature: string;
    coreId: string;
  }[] = [],
) {
  return resolveVaultIdentities({
    ownershipAssertion: "all_accepted_rows_owned",
    entries,
    cores,
    priorConfirmations,
  });
}

describe("Current Vault deterministic identity resolution", () => {
  it("confirms a unique exact composite and carries ownership and ME separately", () => {
    const result = resolve(
      [
        vault("entry-a", "  Synthetic   Core  ", {
          maidenEligible: true,
        }),
      ],
      [core("core-a", "synthetic core")],
    );

    expect(result).toMatchObject({
      confirmedCount: 1,
      reviewRequiredCount: 0,
      maidenCounts: {
        eligible: 1,
        not_eligible: 0,
        unknown: 0,
        invalid: 0,
      },
    });
    expect(result.resolutions[0]).toMatchObject({
      entryId: "entry-a",
      ownershipEvidence: "owner_confirmed_snapshot",
      maidenState: "eligible",
      status: "confirmed",
      confirmedCoreId: "core-a",
      matchMethod: "exact_composite",
      reviewReason: null,
    });
  });

  it("uses attributes to resolve a reused exact name", () => {
    const result = resolve(
      [vault("entry-water", "Reused Name", { element: "Water", fNumber: 8 })],
      [
        core("core-fire", "Reused Name"),
        core("core-water", "Reused Name", {
          element: "Water",
          fNumber: 8,
        }),
      ],
    );

    expect(result.resolutions[0]).toMatchObject({
      status: "confirmed",
      confirmedCoreId: "core-water",
      candidateCoreIds: ["core-water"],
    });
  });

  it("keeps unmatched, inconsistent and ambiguous rows in review", () => {
    const result = resolve(
      [
        vault("entry-unmatched", "No Candidate"),
        vault("entry-inconsistent", "Attribute Conflict", {
          element: "Water",
        }),
        vault("entry-ambiguous", "Duplicate Composite"),
      ],
      [
        core("core-conflict", "Attribute Conflict"),
        core("core-duplicate-a", "Duplicate Composite"),
        core("core-duplicate-b", "Duplicate Composite"),
      ],
    );

    expect(
      result.resolutions.map(({ entryId, reviewReason, candidateCoreIds }) => ({
        entryId,
        reviewReason,
        candidateCoreIds,
      })),
    ).toEqual([
      {
        entryId: "entry-ambiguous",
        reviewReason: "ambiguous_composite",
        candidateCoreIds: ["core-duplicate-a", "core-duplicate-b"],
      },
      {
        entryId: "entry-inconsistent",
        reviewReason: "inconsistent_attributes",
        candidateCoreIds: ["core-conflict"],
      },
      {
        entryId: "entry-unmatched",
        reviewReason: "unmatched_name",
        candidateCoreIds: [],
      },
    ]);
  });

  it("reuses a prior confirmed signature when the Core Details name changes", () => {
    const initial = resolve(
      [vault("entry-initial", "Original Name")],
      [core("core-a", "Original Name")],
    );
    const signature = initial.resolutions[0]!.identitySignature;

    const refreshed = resolve(
      [vault("entry-refreshed", "Original Name")],
      [core("core-a", "Renamed Core")],
      [{ identitySignature: signature, coreId: "core-a" }],
    );

    expect(refreshed.resolutions[0]).toMatchObject({
      status: "confirmed",
      confirmedCoreId: "core-a",
      matchMethod: "prior_confirmation",
    });
  });

  it("fails closed when a prior mapping is missing or conflicts with attributes", () => {
    const signature = resolve(
      [vault("signature-source", "Original Name")],
      [core("signature-core", "Original Name")],
    ).resolutions[0]!.identitySignature;
    const missing = resolve(
      [vault("entry-missing", "Original Name")],
      [],
      [
        {
          identitySignature: signature,
          coreId: "core-missing",
        },
      ],
    );
    expect(missing.resolutions[0]?.reviewReason).toBe(
      "prior_mapping_missing_core",
    );

    const conflicting = resolve(
      [vault("entry-conflict", "Original Name")],
      [core("core-a", "Renamed Core", { element: "Water" })],
      [
        {
          identitySignature: signature,
          coreId: "core-a",
        },
      ],
    );
    expect(conflicting.resolutions[0]).toMatchObject({
      status: "review_required",
      reviewReason: "prior_mapping_conflict",
      candidateCoreIds: ["core-a"],
    });
  });

  it("fails closed when two Vault rows resolve to one durable core", () => {
    const result = resolve(
      [vault("entry-a", "Same Core"), vault("entry-b", "Same Core")],
      [core("core-a", "Same Core")],
    );

    expect(result.confirmedCount).toBe(0);
    expect(result.resolutions.map(({ reviewReason }) => reviewReason)).toEqual([
      "duplicate_resolved_core",
      "duplicate_resolved_core",
    ]);
  });

  it("is deterministic across source ordering and preserves unknown/invalid ME", () => {
    const entries = [
      vault("entry-b", "Core B", {
        maidenEligible: null,
        maidenDataStatus: "missing",
      }),
      vault("entry-a", "Core A", {
        maidenEligible: null,
        maidenDataStatus: "invalid",
      }),
    ];
    const cores = [core("core-b", "Core B"), core("core-a", "Core A")];

    expect(resolve(entries, cores)).toEqual(
      resolve([...entries].reverse(), [...cores].reverse()),
    );
    expect(resolve(entries, cores).maidenCounts).toEqual({
      eligible: 0,
      not_eligible: 0,
      unknown: 1,
      invalid: 1,
    });
  });

  it("rejects invalid ownership assertions and duplicate identifiers", () => {
    expect(() =>
      resolveVaultIdentities({
        ownershipAssertion:
          "not-confirmed" as unknown as "all_accepted_rows_owned",
        entries: [],
        cores: [],
      }),
    ).toThrow("Every accepted Vault row must be owner-confirmed");

    expect(() =>
      resolve(
        [vault("duplicate", "Core A"), vault("duplicate", "Core B")],
        [core("core-a", "Core A"), core("core-b", "Core B")],
      ),
    ).toThrow("Vault entryId must be unique");
    expect(() =>
      resolve(
        [vault("entry", "Core A")],
        [core("duplicate", "Core A"), core("duplicate", "Core B")],
      ),
    ).toThrow("Core Details coreId must be unique");
  });
});
