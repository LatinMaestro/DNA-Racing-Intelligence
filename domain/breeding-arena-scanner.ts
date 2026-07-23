export type BreedingArenaListingInput = Readonly<{
  listingId: string;
  sourceCoreId: string | null;
  identityStatus: "exact" | "unmatched" | "ambiguous";
  exactUsdPrice: string | null;
  remainingSplices: number | null;
  expiresAt: string | null;
}>;

export type BreedingArenaSnapshotInput = Readonly<{
  snapshotId: string;
  selected: boolean;
  status: "accepted" | "quarantined" | "rolled_back";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
  listings: readonly BreedingArenaListingInput[];
}>;

export type BreedingArenaScanInput = Readonly<{
  evaluatedAt: string;
  snapshots: readonly BreedingArenaSnapshotInput[];
}>;

export type BreedingArenaWarning =
  | "NO_SELECTED_ACCEPTED_SNAPSHOT"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "SNAPSHOT_AGEING"
  | "SNAPSHOT_STALE"
  | "IDENTITY_UNRESOLVED"
  | "PRICE_UNKNOWN"
  | "SPLICE_CAPACITY_UNKNOWN"
  | "LISTING_EXPIRY_UNKNOWN"
  | "LISTING_EXPIRED"
  | "HISTORICAL_SNAPSHOT_ONLY"
  | "LIVE_CONFIRMATION_REQUIRED"
  | "NO_INCOME_INFERRED"
  | "GATE_E_NOT_PASSED";

