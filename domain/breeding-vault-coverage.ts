import type {
  BreedingIntelligenceBoard,
  BreedingIntelligencePairAssessment,
} from "./breeding-intelligence";
import type { ProbeMode } from "./discovery-probe-plan";

export const dnaElements = ["metal", "fire", "earth", "water"] as const;
export type DnaElement = (typeof dnaElements)[number];

export const dnaCoreClasses = [
  "genesis",
  "morphed",
  "freak",
  "xclass",
] as const;
export type DnaCoreClass = (typeof dnaCoreClasses)[number];

export const breedingDistanceBands = [
  { id: "sprint", minimumMetres: 900, maximumMetres: 1_400 },
  { id: "middle", minimumMetres: 1_400, maximumMetres: 1_800 },
  { id: "marathon", minimumMetres: 1_800, maximumMetres: 2_200 },
] as const;
export type BreedingDistanceBand = (typeof breedingDistanceBands)[number]["id"];

export type VaultEliteRacer = Readonly<{
  coreId: string;
  element: string;
  coreClass: string;
  fNumber: number | null;
  eliteScopes: readonly Readonly<{
    mode: ProbeMode;
    distanceMetres: number;
  }>[];
}>;

export type VaultFNumberSegment = Readonly<{
  id: string;
  label: string;
  minimumInclusive: number | null;
  maximumInclusive: number | null;
}>;

export type VaultCoverageGapSeverity = "critical" | "shallow" | "covered";
export type VaultCoverageFacet =
  "element" | "core_class" | "element_x_core_class" | "f_number_segment";

export type VaultCoverageGap = Readonly<{
  mode: ProbeMode;
  window: Readonly<
    | { kind: "exact"; distanceMetres: number }
    | { kind: "band"; band: BreedingDistanceBand }
  >;
  facet: VaultCoverageFacet;
  element: DnaElement | null;
  coreClass: DnaCoreClass | null;
  fNumberSegmentId: string | null;
  fNumberSegmentLabel: string | null;
  eliteCoreCount: number;
  preferredEliteDepth: number;
  severity: VaultCoverageGapSeverity;
  fillableByBreeding: boolean;
}>;

export type VaultCoveragePolicy = Readonly<{
  preferredExactEliteDepth: number;
  preferredBandEliteDepth: number;
  qualityWeight: number;
  coverageWeight: number;
}>;

export const defaultVaultCoveragePolicy: VaultCoveragePolicy = Object.freeze({
  preferredExactEliteDepth: 1,
  preferredBandEliteDepth: 2,
  qualityWeight: 0.8,
  coverageWeight: 0.2,
});

export type PairCoverageImpact = Readonly<{
  projectedElement: DnaElement | null;
  projectedCoreClass: DnaCoreClass | null;
  projectedFNumber: number | null;
  matchedGaps: readonly VaultCoverageGap[];
  criticalGapCount: number;
  shallowGapCount: number;
  coverageScore: number;
  priority: "critical" | "shallow" | "none";
}>;

export type StrategicBreedingPairAssessment = Readonly<{
  pair: BreedingIntelligencePairAssessment;
  coverageImpact: PairCoverageImpact;
  strategicScore: number | null;
}>;

export type StrategicBreedingBoard = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  action: BreedingIntelligenceBoard["action"];
  gaps: readonly VaultCoverageGap[];
  criticalGaps: readonly VaultCoverageGap[];
  shallowGaps: readonly VaultCoverageGap[];
  targets: readonly StrategicBreedingPairAssessment[];
  watches: readonly StrategicBreedingPairAssessment[];
  waits: readonly StrategicBreedingPairAssessment[];
}>;

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function validatePolicy(policy: VaultCoveragePolicy): VaultCoveragePolicy {
  positiveInteger(
    policy.preferredExactEliteDepth,
    "Preferred exact elite depth",
  );
  positiveInteger(policy.preferredBandEliteDepth, "Preferred band elite depth");
  if (
    !Number.isFinite(policy.qualityWeight) ||
    !Number.isFinite(policy.coverageWeight) ||
    policy.qualityWeight < 0 ||
    policy.coverageWeight < 0 ||
    Math.abs(policy.qualityWeight + policy.coverageWeight - 1) > 1e-9
  ) {
    throw new Error(
      "Vault coverage strategy weights must be non-negative and sum to 1.",
    );
  }
  return policy;
}

function normalizeElement(value: string): DnaElement | null {
  const normalized = value.trim().toLowerCase();
  return dnaElements.find((element) => element === normalized) ?? null;
}

