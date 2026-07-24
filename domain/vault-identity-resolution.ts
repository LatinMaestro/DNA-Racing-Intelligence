import type { CoreClass, CoreElement, CoreSex } from "@/domain/source-adapters";

export type VaultIdentityEvidence = Readonly<{
  entryId: string;
  displayName: string;
  coreClass: CoreClass;
  element: CoreElement;
  fNumber: number;
  sex: CoreSex;
  maidenEligible: boolean | null;
  maidenDataStatus: "valid" | "missing" | "invalid";
}>;

export type CoreIdentityRecord = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: CoreElement;
  fNumber: number;
  sex: CoreSex;
}>;

export type PriorVaultIdentityConfirmation = Readonly<{
  identitySignature: string;
  coreId: string;
}>;

export type ResolvedMaidenState =
  "eligible" | "not_eligible" | "unknown" | "invalid";

export type VaultIdentityReviewReason =
  | "unmatched_name"
  | "inconsistent_attributes"
  | "ambiguous_composite"
  | "prior_mapping_missing_core"
  | "prior_mapping_conflict"
  | "duplicate_resolved_core";

export type VaultIdentityResolution = Readonly<{
  entryId: string;
  identitySignature: string;
  ownershipEvidence: "owner_confirmed_snapshot";
  maidenState: ResolvedMaidenState;
  status: "confirmed" | "review_required";
  confirmedCoreId: string | null;
  candidateCoreIds: readonly string[];
  matchMethod: "prior_confirmation" | "exact_composite" | null;
  reviewReason: VaultIdentityReviewReason | null;
}>;

export type VaultIdentityResolutionResult = Readonly<{
  resolutions: readonly VaultIdentityResolution[];
  confirmedCount: number;
  reviewRequiredCount: number;
  maidenCounts: Readonly<Record<ResolvedMaidenState, number>>;
}>;

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${field} is required`);
  return trimmed;
}

function canonicalName(value: string): string {
  return requireNonBlank(value, "displayName")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function identitySignature(
  input: Pick<
    VaultIdentityEvidence,
    "displayName" | "coreClass" | "element" | "fNumber" | "sex"
  >,
): string {
  if (!Number.isSafeInteger(input.fNumber) || input.fNumber <= 0) {
    throw new TypeError("fNumber must be a positive integer");
  }
  return JSON.stringify([
    canonicalName(input.displayName),
    input.coreClass,
    input.element,
    input.fNumber,
    input.sex,
  ]);
}

function sameAttributes(
  vault: VaultIdentityEvidence,
  core: CoreIdentityRecord,
): boolean {
  return (
    vault.coreClass === core.coreClass &&
    vault.element === core.element &&
    vault.fNumber === core.fNumber &&
    vault.sex === core.sex
  );
}

function maidenState(entry: VaultIdentityEvidence): ResolvedMaidenState {
  if (entry.maidenDataStatus === "invalid") return "invalid";
  if (entry.maidenDataStatus === "missing") return "unknown";
  if (entry.maidenEligible === true) return "eligible";
  if (entry.maidenEligible === false) return "not_eligible";
  throw new TypeError("valid Maiden evidence must contain a Boolean value");
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must be unique`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedCoreIds(
  cores: readonly CoreIdentityRecord[],
): readonly string[] {
  return cores.map(({ coreId }) => coreId).sort(compareText);
}

function review(
  entry: VaultIdentityEvidence,
  signature: string,
  reason: VaultIdentityReviewReason,
  candidates: readonly CoreIdentityRecord[],
): VaultIdentityResolution {
  return {
    entryId: entry.entryId,
    identitySignature: signature,
    ownershipEvidence: "owner_confirmed_snapshot",
    maidenState: maidenState(entry),
    status: "review_required",
    confirmedCoreId: null,
    candidateCoreIds: sortedCoreIds(candidates),
    matchMethod: null,
    reviewReason: reason,
  };
}

function confirmed(
  entry: VaultIdentityEvidence,
  signature: string,
  core: CoreIdentityRecord,
  matchMethod: NonNullable<VaultIdentityResolution["matchMethod"]>,
): VaultIdentityResolution {
  return {
    entryId: entry.entryId,
    identitySignature: signature,
    ownershipEvidence: "owner_confirmed_snapshot",
    maidenState: maidenState(entry),
    status: "confirmed",
    confirmedCoreId: core.coreId,
    candidateCoreIds: [core.coreId],
    matchMethod,
    reviewReason: null,
  };
}

