import {
  assertValidProLeagueExactFormatEvidence,
  type ProLeagueExactFormatEvidence,
  type ProLeagueMatchupCore,
  type ProLeagueMatchupVault,
} from "@/domain/pro-league-matchup";
import { elements, coreClasses } from "@/domain/game-rules";
import type {
  ActiveProLeagueEvidenceGeneration,
  NeonProLeagueEvidenceGenerationRepository,
} from "@/lib/neon-pro-league-evidence-generation-repository";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type StoredProfile = ProLeagueExactFormatEvidence &
  Readonly<{ sourceCoreId: string }>;

export type ActiveProLeagueVaultEvidence = Readonly<{
  generation: ActiveProLeagueEvidenceGeneration;
  vault: ProLeagueMatchupVault;
  populationProfileCount: number;
  ownedProfileCount: number;
  unownedProfileCount: number;
  ownedCoreWithoutEvidenceCount: number;
}>;

function identity(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized) || normalized !== value) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Pro League ${label} is outside its bound.`);
  }
  return value;
}

function profileFromPayload(
  payload: Readonly<Record<string, unknown>>,
): StoredProfile {
  const sourceCoreId = identity(payload.sourceCoreId, "evidence Core ID");
  assertValidProLeagueExactFormatEvidence(payload);
  return { ...payload, sourceCoreId } as StoredProfile;
}

function naturalKey(profile: StoredProfile): string {
  return JSON.stringify([
    profile.sourceCoreId,
    profile.raceType.toLowerCase(),
    profile.distanceMetres,
  ]);
}

function sameGeneration(
  left: ActiveProLeagueEvidenceGeneration,
  right: ActiveProLeagueEvidenceGeneration | null,
): boolean {
  return (
    right !== null &&
    right.generationId === left.generationId &&
    right.raceDatasetVersionId === left.raceDatasetVersionId &&
    right.payloadSha256 === left.payloadSha256 &&
    right.profileCount === left.profileCount &&
    right.publishedAt === left.publishedAt
  );
}

export async function loadActiveProLeagueVaultEvidence(
  input: Readonly<{
    ownerId: string;
    vaultId: string;
    vaultDisplayName: string;
    rosteredCoreIds: readonly string[];
    vaultRepository: OwnerVaultCatalogueRepository;
    evidenceRepository: NeonProLeagueEvidenceGenerationRepository;
    pageSize?: number;
  }>,
): Promise<ActiveProLeagueVaultEvidence | null> {
  const ownerId = identity(input.ownerId, "owner identity");
  const vaultId = identity(input.vaultId, "Vault ID");
  const vaultDisplayName = input.vaultDisplayName.trim();
  if (
    vaultDisplayName === "" ||
    vaultDisplayName.length > 256 ||
    CONTROL_CHARACTER_PATTERN.test(vaultDisplayName)
  ) {
    throw new Error("Pro League Vault display name is invalid.");
  }
  if (input.vaultRepository.status !== "ready") {
    throw new Error("Pro League Vault persistence is not configured.");
  }
  const pageSize = boundedInteger(
    input.pageSize ?? 1_000,
    "evidence page size",
    1,
    5_000,
  );
  const rosteredCoreIds = new Set(
    input.rosteredCoreIds.map((coreId) => identity(coreId, "rostered Core ID")),
  );
  if (rosteredCoreIds.size !== input.rosteredCoreIds.length) {
    throw new Error("Pro League roster contains duplicate Core IDs.");
  }

  const generation =
    await input.evidenceRepository.readActiveGeneration(ownerId);
  if (generation === null) return null;
  const cores = await input.vaultRepository.listCoresByOwner(ownerId, {
    scope: "vault",
    query: null,
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  });
  const ownedById = new Map<string, (typeof cores)[number]>();
  for (const core of cores) {
    const coreId = identity(core.sourceCoreId, "owned Core ID");
    if (
      core.displayName.trim() === "" ||
      core.displayName.length > 256 ||
      CONTROL_CHARACTER_PATTERN.test(core.displayName) ||
      !coreClasses.includes(core.coreClass) ||
      !elements.includes(core.element) ||
      (core.sex !== "male" && core.sex !== "female") ||
      !Number.isSafeInteger(core.fNumber) ||
      core.fNumber <= 0
    ) {
      throw new Error("Pro League Vault returned invalid Core metadata.");
    }
    if (!core.inMyVault) {
      throw new Error("Pro League Vault returned a non-owned Core.");
    }
    if (ownedById.has(coreId)) {
      throw new Error("Pro League Vault returned a duplicate Core.");
    }
    ownedById.set(coreId, core);
  }
  for (const coreId of rosteredCoreIds) {
    if (!ownedById.has(coreId)) {
      throw new Error("Pro League roster contains a Core outside My Vault.");
    }
  }

  const profilesByCore = new Map<string, ProLeagueExactFormatEvidence[]>();
  let cursor = -1;
  let populationProfileCount = 0;
  let ownedProfileCount = 0;
  while (populationProfileCount < generation.profileCount) {
    const remaining = generation.profileCount - populationProfileCount;
    const rows = await input.evidenceRepository.listActiveRows(
      ownerId,
      "profile",
      cursor,
      Math.min(pageSize, remaining),
    );
    if (rows.length === 0) {
      throw new Error("Pro League active profile generation ended early.");
    }
    for (const row of rows) {
      if (populationProfileCount >= generation.profileCount) {
        throw new Error("Pro League active profile count is inconsistent.");
      }
      if (
        row.generationId !== generation.generationId ||
        row.ordinal !== populationProfileCount
      ) {
        throw new Error(
          "Pro League active profile generation changed mid-read.",
        );
      }
      const profile = profileFromPayload(row.payload);
      const key = naturalKey(profile);
      if (row.naturalKey !== key) {
        throw new Error("Pro League active profile natural key drifted.");
      }
      if (profile.dataCurrentThrough > generation.evidenceCutoffAt) {
        throw new Error(
          "Pro League active profile exceeds its evidence cutoff.",
        );
      }
      cursor = row.ordinal;
      populationProfileCount += 1;
      if (ownedById.has(profile.sourceCoreId)) {
        const values = profilesByCore.get(profile.sourceCoreId) ?? [];
        values.push(profile);
        profilesByCore.set(profile.sourceCoreId, values);
        ownedProfileCount += 1;
      }
    }
  }
  const extra = await input.evidenceRepository.listActiveRows(
    ownerId,
    "profile",
    cursor,
    1,
  );
  if (extra.length !== 0) {
    throw new Error("Pro League active profile count is inconsistent.");
  }
  const confirmed =
    await input.evidenceRepository.readActiveGeneration(ownerId);
  if (!sameGeneration(generation, confirmed)) {
    throw new Error("Pro League active evidence pointer changed mid-read.");
  }

  const matchupCores: ProLeagueMatchupCore[] = [...ownedById.values()]
    .map((core) => ({
      coreId: core.sourceCoreId,
      displayName: core.displayName,
      element: core.element,
      coreClass: core.coreClass,
      sex: core.sex,
      fNumber: core.fNumber,
      rosterStatus: rosteredCoreIds.has(core.sourceCoreId)
        ? ("rostered" as const)
        : ("not_rostered" as const),
      exactFormatEvidence: Object.freeze(
        [...(profilesByCore.get(core.sourceCoreId) ?? [])].sort(
          (left, right) =>
            left.raceType.localeCompare(right.raceType) ||
            left.distanceMetres - right.distanceMetres,
        ),
      ),
    }))
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return Object.freeze({
    generation,
    vault: Object.freeze({
      vaultId,
      displayName: vaultDisplayName,
      cores: Object.freeze(matchupCores),
    }),
    populationProfileCount,
    ownedProfileCount,
    unownedProfileCount: populationProfileCount - ownedProfileCount,
    ownedCoreWithoutEvidenceCount: matchupCores.filter(
      ({ exactFormatEvidence }) => exactFormatEvidence.length === 0,
    ).length,
  });
}
