export type VaultRoleMode = "Bike" | "Car" | "Horse";
export type VaultStrategicRole =
  | "racing_specialist"
  | "discovery_candidate"
  | "maiden_reserve"
  | "breeding_parent"
  | "lineage_anchor";

export type VaultRoleEvidenceInput = Readonly<{
  role: VaultStrategicRole;
  mode: VaultRoleMode | null;
  exactDistanceM: number | null;
  evidenceStatus: "supported" | "review_required";
  strengthBasisPoints: number;
  exceptionalUpsideBasisPoints: number;
}>;

export type VaultRoleCoreInput = Readonly<{
  coreId: string;
  activeOwnership: boolean;
  roles: readonly VaultRoleEvidenceInput[];
}>;

export type VaultRoleDepthInput = Readonly<{
  analysisId: string;
  evaluatedAt: string;
  credibleStrengthThresholdBasisPoints: number;
  exceptionalUpsideThresholdBasisPoints: number;
  minimumAlternativeCount: number;
  cores: readonly VaultRoleCoreInput[];
}>;

export type VaultRoleDepthResult = Readonly<{
  analysisId: string;
  evaluatedAt: string;
  groups: readonly Readonly<{
    roleKey: string;
    role: VaultStrategicRole;
    mode: VaultRoleMode | null;
    exactDistanceM: number | null;
    supportedCoreIds: readonly string[];
    reviewRequiredCoreIds: readonly string[];
    credibleDepth: number;
    depthStatus: "gap" | "single" | "deep";
  }>[];
  coreReviews: readonly Readonly<{
    coreId: string;
    uniqueRoleKeys: readonly string[];
    duplicatedRoleKeys: readonly string[];
    exceptionalRoleKeys: readonly string[];
    redundancyReviewStatus:
      "not_applicable" | "protected" | "eligible_for_review";
    reasons: readonly string[];
    sellOrBurnConclusionAllowed: false;
  }>[];
  duplicateCoverageIsDisposalEvidence: false;
  exceptionalUpsideSuppressedBySaturation: false;
  recommendationAllowed: false;
}>;

const modes: readonly VaultRoleMode[] = ["Bike", "Car", "Horse"];
const roles: readonly VaultStrategicRole[] = [
  "racing_specialist",
  "discovery_candidate",
  "maiden_reserve",
  "breeding_parent",
  "lineage_anchor",
];
const modeDistanceRoles: readonly VaultStrategicRole[] = [
  "racing_specialist",
  "discovery_candidate",
  "maiden_reserve",
];

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function basisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function roleKey(role: VaultRoleEvidenceInput): string {
  return [
    role.role,
    role.mode ?? "all_modes",
    role.exactDistanceM?.toString() ?? "all_distances",
  ].join(":");
}