function normalizeCoreClass(value: string): DnaCoreClass | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
  if (normalized === "genesis") return "genesis";
  if (normalized === "morph" || normalized === "morphed") return "morphed";
  if (normalized === "freak") return "freak";
  if (normalized === "xclass") return "xclass";
  return null;
}

function bandsForDistance(
  distanceMetres: number,
): readonly BreedingDistanceBand[] {
  return Object.freeze(
    breedingDistanceBands
      .filter(
        (band) =>
          distanceMetres >= band.minimumMetres &&
          distanceMetres <= band.maximumMetres,
      )
      .map((band) => band.id),
  );
}

function distanceInBand(
  distanceMetres: number,
  bandId: BreedingDistanceBand,
): boolean {
  const band = breedingDistanceBands.find(
    (candidate) => candidate.id === bandId,
  );
  if (!band) return false;
  return (
    distanceMetres >= band.minimumMetres && distanceMetres <= band.maximumMetres
  );
}

function validateSegment(segment: VaultFNumberSegment): VaultFNumberSegment {
  if (segment.id.trim() === "" || segment.label.trim() === "") {
    throw new Error("F-number coverage segment requires id and label.");
  }
  if (
    segment.minimumInclusive !== null &&
    (!Number.isSafeInteger(segment.minimumInclusive) ||
      segment.minimumInclusive < 1)
  ) {
    throw new Error("F-number segment minimum must be a positive integer.");
  }
  if (
    segment.maximumInclusive !== null &&
    (!Number.isSafeInteger(segment.maximumInclusive) ||
      segment.maximumInclusive < 1)
  ) {
    throw new Error("F-number segment maximum must be a positive integer.");
  }
  if (
    segment.minimumInclusive !== null &&
    segment.maximumInclusive !== null &&
    segment.minimumInclusive > segment.maximumInclusive
  ) {
    throw new Error("F-number segment minimum cannot exceed maximum.");
  }
  return segment;
}

function inFNumberSegment(
  fNumber: number | null,
  segment: VaultFNumberSegment,
): boolean {
  if (fNumber === null || !Number.isSafeInteger(fNumber) || fNumber < 1)
    return false;
  if (segment.minimumInclusive !== null && fNumber < segment.minimumInclusive) {
    return false;
  }
  if (segment.maximumInclusive !== null && fNumber > segment.maximumInclusive) {
    return false;
  }
  return true;
}

function coreCoversWindow(
  core: VaultEliteRacer,
  mode: ProbeMode,
  window: VaultCoverageGap["window"],
): boolean {
  return core.eliteScopes.some((scope) => {
    if (scope.mode !== mode) return false;
    if (window.kind === "exact") {
      return scope.distanceMetres === window.distanceMetres;
    }
    return distanceInBand(scope.distanceMetres, window.band);
  });
}

function countMatchingEliteCores(
  cores: readonly VaultEliteRacer[],
  input: Readonly<{
    mode: ProbeMode;
    window: VaultCoverageGap["window"];
    element?: DnaElement;
    coreClass?: DnaCoreClass;
    fNumberSegment?: VaultFNumberSegment;
  }>,
): number {
  const matchingIds = new Set<string>();
  for (const core of cores) {
    if (!coreCoversWindow(core, input.mode, input.window)) continue;
    if (
      input.element !== undefined &&
      normalizeElement(core.element) !== input.element
    ) {
      continue;
    }
    if (
      input.coreClass !== undefined &&
      normalizeCoreClass(core.coreClass) !== input.coreClass
    ) {
      continue;
    }
    if (
      input.fNumberSegment !== undefined &&
      !inFNumberSegment(core.fNumber, input.fNumberSegment)
    ) {
      continue;
    }
    matchingIds.add(core.coreId);
  }
  return matchingIds.size;
}

function gapSeverity(
  eliteCoreCount: number,
  preferredEliteDepth: number,
): VaultCoverageGapSeverity {
  if (eliteCoreCount === 0) return "critical";
  if (eliteCoreCount < preferredEliteDepth) return "shallow";
  return "covered";
}

function buildGap(
  cores: readonly VaultEliteRacer[],
  input: Readonly<{
    mode: ProbeMode;
    window: VaultCoverageGap["window"];
    preferredEliteDepth: number;
    facet: VaultCoverageFacet;
    element?: DnaElement;
    coreClass?: DnaCoreClass;
    fNumberSegment?: VaultFNumberSegment;
  }>,
): VaultCoverageGap {
  const eliteCoreCount = countMatchingEliteCores(cores, input);
  const coreClass = input.coreClass ?? null;
  return Object.freeze({
    mode: input.mode,
    window: input.window,
    facet: input.facet,
    element: input.element ?? null,
    coreClass,
    fNumberSegmentId: input.fNumberSegment?.id ?? null,
    fNumberSegmentLabel: input.fNumberSegment?.label ?? null,
    eliteCoreCount,
    preferredEliteDepth: input.preferredEliteDepth,
    severity: gapSeverity(eliteCoreCount, input.preferredEliteDepth),
    fillableByBreeding: coreClass !== "genesis",
  });
}

