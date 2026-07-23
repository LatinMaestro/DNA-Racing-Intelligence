export const breedingFeeAssets = ["BGC", "USD"] as const;
export type BreedingFeeAsset = (typeof breedingFeeAssets)[number];

export const breedingFeeCategories = [
  "base_fee",
  "parent_a_arena_fee",
  "parent_b_arena_fee",
] as const;
export type BreedingFeeCategory = (typeof breedingFeeCategories)[number];

export type BreedingFeeComponentInput = Readonly<{
  componentId: string;
  category: BreedingFeeCategory;
  sourceStatus: "confirmed" | "unknown" | "unavailable";
  asset: BreedingFeeAsset;
  exactAmount: string | null;
  sourceKind: "manual_rule" | "arena_listing";
  listingId: string | null;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  expiresAt: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type BreedingFeeCalculationInput = Readonly<{
  pairingId: string;
  evaluatedAt: string;
  components: readonly BreedingFeeComponentInput[];
}>;

export type BreedingFeeWarning =
  | "COMPONENT_UNKNOWN"
  | "COMPONENT_UNAVAILABLE"
  | "AMOUNT_UNKNOWN"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "EVIDENCE_AGEING"
  | "EVIDENCE_STALE"
  | "LISTING_EXPIRED"
  | "BGC_USD_REFERENCE_ONLY"
  | "LIVE_CONFIRMATION_REQUIRED"
  | "GATE_E_NOT_PASSED";

export type BreedingFeeCalculation = Readonly<{
  pairingId: string;
  status: "ready_for_review" | "review_required";
  lines: readonly Readonly<{
    componentId: string;
    category: BreedingFeeCategory;
    asset: BreedingFeeAsset;
    exactAmount: string | null;
    sourceKind: BreedingFeeComponentInput["sourceKind"];
    listingId: string | null;
    expired: boolean | null;
  }>[];
  totals: Readonly<{
    BGC: string | null;
    USD: string | null;
  }>;
  bgcUsdReferenceEquivalent: string | null;
  combinedCashTotal: null;
  warnings: readonly BreedingFeeWarning[];
  liveConfirmationRequired: true;
  recommendationAllowed: false;
  breedingExecutionAllowed: false;
}>;

type ExactDecimal = Readonly<{ units: bigint; scale: number }>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function parseTimestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function parseExactDecimal(value: string, label: string): ExactDecimal {
  const normalized = required(value, label);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(normalized);
  if (!match) {
    throw new Error(
      `${label} must be a non-negative exact decimal with at most 18 places.`,
    );
  }
  const fraction = match[2] ?? "";
  return {
    units: BigInt(`${match[1]}${fraction}`),
    scale: fraction.length,
  };
}

function formatExactDecimal(value: ExactDecimal): string {
  if (value.scale === 0) return value.units.toString();
  const padded = value.units.toString().padStart(value.scale + 1, "0");
  const whole = padded.slice(0, -value.scale);
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function addExactDecimals(values: readonly ExactDecimal[]): string {
  const scale = Math.max(0, ...values.map((value) => value.scale));
  const units = values.reduce(
    (sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale),
    0n,
  );
  return formatExactDecimal({ units, scale });
}

function normalizeComponent(
  input: BreedingFeeComponentInput,
  evaluatedAt: string,
): BreedingFeeComponentInput & Readonly<{ expired: boolean | null }> {
  const componentId = required(input.componentId, "Fee component ID");
  if (!breedingFeeCategories.includes(input.category)) {
    throw new Error("Fee component category is invalid.");
  }
  if (!["confirmed", "unknown", "unavailable"].includes(input.sourceStatus)) {
    throw new Error("Fee component source status is invalid.");
  }
  if (!breedingFeeAssets.includes(input.asset)) {
    throw new Error("Fee component asset is invalid.");
  }
  if (!["manual_rule", "arena_listing"].includes(input.sourceKind)) {
    throw new Error("Fee component source kind is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Fee component freshness is invalid.");
  }

  const exactAmount =
    input.exactAmount === null
      ? null
      : formatExactDecimal(
          parseExactDecimal(input.exactAmount, "Fee component amount"),
        );
  if ((input.sourceStatus === "confirmed") !== (exactAmount !== null)) {
    throw new Error(
      "Only a confirmed fee component may carry one exact amount.",
    );
  }

  const listingId =
    input.listingId === null
      ? null
      : required(input.listingId, "Arena listing ID");
  if ((input.sourceKind === "arena_listing") !== (listingId !== null)) {
    throw new Error("Arena fee components require exactly one listing ID.");
  }

  const dataCurrentThrough = parseTimestamp(
    input.dataCurrentThrough,
    "Fee data current through",
  );
  const lastImported = parseTimestamp(input.lastImported, "Fee last imported");
  const expiresAt = parseTimestamp(input.expiresAt, "Fee expiry");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Fee last imported cannot precede data current through.");
  }
  if (
    lastImported !== null &&
    Date.parse(lastImported) > Date.parse(evaluatedAt)
  ) {
    throw new Error("Fee last imported cannot follow evaluation.");
  }
  if (
    input.sourceKind === "manual_rule" &&
    (listingId !== null || expiresAt !== null)
  ) {
    throw new Error("Manual fee rules cannot carry Arena listing evidence.");
  }
  if (input.sourceKind === "arena_listing" && expiresAt === null) {
    throw new Error("Arena fee components require an expiry timestamp.");
  }

  return {
    ...input,
    componentId,
    exactAmount,
    listingId,
    dataCurrentThrough,
    lastImported,
    expiresAt,
    expired:
      expiresAt === null
        ? null
        : Date.parse(expiresAt) <= Date.parse(evaluatedAt),
  };
}

export function calculateBreedingFees(
  input: BreedingFeeCalculationInput,
): BreedingFeeCalculation {
  const pairingId = required(input.pairingId, "Pairing ID");
  const evaluatedAt = parseTimestamp(input.evaluatedAt, "Evaluation time");
  if (evaluatedAt === null) throw new Error("Evaluation time is required.");
  if (input.components.length === 0) {
    throw new Error("At least one fee component is required.");
  }

  const components = input.components.map((component) =>
    normalizeComponent(component, evaluatedAt),
  );
  const componentIds = new Set<string>();
  const categories = new Set<BreedingFeeCategory>();
  for (const component of components) {
    if (componentIds.has(component.componentId)) {
      throw new Error("Fee component IDs must be unique.");
    }
    if (categories.has(component.category)) {
      throw new Error("Each fee category may appear only once.");
    }
    componentIds.add(component.componentId);
    categories.add(component.category);
  }
  if (!categories.has("base_fee")) {
    throw new Error("One base fee component is required.");
  }

  const warnings = new Set<BreedingFeeWarning>([
    "BGC_USD_REFERENCE_ONLY",
    "LIVE_CONFIRMATION_REQUIRED",
    "GATE_E_NOT_PASSED",
  ]);
  for (const component of components) {
    if (component.sourceStatus === "unknown") warnings.add("COMPONENT_UNKNOWN");
    if (component.sourceStatus === "unavailable") {
      warnings.add("COMPONENT_UNAVAILABLE");
    }
    if (component.exactAmount === null) warnings.add("AMOUNT_UNKNOWN");
    if (
      component.dataCurrentThrough === null ||
      component.freshness === "unknown"
    ) {
      warnings.add("DATA_CUTOFF_UNKNOWN");
    }
    if (component.lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
    if (component.freshness === "ageing") warnings.add("EVIDENCE_AGEING");
    if (component.freshness === "stale") warnings.add("EVIDENCE_STALE");
    if (component.expired === true) warnings.add("LISTING_EXPIRED");
  }

  const complete = components.every(
    (component) =>
      component.sourceStatus === "confirmed" &&
      component.exactAmount !== null &&
      component.dataCurrentThrough !== null &&
      component.lastImported !== null &&
      component.freshness === "current" &&
      component.expired !== true,
  );

  const totals = Object.fromEntries(
    breedingFeeAssets.map((asset) => {
      const assetComponents = components.filter(
        (component) =>
          component.asset === asset && component.exactAmount !== null,
      );
      const total =
        assetComponents.length === 0 || !complete
          ? null
          : addExactDecimals(
              assetComponents.map((component) =>
                parseExactDecimal(
                  component.exactAmount!,
                  "Fee component amount",
                ),
              ),
            );
      return [asset, total];
    }),
  ) as { BGC: string | null; USD: string | null };

  return {
    pairingId,
    status: complete ? "ready_for_review" : "review_required",
    lines: components.map((component) => ({
      componentId: component.componentId,
      category: component.category,
      asset: component.asset,
      exactAmount: component.exactAmount,
      sourceKind: component.sourceKind,
      listingId: component.listingId,
      expired: component.expired,
    })),
    totals,
    bgcUsdReferenceEquivalent: complete ? totals.BGC : null,
    combinedCashTotal: null,
    warnings: [...warnings],
    liveConfirmationRequired: true,
    recommendationAllowed: false,
    breedingExecutionAllowed: false,
  };
}