export function resolveVaultIdentities(
  input: Readonly<{
    ownershipAssertion: "all_accepted_rows_owned";
    entries: readonly VaultIdentityEvidence[];
    cores: readonly CoreIdentityRecord[];
    priorConfirmations?: readonly PriorVaultIdentityConfirmation[];
  }>,
): VaultIdentityResolutionResult {
  if (input.ownershipAssertion !== "all_accepted_rows_owned") {
    throw new TypeError("Every accepted Vault row must be owner-confirmed");
  }

  assertUnique(
    input.entries.map(({ entryId }) => requireNonBlank(entryId, "entryId")),
    "Vault entryId",
  );
  assertUnique(
    input.cores.map(({ coreId }) => requireNonBlank(coreId, "coreId")),
    "Core Details coreId",
  );

  const coresById = new Map(
    input.cores.map((core) => [core.coreId.trim(), core] as const),
  );
  const coresByName = new Map<string, CoreIdentityRecord[]>();
  for (const core of input.cores) {
    if (!Number.isSafeInteger(core.fNumber) || core.fNumber <= 0) {
      throw new TypeError("Core Details fNumber must be a positive integer");
    }
    const name = canonicalName(core.displayName);
    const named = coresByName.get(name) ?? [];
    named.push(core);
    coresByName.set(name, named);
  }

  const priorConfirmations = input.priorConfirmations ?? [];
  assertUnique(
    priorConfirmations.map(({ identitySignature }) =>
      requireNonBlank(identitySignature, "identitySignature"),
    ),
    "prior identitySignature",
  );
  const priorBySignature = new Map(
    priorConfirmations.map((confirmation) => [
      confirmation.identitySignature,
      confirmation,
    ]),
  );

  let resolutions = input.entries.map((entry): VaultIdentityResolution => {
    const signature = identitySignature(entry);
    const prior = priorBySignature.get(signature);
    if (prior !== undefined) {
      const priorCore = coresById.get(
        requireNonBlank(prior.coreId, "prior coreId"),
      );
      if (priorCore === undefined) {
        return review(entry, signature, "prior_mapping_missing_core", []);
      }
      if (!sameAttributes(entry, priorCore)) {
        return review(entry, signature, "prior_mapping_conflict", [priorCore]);
      }
      return confirmed(entry, signature, priorCore, "prior_confirmation");
    }

    const nameMatches = coresByName.get(canonicalName(entry.displayName)) ?? [];
    if (nameMatches.length === 0) {
      return review(entry, signature, "unmatched_name", []);
    }
    const compositeMatches = nameMatches.filter((core) =>
      sameAttributes(entry, core),
    );
    if (compositeMatches.length === 0) {
      return review(entry, signature, "inconsistent_attributes", nameMatches);
    }
    if (compositeMatches.length > 1) {
      return review(entry, signature, "ambiguous_composite", compositeMatches);
    }
    return confirmed(entry, signature, compositeMatches[0]!, "exact_composite");
  });

  const entryIndexesByCore = new Map<string, number[]>();
  resolutions.forEach((resolution, index) => {
    if (resolution.confirmedCoreId === null) return;
    const indexes = entryIndexesByCore.get(resolution.confirmedCoreId) ?? [];
    indexes.push(index);
    entryIndexesByCore.set(resolution.confirmedCoreId, indexes);
  });
  for (const [coreId, indexes] of entryIndexesByCore) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const current = resolutions[index]!;
      resolutions[index] = {
        ...current,
        status: "review_required",
        confirmedCoreId: null,
        candidateCoreIds: [coreId],
        matchMethod: null,
        reviewReason: "duplicate_resolved_core",
      };
    }
  }

  resolutions = resolutions.sort((left, right) =>
    compareText(left.entryId, right.entryId),
  );
  const maidenCounts: Record<ResolvedMaidenState, number> = {
    eligible: 0,
    not_eligible: 0,
    unknown: 0,
    invalid: 0,
  };
  for (const resolution of resolutions) {
    maidenCounts[resolution.maidenState] += 1;
  }
  const confirmedCount = resolutions.filter(
    ({ status }) => status === "confirmed",
  ).length;

  return {
    resolutions,
    confirmedCount,
    reviewRequiredCount: resolutions.length - confirmedCount,
    maidenCounts,
  };
}