export function assessVaultCoverageGaps(
  input: Readonly<{
    mode: ProbeMode;
    distanceMetres: number;
    ownedEliteRacers: readonly VaultEliteRacer[];
    fNumberSegments?: readonly VaultFNumberSegment[];
    policy?: VaultCoveragePolicy;
  }>,
): readonly VaultCoverageGap[] {
  positiveInteger(input.distanceMetres, "Vault coverage distance");
  const policy = validatePolicy(input.policy ?? defaultVaultCoveragePolicy);
  const segments = (input.fNumberSegments ?? []).map(validateSegment);
  const windows: VaultCoverageGap["window"][] = [
    Object.freeze({ kind: "exact", distanceMetres: input.distanceMetres }),
    ...bandsForDistance(input.distanceMetres).map((band) =>
      Object.freeze({ kind: "band" as const, band }),
    ),
  ];
  const gaps: VaultCoverageGap[] = [];
  for (const window of windows) {
    const preferredEliteDepth =
      window.kind === "exact"
        ? policy.preferredExactEliteDepth
        : policy.preferredBandEliteDepth;
    for (const element of dnaElements) {
      gaps.push(
        buildGap(input.ownedEliteRacers, {
          mode: input.mode,
          window,
          preferredEliteDepth,
          facet: "element",
          element,
        }),
      );
    }
    for (const coreClass of dnaCoreClasses) {
      gaps.push(
        buildGap(input.ownedEliteRacers, {
          mode: input.mode,
          window,
          preferredEliteDepth,
          facet: "core_class",
          coreClass,
        }),
      );
    }
    for (const element of dnaElements) {
      for (const coreClass of dnaCoreClasses) {
        gaps.push(
          buildGap(input.ownedEliteRacers, {
            mode: input.mode,
            window,
            preferredEliteDepth,
            facet: "element_x_core_class",
            element,
            coreClass,
          }),
        );
      }
    }
    for (const fNumberSegment of segments) {
      gaps.push(
        buildGap(input.ownedEliteRacers, {
          mode: input.mode,
          window,
          preferredEliteDepth,
          facet: "f_number_segment",
          fNumberSegment,
        }),
      );
    }
  }
  return Object.freeze(gaps);
}

function gapMatchesProjection(
  gap: VaultCoverageGap,
  input: Readonly<{
    element: DnaElement | null;
    coreClass: DnaCoreClass | null;
    fNumber: number | null;
    fNumberSegments: readonly VaultFNumberSegment[];
  }>,
): boolean {
  if (!gap.fillableByBreeding || gap.severity === "covered") return false;
  if (gap.facet === "element") return gap.element === input.element;
  if (gap.facet === "core_class") return gap.coreClass === input.coreClass;
  if (gap.facet === "element_x_core_class") {
    return gap.element === input.element && gap.coreClass === input.coreClass;
  }
  const segment = input.fNumberSegments.find(
    (candidate) => candidate.id === gap.fNumberSegmentId,
  );
  return segment !== undefined && inFNumberSegment(input.fNumber, segment);
}

function gapWeight(gap: VaultCoverageGap): number {
  const severityMultiplier = gap.severity === "critical" ? 1 : 0.5;
  const base =
    gap.window.kind === "exact"
      ? gap.facet === "element_x_core_class"
        ? 5
        : gap.facet === "f_number_segment"
          ? 2
          : 3
      : gap.facet === "element_x_core_class"
        ? 4
        : gap.facet === "f_number_segment"
          ? 1
          : 2;
  return base * severityMultiplier;
}

function maximumProjectionWeight(
  distanceMetres: number,
  hasFNumberSegment: boolean,
): number {
  const windows = 1 + bandsForDistance(distanceMetres).length;
  const exact = 3 + 3 + 5 + (hasFNumberSegment ? 2 : 0);
  const band = 2 + 2 + 4 + (hasFNumberSegment ? 1 : 0);
  return exact + Math.max(0, windows - 1) * band;
}

