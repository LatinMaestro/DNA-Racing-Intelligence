export type BreedingResearchMode = "Bike" | "Car" | "Horse";

export type StarFeatureRelationship =
  "direct_parent" | "grandparent" | "prior_offspring" | "wider_lineage";

export type BreedingStarProfile = Readonly<{
  subjectParentId: string;
  evidenceCoreId: string;
  relationship: StarFeatureRelationship;
  mode: BreedingResearchMode;
  exactDistanceM: number;
  raceCount: number;
  goldReceived: number;
  goldOpportunities: number;
  blueReceived: number;
  blueOpportunities: number;
  strongFieldGoldReceived: number;
  strongFieldGoldOpportunities: number;
  strongFieldBlueReceived: number;
  strongFieldBlueOpportunities: number;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  evidenceStatus: "complete" | "partial" | "invalid";
}>;

export type BreedingStarFeatureInput = Readonly<{
  researchPairId: string;
  parentCoreIds: readonly [string, string];
  breedingAt: string;
  mode: BreedingResearchMode;
  exactDistanceM: number;
  minimumOutlierOpportunities: number;
  populationBenchmarks: Readonly<{
    goldRateBasisPoints: number;
    blueRateBasisPoints: number;
    strongFieldGoldRateBasisPoints: number;
    strongFieldBlueRateBasisPoints: number;
    dataCurrentThrough: string;
  }>;
  profiles: readonly BreedingStarProfile[];
}>;

export type BreedingStarFeatureExclusionReason =
  | "CELL_MISMATCH"
  | "EVIDENCE_NOT_COMPLETE"
  | "EVIDENCE_NOT_CURRENT"
  | "FEATURE_AFTER_BREEDING";

type StarCounts = Readonly<{
  received: number;
  opportunities: number;
  rateBasisPoints: number | null;
}>;

export type BreedingStarFeatureResult = Readonly<{
  researchPairId: string;
  parentCoreIds: readonly [string, string];
  mode: BreedingResearchMode;
  exactDistanceM: number;
  breedingAt: string;
  benchmarkCutoff: string;
  parentFeatures: readonly Readonly<{
    parentCoreId: string;
    directProfile: Readonly<{
      raceCount: number;
      sampleStatus: "hypothesis_only" | "minimally_analytical";
      gold: StarCounts;
      blue: StarCounts;
      strongFieldGold: StarCounts;
      strongFieldBlue: StarCounts;
      dataCurrentThrough: string;
      lastImported: string;
    }> | null;
    lineageProfilesUsed: number;
    lineageGoldOutlierCount: number;
    lineageBlueOutlierCount: number;
    lineageStrongFieldGoldOutlierCount: number;
    lineageStrongFieldBlueOutlierCount: number;
  }>[];
  exclusions: readonly Readonly<{
    evidenceCoreId: string;
    subjectParentId: string;
    relationship: StarFeatureRelationship;
    reasons: readonly BreedingStarFeatureExclusionReason[];
  }>[];
  readyForChronologicalTest: boolean;
  starTraitsAssumedInherited: false;
  offspringQualityPredicted: false;
  recommendationAllowed: false;
  gateEPassed: false;
}>;