export type BreedingArenaScan = Readonly<{
  status: "ready_for_review" | "review_required" | "not_available";
  snapshot: Readonly<{
    snapshotId: string;
    dataCurrentThrough: string | null;
    lastImported: string | null;
    freshness: BreedingArenaSnapshotInput["freshness"];
  }> | null;
  listings: readonly Readonly<{
    listingId: string;
    sourceCoreId: string | null;
    exactUsdPrice: string | null;
    remainingSplices: number | null;
    expiresAt: string | null;
    status: "historical_candidate" | "expired" | "review_required";
    liveConfirmationRequired: true;
  }>[];
  warnings: readonly BreedingArenaWarning[];
  liveStateClaimed: false;
  completedBreedingInferred: false;
  incomeInferred: false;
  recommendationAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function exactPrice(value: string | null): string | null {
  if (value === null) return null;
  const normalized = required(value, "Arena price");
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(normalized);
  if (!match) {
    throw new Error(
      "Arena price must be a non-negative exact decimal with at most 18 places.",
    );
  }
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction === "" ? match[1]! : `${match[1]}.${fraction}`;
}

function normalizeListing(
  input: BreedingArenaListingInput,
): BreedingArenaListingInput {
  const listingId = required(input.listingId, "Arena listing ID");
  if (!["exact", "unmatched", "ambiguous"].includes(input.identityStatus)) {
    throw new Error("Arena identity status is invalid.");
  }
  const sourceCoreId =
    input.sourceCoreId === null
      ? null
      : required(input.sourceCoreId, "Arena source core ID");
  if ((input.identityStatus === "exact") !== (sourceCoreId !== null)) {
    throw new Error(
      "Only an exact Arena identity may carry one source core ID.",
    );
  }
  const price = exactPrice(input.exactUsdPrice);
  if (
    input.remainingSplices !== null &&
    (!Number.isSafeInteger(input.remainingSplices) ||
      input.remainingSplices < 0)
  ) {
    throw new Error(
      "Arena remaining splices must be a non-negative safe integer or null.",
    );
  }
  return {
    ...input,
    listingId,
    sourceCoreId,
    exactUsdPrice: price,
    expiresAt: timestamp(input.expiresAt, "Arena listing expiry"),
  };
}

export function scanBreedingArena(
  input: BreedingArenaScanInput,
): BreedingArenaScan {
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  if (evaluatedAt === null) throw new Error("Evaluation time is required.");
  const selected = input.snapshots.filter(
    (snapshot) => snapshot.selected && snapshot.status === "accepted",
  );
  if (selected.length > 1) {
    throw new Error("Only one accepted Arena snapshot may be selected.");
  }
  for (const snapshot of input.snapshots) {
    required(snapshot.snapshotId, "Arena snapshot ID");
    if (!["accepted", "quarantined", "rolled_back"].includes(snapshot.status)) {
      throw new Error("Arena snapshot status is invalid.");
    }
    if (
      !["current", "ageing", "stale", "unknown"].includes(snapshot.freshness)
    ) {
      throw new Error("Arena snapshot freshness is invalid.");
    }
    if (snapshot.selected && snapshot.status !== "accepted") {
      throw new Error("Only an accepted Arena snapshot may be selected.");
    }
  }

  const warnings = new Set<BreedingArenaWarning>([
    "HISTORICAL_SNAPSHOT_ONLY",
    "LIVE_CONFIRMATION_REQUIRED",
    "NO_INCOME_INFERRED",
    "GATE_E_NOT_PASSED",
  ]);
  const active = selected[0];
  if (!active) {
    warnings.add("NO_SELECTED_ACCEPTED_SNAPSHOT");
    return {
      status: "not_available",
      snapshot: null,
      listings: [],
      warnings: [...warnings],
      liveStateClaimed: false,
      completedBreedingInferred: false,
      incomeInferred: false,
      recommendationAllowed: false,
    };
  }

  const dataCurrentThrough = timestamp(
    active.dataCurrentThrough,
    "Arena data current through",
  );
  const lastImported = timestamp(active.lastImported, "Arena last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Arena last imported cannot precede data current through.");
  }
  if (
    lastImported !== null &&
    Date.parse(lastImported) > Date.parse(evaluatedAt)
  ) {
    throw new Error("Arena last imported cannot follow evaluation.");
  }
  if (dataCurrentThrough === null || active.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (active.freshness === "ageing") warnings.add("SNAPSHOT_AGEING");
  if (active.freshness === "stale") warnings.add("SNAPSHOT_STALE");

  const listingIds = new Set<string>();
  const listings = active.listings.map((raw) => {
    const listing = normalizeListing(raw);
    if (listingIds.has(listing.listingId)) {
      throw new Error("Arena listing IDs must be unique within a snapshot.");
    }
    listingIds.add(listing.listingId);
    if (listing.identityStatus !== "exact") warnings.add("IDENTITY_UNRESOLVED");
    if (listing.exactUsdPrice === null) warnings.add("PRICE_UNKNOWN");
    if (listing.remainingSplices === null) {
      warnings.add("SPLICE_CAPACITY_UNKNOWN");
    }
    if (listing.expiresAt === null) warnings.add("LISTING_EXPIRY_UNKNOWN");
    const expired =
      listing.expiresAt !== null &&
      Date.parse(listing.expiresAt) <= Date.parse(evaluatedAt);
    if (expired) warnings.add("LISTING_EXPIRED");
    const complete =
      active.freshness === "current" &&
      dataCurrentThrough !== null &&
      lastImported !== null &&
      listing.identityStatus === "exact" &&
      listing.exactUsdPrice !== null &&
      listing.remainingSplices !== null &&
      listing.remainingSplices > 0 &&
      listing.expiresAt !== null &&
      !expired;
    return {
      listingId: listing.listingId,
      sourceCoreId: listing.sourceCoreId,
      exactUsdPrice: listing.exactUsdPrice,
      remainingSplices: listing.remainingSplices,
      expiresAt: listing.expiresAt,
      status: expired
        ? ("expired" as const)
        : complete
          ? ("historical_candidate" as const)
          : ("review_required" as const),
      liveConfirmationRequired: true as const,
    };
  });

  const allReviewable =
    active.freshness === "current" &&
    dataCurrentThrough !== null &&
    lastImported !== null &&
    listings.every(({ status }) => status === "historical_candidate");
  return {
    status: allReviewable ? "ready_for_review" : "review_required",
    snapshot: {
      snapshotId: active.snapshotId,
      dataCurrentThrough,
      lastImported,
      freshness: active.freshness,
    },
    listings,
    warnings: [...warnings],
    liveStateClaimed: false,
    completedBreedingInferred: false,
    incomeInferred: false,
    recommendationAllowed: false,
  };
}