export function analyseVaultRoleDepth(
  input: VaultRoleDepthInput,
): VaultRoleDepthResult {
  const analysisId = required(input.analysisId, "Analysis ID");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  basisPoints(
    input.credibleStrengthThresholdBasisPoints,
    "Credible-strength threshold",
  );
  basisPoints(
    input.exceptionalUpsideThresholdBasisPoints,
    "Exceptional-upside threshold",
  );
  if (
    !Number.isSafeInteger(input.minimumAlternativeCount) ||
    input.minimumAlternativeCount < 1
  ) {
    throw new Error("Minimum alternative count must be a positive integer.");
  }

  const coreIds = input.cores.map(({ coreId }) => required(coreId, "Core ID"));
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error("Core IDs must be unique.");
  }

  const normalized = input.cores.map((core) => {
    const coreId = required(core.coreId, "Core ID");
    const keys = new Set<string>();
    const normalizedRoles = core.roles.map((role) => {
      if (!roles.includes(role.role)) {
        throw new Error(`Strategic role is invalid for ${coreId}.`);
      }
      if (!["supported", "review_required"].includes(role.evidenceStatus)) {
        throw new Error(`Role evidence status is invalid for ${coreId}.`);
      }
      if (modeDistanceRoles.includes(role.role)) {
        if (role.mode === null || !modes.includes(role.mode)) {
          throw new Error(`${role.role} requires a valid mode.`);
        }
        if (
          role.exactDistanceM === null ||
          !Number.isSafeInteger(role.exactDistanceM) ||
          role.exactDistanceM <= 0
        ) {
          throw new Error(`${role.role} requires a positive exact distance.`);
        }
      } else if (role.mode !== null || role.exactDistanceM !== null) {
        throw new Error(
          `${role.role} must remain a whole-core role without mode or distance.`,
        );
      }
      basisPoints(role.strengthBasisPoints, `Role strength for ${coreId}`);
      basisPoints(
        role.exceptionalUpsideBasisPoints,
        `Exceptional upside for ${coreId}`,
      );
      const key = roleKey(role);
      if (keys.has(key)) {
        throw new Error(`Role keys must be unique within ${coreId}.`);
      }
      keys.add(key);
      return { ...role, key };
    });
    return { ...core, coreId, roles: normalizedRoles };
  });

  type NormalizedRole = (typeof normalized)[number]["roles"][number];
  const grouped = new Map<
    string,
    {
      role: NormalizedRole;
      entries: { coreId: string; role: NormalizedRole }[];
    }
  >();
  for (const core of normalized) {
    if (!core.activeOwnership) continue;
    for (const role of core.roles) {
      const existing = grouped.get(role.key) ?? { role, entries: [] };
      existing.entries.push({ coreId: core.coreId, role });
      grouped.set(role.key, existing);
    }
  }

  const groups = [...grouped.entries()]
    .map(([key, group]) => {
      const supported = group.entries
        .filter(({ role }) => role.evidenceStatus === "supported")
        .map(({ coreId }) => coreId)
        .sort();
      const reviewRequired = group.entries
        .filter(({ role }) => role.evidenceStatus === "review_required")
        .map(({ coreId }) => coreId)
        .sort();
      const credibleDepth = group.entries.filter(
        ({ role }) =>
          role.evidenceStatus === "supported" &&
          role.strengthBasisPoints >=
            input.credibleStrengthThresholdBasisPoints,
      ).length;
      return {
        roleKey: key,
        role: group.role.role,
        mode: group.role.mode,
        exactDistanceM: group.role.exactDistanceM,
        supportedCoreIds: supported,
        reviewRequiredCoreIds: reviewRequired,
        credibleDepth,
        depthStatus:
          credibleDepth === 0
            ? ("gap" as const)
            : credibleDepth === 1
              ? ("single" as const)
              : ("deep" as const),
      };
    })
    .sort((left, right) => left.roleKey.localeCompare(right.roleKey));
  const groupByKey = new Map(groups.map((group) => [group.roleKey, group]));

  const coreReviews = normalized
    .map((core) => {
      if (!core.activeOwnership) {
        return {
          coreId: core.coreId,
          uniqueRoleKeys: [],
          duplicatedRoleKeys: [],
          exceptionalRoleKeys: [],
          redundancyReviewStatus: "not_applicable" as const,
          reasons: ["Core is not confirmed in the active Vault."],
          sellOrBurnConclusionAllowed: false as const,
        };
      }
      const supported = core.roles.filter(
        ({ evidenceStatus }) => evidenceStatus === "supported",
      );
      const uniqueRoleKeys = supported
        .filter(({ key }) => (groupByKey.get(key)?.credibleDepth ?? 0) <= 1)
        .map(({ key }) => key)
        .sort();
      const duplicatedRoleKeys = supported
        .filter(
          ({ key }) =>
            (groupByKey.get(key)?.credibleDepth ?? 0) >=
            input.minimumAlternativeCount + 1,
        )
        .map(({ key }) => key)
        .sort();
      const exceptionalRoleKeys = supported
        .filter(
          ({ exceptionalUpsideBasisPoints }) =>
            exceptionalUpsideBasisPoints >=
            input.exceptionalUpsideThresholdBasisPoints,
        )
        .map(({ key }) => key)
        .sort();
      const unresolved = core.roles.some(
        ({ evidenceStatus }) => evidenceStatus === "review_required",
      );
      const protectedRole = supported.some(
        ({ role }) => role === "maiden_reserve" || role === "lineage_anchor",
      );
      const allSupportedRolesDuplicated =
        supported.length > 0 &&
        supported.every(({ key }) => duplicatedRoleKeys.includes(key));
      const eligibleForReview =
        allSupportedRolesDuplicated &&
        exceptionalRoleKeys.length === 0 &&
        !unresolved &&
        !protectedRole;
      const reasons: string[] = [];
      if (uniqueRoleKeys.length > 0) {
        reasons.push("Core supplies at least one unique or single-depth role.");
      }
      if (exceptionalRoleKeys.length > 0) {
        reasons.push(
          "Exceptional upside is protected regardless of role depth.",
        );
      }
      if (protectedRole) {
        reasons.push("Maiden reserve or lineage-anchor value is protected.");
      }
      if (unresolved)
        reasons.push("At least one role remains review-required.");
      if (eligibleForReview) {
        reasons.push(
          "All supported roles have the configured number of credible alternatives.",
        );
      }
      return {
        coreId: core.coreId,
        uniqueRoleKeys,
        duplicatedRoleKeys,
        exceptionalRoleKeys,
        redundancyReviewStatus: eligibleForReview
          ? ("eligible_for_review" as const)
          : ("protected" as const),
        reasons,
        sellOrBurnConclusionAllowed: false as const,
      };
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return {
    analysisId,
    evaluatedAt,
    groups,
    coreReviews,
    duplicateCoverageIsDisposalEvidence: false,
    exceptionalUpsideSuppressedBySaturation: false,
    recommendationAllowed: false,
  };
}