const modes: readonly BreedingResearchMode[] = ["Bike", "Car", "Horse"];
const relationships: readonly StarFeatureRelationship[] = [
  "direct_parent",
  "grandparent",
  "prior_offspring",
  "wider_lineage",
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

function nonNegativeSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function basisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function rate(received: number, opportunities: number): number | null {
  if (opportunities === 0) return null;
  return Math.round((received * 10_000) / opportunities);
}

function counts(received: number, opportunities: number): StarCounts {
  return {
    received,
    opportunities,
    rateBasisPoints: rate(received, opportunities),
  };
}

function normalizeProfile(profile: BreedingStarProfile): BreedingStarProfile {
  const subjectParentId = required(
    profile.subjectParentId,
    "Subject parent ID",
  );
  const evidenceCoreId = required(profile.evidenceCoreId, "Evidence core ID");
  if (!relationships.includes(profile.relationship)) {
    throw new Error("Star-feature relationship is invalid.");
  }
  if (!modes.includes(profile.mode)) {
    throw new Error("Star-feature mode is invalid.");
  }
  if (
    !Number.isSafeInteger(profile.exactDistanceM) ||
    profile.exactDistanceM <= 0
  ) {
    throw new Error("Star-feature distance must be a positive safe integer.");
  }
  nonNegativeSafe(profile.raceCount, "Star-feature race count");
  const pairs = [
    [profile.goldReceived, profile.goldOpportunities, "Gold"],
    [profile.blueReceived, profile.blueOpportunities, "Blue"],
    [
      profile.strongFieldGoldReceived,
      profile.strongFieldGoldOpportunities,
      "strong-field Gold",
    ],
    [
      profile.strongFieldBlueReceived,
      profile.strongFieldBlueOpportunities,
      "strong-field Blue",
    ],
  ] as const;
  for (const [received, opportunities, label] of pairs) {
    nonNegativeSafe(received, `${label} received`);
    nonNegativeSafe(opportunities, `${label} opportunities`);
    if (received > opportunities || opportunities > profile.raceCount) {
      throw new Error(`${label} star evidence is internally inconsistent.`);
    }
  }
  if (
    profile.strongFieldGoldOpportunities > profile.goldOpportunities ||
    profile.strongFieldBlueOpportunities > profile.blueOpportunities
  ) {
    throw new Error(
      "Strong-field opportunities must be subsets of overall star opportunities.",
    );
  }
  if (!["current", "ageing", "stale", "unknown"].includes(profile.freshness)) {
    throw new Error("Star-feature freshness is invalid.");
  }
  if (!["complete", "partial", "invalid"].includes(profile.evidenceStatus)) {
    throw new Error("Star-feature evidence status is invalid.");
  }
  const dataCurrentThrough = timestamp(
    profile.dataCurrentThrough,
    "Star-feature data current through",
  );
  const lastImported = timestamp(
    profile.lastImported,
    "Star-feature last imported",
  );
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error("Last imported cannot precede data current through.");
  }
  return {
    ...profile,
    subjectParentId,
    evidenceCoreId,
    dataCurrentThrough,
    lastImported,
  };
}

function isOutlier(
  received: number,
  opportunities: number,
  minimumOpportunities: number,
  benchmarkBasisPoints: number,
): boolean {
  const observed = rate(received, opportunities);
  return (
    observed !== null &&
    opportunities >= minimumOpportunities &&
    observed > benchmarkBasisPoints
  );
}

