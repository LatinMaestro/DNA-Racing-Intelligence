import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";

type Observed<T> = DnaCurrentRaceMaterializationRow<T>;

export type OpenRaceScanExclusion =
  | "not_open"
  | "field_incomplete_or_full"
  | "field_not_half_filled"
  | "stale_or_invalid_evidence"
  | "missing_or_conflicting_fill"
  | "missing_or_incomplete_document"
  | "owned_core_already_entered";

export type OpenRaceScanOpportunity = Readonly<{
  raceId: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  format: string;
  gateCount: number;
  filledGateCount: number;
  vacantGates: number;
  enteredOpponentCoreIds: readonly string[];
  observedAt: string;
  /** Eligible owner Cores cannot be determined until all restrictions are verified. */
  eligibility: "needs_owner_core_restriction_check";
  rank: "not_evaluated";
  gameEntryAllowed: false;
}>;

export type OpenRaceScanResult = Readonly<{
  opportunities: readonly OpenRaceScanOpportunity[];
  excluded: readonly Readonly<{
    raceId: string;
    reason: OpenRaceScanExclusion;
  }>[];
  gameEntryAllowed: false;
}>;

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentEvidence(
  observedAt: string,
  evaluatedAt: number,
  maximumAgeMilliseconds: number,
): boolean {
  const observed = validTime(observedAt);
  return (
    observed !== null &&
    observed <= evaluatedAt &&
    evaluatedAt - observed <= maximumAgeMilliseconds
  );
}

function indexed<T extends { sourceRaceId: string }>(
  rows: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!row.sourceRaceId || result.has(row.sourceRaceId)) {
      throw new Error(
        "Open Race scanner received duplicate or invalid race identity.",
      );
    }
    result.set(row.sourceRaceId, row);
  }
  return result;
}

/**
 * Read-only, fail-closed first step of the API-native entry bot. Inputs are
 * already-canonicalised Open Lab active/fill/doc observations, never stale
 * HTML or speculative race attributes. This scanner does not rank, reserve,
 * submit, or spend; eligibility and the current field must be checked again
 * immediately before any future owner-authorised local execution.
 */
export function scanVerifiedOpenRaceOpportunities(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    activeRaces: readonly Observed<CanonicalActiveRaceSnapshot>[];
    fills: readonly Observed<CanonicalRaceFillSnapshot>[];
    documents: readonly Observed<CanonicalRaceDocumentMetadata>[];
    ownedCoreIds: readonly string[];
  }>,
): OpenRaceScanResult {
  const evaluatedAt = validTime(input.evaluatedAt);
  if (
    evaluatedAt === null ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 60
  ) {
    throw new Error("Open Race scanner freshness limit is invalid.");
  }
  const maxAge = input.maximumAgeMinutes * 60_000;
  const owned = new Set(input.ownedCoreIds);
  if (
    owned.size !== input.ownedCoreIds.length ||
    input.ownedCoreIds.some((id) => !/^\\d+$/u.test(id) || id === "0")
  ) {
    throw new Error("Open Race scanner owned-Core identity is invalid.");
  }
  const fills = indexed(input.fills);
  const documents = indexed(input.documents);
  indexed(input.activeRaces);
  const opportunities: OpenRaceScanOpportunity[] = [];
  const excluded: { raceId: string; reason: OpenRaceScanExclusion }[] = [];
  for (const active of input.activeRaces) {
    const raceId = active.sourceRaceId;
    const race = active.canonical;
    const skip = (reason: OpenRaceScanExclusion) => {
      excluded.push({ raceId, reason });
    };
    if (!["open", "filling"].includes(race.status.toLowerCase())) {
      skip("not_open");
      continue;
    }
    if (!currentEvidence(active.observedAt, evaluatedAt, maxAge)) {
      skip("stale_or_invalid_evidence");
      continue;
    }
    const fill = fills.get(raceId);
    if (
      fill === undefined ||
      !currentEvidence(fill.observedAt, evaluatedAt, maxAge) ||
      fill.canonical.sourceRaceId !== raceId ||
      !["open", "filling"].includes(fill.canonical.status.toLowerCase()) ||
      !Number.isSafeInteger(fill.canonical.gateCount) ||
      !Number.isSafeInteger(fill.canonical.filledGateCount) ||
      fill.canonical.gateCount < 2 ||
      fill.canonical.filledGateCount < 0 ||
      fill.canonical.filledGateCount > fill.canonical.gateCount ||
      fill.canonical.entrantCoreIds.length !== fill.canonical.filledGateCount ||
      new Set(fill.canonical.entrantCoreIds).size !==
        fill.canonical.entrantCoreIds.length
    ) {
      skip("missing_or_conflicting_fill");
      continue;
    }
    const gateCount = fill.canonical.gateCount;
    const filled = fill.canonical.filledGateCount;
    if (filled >= gateCount) {
      skip("field_incomplete_or_full");
      continue;
    }
    if (filled < Math.ceil(gateCount / 2)) {
      skip("field_not_half_filled");
      continue;
    }
    if (fill.canonical.entrantCoreIds.some((id) => owned.has(id))) {
      skip("owned_core_already_entered");
      continue;
    }
    const doc = documents.get(raceId);
    if (
      doc === undefined ||
      !currentEvidence(doc.observedAt, evaluatedAt, maxAge) ||
      doc.canonical.sourceRaceId !== raceId ||
      doc.canonical.sourceType !== "race_document" ||
      !["open", "filling"].includes(
        (doc.canonical.status ?? "").toLowerCase(),
      ) ||
      doc.canonical.mode !== race.mode ||
      doc.canonical.gateCount !== gateCount ||
      doc.canonical.filledGateCount !== filled ||
      doc.canonical.distanceMetres === undefined ||
      !Number.isSafeInteger(doc.canonical.distanceMetres) ||
      doc.canonical.distanceMetres <= 0 ||
      !doc.canonical.format ||
      doc.canonical.format !== race.format ||
      doc.canonical.raceClassSourceValue !== race.raceClassSourceValue ||
      doc.canonical.entrantCoreIds === undefined ||
      doc.canonical.entrantCoreIds.length !== filled ||
      !doc.canonical.entrantCoreIds.every(
        (id, index) => id === fill.canonical.entrantCoreIds[index],
      )
    ) {
      skip("missing_or_incomplete_document");
      continue;
    }
    opportunities.push({
      raceId,
      mode: race.mode,
      distanceMetres: doc.canonical.distanceMetres,
      format: doc.canonical.format,
      gateCount,
      filledGateCount: filled,
      vacantGates: gateCount - filled,
      enteredOpponentCoreIds: [...fill.canonical.entrantCoreIds],
      observedAt: active.observedAt,
      eligibility: "needs_owner_core_restriction_check",
      rank: "not_evaluated",
      gameEntryAllowed: false,
    });
  }
  return { opportunities, excluded, gameEntryAllowed: false };
}