export function assessPairCoverageImpact(
  input: Readonly<{
    pair: BreedingIntelligencePairAssessment;
    gaps: readonly VaultCoverageGap[];
    fNumberSegments?: readonly VaultFNumberSegment[];
  }>,
): PairCoverageImpact {
  const segments = (input.fNumberSegments ?? []).map(validateSegment);
  const pairInfo = input.pair.pairInfo;
  const projectedElement = pairInfo ? normalizeElement(pairInfo.element) : null;
  const projectedCoreClass = pairInfo
    ? normalizeCoreClass(pairInfo.offspringType)
    : null;
  const projectedFNumber =
    pairInfo && Number.isSafeInteger(pairInfo.fNumber) && pairInfo.fNumber > 0
      ? pairInfo.fNumber
      : null;
  const matchedGaps = input.gaps.filter((gap) =>
    gapMatchesProjection(gap, {
      element: projectedElement,
      coreClass: projectedCoreClass,
      fNumber: projectedFNumber,
      fNumberSegments: segments,
    }),
  );
  const rawWeight = matchedGaps.reduce(
    (total, gap) => total + gapWeight(gap),
    0,
  );
  const hasFNumberSegment = segments.some((segment) =>
    inFNumberSegment(projectedFNumber, segment),
  );
  const maximumWeight = maximumProjectionWeight(
    input.pair.father.distanceMetres,
    hasFNumberSegment,
  );
  const coverageScore =
    maximumWeight <= 0 ? 0 : Math.min(100, (100 * rawWeight) / maximumWeight);
  const criticalGapCount = matchedGaps.filter(
    (gap) => gap.severity === "critical",
  ).length;
  const shallowGapCount = matchedGaps.filter(
    (gap) => gap.severity === "shallow",
  ).length;
  return Object.freeze({
    projectedElement,
    projectedCoreClass,
    projectedFNumber,
    matchedGaps: Object.freeze(matchedGaps),
    criticalGapCount,
    shallowGapCount,
    coverageScore,
    priority:
      criticalGapCount > 0
        ? "critical"
        : shallowGapCount > 0
          ? "shallow"
          : "none",
  });
}

function strategicPair(
  pair: BreedingIntelligencePairAssessment,
  gaps: readonly VaultCoverageGap[],
  fNumberSegments: readonly VaultFNumberSegment[],
  policy: VaultCoveragePolicy,
): StrategicBreedingPairAssessment {
  const coverageImpact = assessPairCoverageImpact({
    pair,
    gaps,
    fNumberSegments,
  });
  const strategicScore =
    pair.opportunityScore === null
      ? null
      : policy.qualityWeight * pair.opportunityScore +
        policy.coverageWeight * coverageImpact.coverageScore;
  return Object.freeze({ pair, coverageImpact, strategicScore });
}

function strategicSort(
  left: StrategicBreedingPairAssessment,
  right: StrategicBreedingPairAssessment,
): number {
  return (
    (right.strategicScore ?? -1) - (left.strategicScore ?? -1) ||
    (right.pair.opportunityScore ?? -1) - (left.pair.opportunityScore ?? -1) ||
    left.pair.father.coreId.localeCompare(right.pair.father.coreId) ||
    left.pair.mother.coreId.localeCompare(right.pair.mother.coreId)
  );
}

export function buildStrategicBreedingBoard(
  input: Readonly<{
    board: BreedingIntelligenceBoard;
    ownedEliteRacers: readonly VaultEliteRacer[];
    fNumberSegments?: readonly VaultFNumberSegment[];
    policy?: VaultCoveragePolicy;
  }>,
): StrategicBreedingBoard {
  const policy = validatePolicy(input.policy ?? defaultVaultCoveragePolicy);
  const fNumberSegments = (input.fNumberSegments ?? []).map(validateSegment);
  const gaps = assessVaultCoverageGaps({
    mode: input.board.mode,
    distanceMetres: input.board.distanceMetres,
    ownedEliteRacers: input.ownedEliteRacers,
    fNumberSegments,
    policy,
  });
  const annotate = (pairs: readonly BreedingIntelligencePairAssessment[]) =>
    Object.freeze(
      pairs
        .map((pair) => strategicPair(pair, gaps, fNumberSegments, policy))
        .sort(strategicSort),
    );
  return Object.freeze({
    mode: input.board.mode,
    distanceMetres: input.board.distanceMetres,
    action: input.board.action,
    gaps,
    criticalGaps: Object.freeze(
      gaps.filter((gap) => gap.severity === "critical"),
    ),
    shallowGaps: Object.freeze(
      gaps.filter((gap) => gap.severity === "shallow"),
    ),
    targets: annotate(input.board.targets),
    watches: annotate(input.board.watches),
    waits: annotate(input.board.waits),
  });
}