export function buildBreedingStarFeatures(
  input: BreedingStarFeatureInput,
): BreedingStarFeatureResult {
  const researchPairId = required(input.researchPairId, "Research pair ID");
  const parentCoreIds = input.parentCoreIds.map((value) =>
    required(value, "Parent core ID"),
  ) as [string, string];
  if (parentCoreIds[0] === parentCoreIds[1]) {
    throw new Error("Breeding star features require two distinct parents.");
  }
  const breedingAt = timestamp(input.breedingAt, "Breeding time");
  if (!modes.includes(input.mode)) throw new Error("Research mode is invalid.");
  if (
    !Number.isSafeInteger(input.exactDistanceM) ||
    input.exactDistanceM <= 0
  ) {
    throw new Error("Research distance must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(input.minimumOutlierOpportunities) ||
    input.minimumOutlierOpportunities <= 0
  ) {
    throw new Error(
      "Minimum outlier opportunities must be a positive integer.",
    );
  }
  const benchmarkCutoff = timestamp(
    input.populationBenchmarks.dataCurrentThrough,
    "Population benchmark cutoff",
  );
  if (Date.parse(benchmarkCutoff) >= Date.parse(breedingAt)) {
    throw new Error("Population benchmarks must predate breeding.");
  }
  for (const [value, label] of [
    [input.populationBenchmarks.goldRateBasisPoints, "Gold benchmark"],
    [input.populationBenchmarks.blueRateBasisPoints, "Blue benchmark"],
    [
      input.populationBenchmarks.strongFieldGoldRateBasisPoints,
      "Strong-field Gold benchmark",
    ],
    [
      input.populationBenchmarks.strongFieldBlueRateBasisPoints,
      "Strong-field Blue benchmark",
    ],
  ] as const) {
    basisPoints(value, label);
  }

  const seen = new Set<string>();
  const accepted: BreedingStarProfile[] = [];
  const exclusions: BreedingStarFeatureResult["exclusions"][number][] = [];
  for (const rawProfile of input.profiles) {
    const profile = normalizeProfile(rawProfile);
    if (!parentCoreIds.includes(profile.subjectParentId)) {
      throw new Error("Every star profile must belong to one supplied parent.");
    }
    if (
      profile.relationship === "direct_parent" &&
      profile.evidenceCoreId !== profile.subjectParentId
    ) {
      throw new Error("A direct-parent profile must use that parent core ID.");
    }
    const identity = [
      profile.subjectParentId,
      profile.evidenceCoreId,
      profile.relationship,
    ].join(":");
    if (seen.has(identity)) {
      throw new Error("Star-feature profile identities must be unique.");
    }
    seen.add(identity);

    const reasons = new Set<BreedingStarFeatureExclusionReason>();
    if (
      profile.mode !== input.mode ||
      profile.exactDistanceM !== input.exactDistanceM
    ) {
      reasons.add("CELL_MISMATCH");
    }
    if (profile.evidenceStatus !== "complete") {
      reasons.add("EVIDENCE_NOT_COMPLETE");
    }
    if (profile.freshness === "stale" || profile.freshness === "unknown") {
      reasons.add("EVIDENCE_NOT_CURRENT");
    }
    if (Date.parse(profile.dataCurrentThrough) >= Date.parse(breedingAt)) {
      reasons.add("FEATURE_AFTER_BREEDING");
    }
    if (reasons.size > 0) {
      exclusions.push({
        evidenceCoreId: profile.evidenceCoreId,
        subjectParentId: profile.subjectParentId,
        relationship: profile.relationship,
        reasons: [...reasons],
      });
    } else {
      accepted.push(profile);
    }
  }

  const parentFeatures = parentCoreIds.map((parentCoreId) => {
    const profiles = accepted.filter(
      (profile) => profile.subjectParentId === parentCoreId,
    );
    const directProfiles = profiles.filter(
      (profile) => profile.relationship === "direct_parent",
    );
    if (directProfiles.length > 1) {
      throw new Error("Each parent may have only one direct profile.");
    }
    const direct = directProfiles[0] ?? null;
    const lineage = profiles.filter(
      (profile) => profile.relationship !== "direct_parent",
    );
    return {
      parentCoreId,
      directProfile:
        direct === null
          ? null
          : {
              raceCount: direct.raceCount,
              sampleStatus:
                direct.raceCount < 10
                  ? ("hypothesis_only" as const)
                  : ("minimally_analytical" as const),
              gold: counts(direct.goldReceived, direct.goldOpportunities),
              blue: counts(direct.blueReceived, direct.blueOpportunities),
              strongFieldGold: counts(
                direct.strongFieldGoldReceived,
                direct.strongFieldGoldOpportunities,
              ),
              strongFieldBlue: counts(
                direct.strongFieldBlueReceived,
                direct.strongFieldBlueOpportunities,
              ),
              dataCurrentThrough: direct.dataCurrentThrough,
              lastImported: direct.lastImported,
            },
      lineageProfilesUsed: lineage.length,
      lineageGoldOutlierCount: lineage.filter((profile) =>
        isOutlier(
          profile.goldReceived,
          profile.goldOpportunities,
          input.minimumOutlierOpportunities,
          input.populationBenchmarks.goldRateBasisPoints,
        ),
      ).length,
      lineageBlueOutlierCount: lineage.filter((profile) =>
        isOutlier(
          profile.blueReceived,
          profile.blueOpportunities,
          input.minimumOutlierOpportunities,
          input.populationBenchmarks.blueRateBasisPoints,
        ),
      ).length,
      lineageStrongFieldGoldOutlierCount: lineage.filter((profile) =>
        isOutlier(
          profile.strongFieldGoldReceived,
          profile.strongFieldGoldOpportunities,
          input.minimumOutlierOpportunities,
          input.populationBenchmarks.strongFieldGoldRateBasisPoints,
        ),
      ).length,
      lineageStrongFieldBlueOutlierCount: lineage.filter((profile) =>
        isOutlier(
          profile.strongFieldBlueReceived,
          profile.strongFieldBlueOpportunities,
          input.minimumOutlierOpportunities,
          input.populationBenchmarks.strongFieldBlueRateBasisPoints,
        ),
      ).length,
    };
  });

  return {
    researchPairId,
    parentCoreIds,
    mode: input.mode,
    exactDistanceM: input.exactDistanceM,
    breedingAt,
    benchmarkCutoff,
    parentFeatures,
    exclusions,
    readyForChronologicalTest: parentFeatures.every(
      ({ directProfile }) => directProfile !== null,
    ),
    starTraitsAssumedInherited: false,
    offspringQualityPredicted: false,
    recommendationAllowed: false,
    gateEPassed: false,
  };
}
