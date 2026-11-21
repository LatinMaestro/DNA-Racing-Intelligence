import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";

export type OpenRacePerformanceEvidence = Readonly<{
  raceId: string;
  authority: "accepted_profile_read_model" | "accepted_history_generation";
  status: "ready" | "unavailable";
  candidateProfiles: readonly CorePerformanceProfile[];
  opponentProfiles: readonly Readonly<{
    coreId: string;
    profile: CorePerformanceProfile | null;
  }>[];
  missingCandidateCoreIds: readonly string[];
  missingOpponentCoreIds: readonly string[];
  staleOrUnknownCoreIds: readonly string[];
  hypothesisOnlyCoreIds: readonly string[];
  reasons: readonly string[];
  readyForRanking: boolean;
  gameEntryAllowed: false;
}>;

function coreIdSet(
  values: readonly string[],
  label: string,
  allowEmpty = false,
): Set<string> {
  if (
    (!allowEmpty && values.length === 0) ||
    new Set(values).size !== values.length ||
    values.some((value) => !/^[1-9]\d*$/u.test(value))
  ) {
    throw new Error(`Open Race ${label} Core selection is invalid.`);
  }
  return new Set(values);
}

/**
 * Resolves the complete exact-mode and exact-distance performance evidence
 * needed by the accepted pre-entry ranking. It does not derive a new score or
 * distribution. Missing, stale or unknown evidence remains unavailable and is
 * never interpreted as weak opposition or favourable performance.
 */
export function resolveOpenRacePerformanceEvidence(
  input: Readonly<{
    opportunity: OpenRaceScanOpportunity;
    authority: OpenRacePerformanceEvidence["authority"];
    completeOwnedCoreIds: readonly string[];
    eligibleOwnedCoreIds: readonly string[];
    profiles: readonly CorePerformanceProfile[];
  }>,
): OpenRacePerformanceEvidence {
  const owned = coreIdSet(input.completeOwnedCoreIds, "owned");
  const eligible = coreIdSet(input.eligibleOwnedCoreIds, "eligible", true);
  if ([...eligible].some((coreId) => !owned.has(coreId))) {
    throw new Error(
      "Open Race eligible Core is not in the complete owner Vault.",
    );
  }
  if (input.profiles.length > 20_000) {
    throw new Error(
      "Open Race performance evidence exceeds the bounded limit.",
    );
  }

  const exactProfiles = new Map<string, CorePerformanceProfile>();
  for (const profile of input.profiles) {
    if (
      profile.mode !== input.opportunity.mode ||
      profile.distance !== input.opportunity.distanceMetres
    ) {
      continue;
    }
    if (exactProfiles.has(profile.coreId)) {
      throw new Error(
        "Open Race exact-context performance profile is ambiguous.",
      );
    }
    exactProfiles.set(profile.coreId, profile);
  }

  const missingCandidateCoreIds = [...eligible].filter(
    (coreId) => !exactProfiles.has(coreId),
  );
  const missingOpponentCoreIds =
    input.opportunity.enteredOpponentCoreIds.filter(
      (coreId) => !exactProfiles.has(coreId),
    );
  const selectedProfiles = [
    ...[...eligible]
      .map((coreId) => exactProfiles.get(coreId))
      .filter(
        (profile): profile is CorePerformanceProfile => profile !== undefined,
      ),
    ...input.opportunity.enteredOpponentCoreIds
      .map((coreId) => exactProfiles.get(coreId))
      .filter(
        (profile): profile is CorePerformanceProfile => profile !== undefined,
      ),
  ];
  const staleOrUnknownCoreIds = selectedProfiles
    .filter(({ freshness }) => freshness === "stale" || freshness === "unknown")
    .map(({ coreId }) => coreId);
  const hypothesisOnlyCoreIds = selectedProfiles
    .filter(({ sampleStatus }) => sampleStatus === "hypothesis_only")
    .map(({ coreId }) => coreId);
  const reasons: string[] = [];
  if (eligible.size === 0) {
    reasons.push("No owned Core is confirmed eligible for this race.");
  }
  if (missingCandidateCoreIds.length > 0) {
    reasons.push(
      "One or more eligible owned Cores lack exact-context history.",
    );
  }
  if (missingOpponentCoreIds.length > 0) {
    reasons.push("One or more entered opponents lack exact-context history.");
  }
  if (staleOrUnknownCoreIds.length > 0) {
    reasons.push("One or more exact-context profiles are stale or unknown.");
  }
  const readyForRanking = reasons.length === 0;

  return {
    raceId: input.opportunity.raceId,
    authority: input.authority,
    status: readyForRanking ? "ready" : "unavailable",
    candidateProfiles: [...eligible]
      .map((coreId) => exactProfiles.get(coreId))
      .filter(
        (profile): profile is CorePerformanceProfile => profile !== undefined,
      ),
    opponentProfiles: input.opportunity.enteredOpponentCoreIds.map(
      (coreId) => ({
        coreId,
        profile: exactProfiles.get(coreId) ?? null,
      }),
    ),
    missingCandidateCoreIds,
    missingOpponentCoreIds,
    staleOrUnknownCoreIds,
    hypothesisOnlyCoreIds,
    reasons,
    readyForRanking,
    gameEntryAllowed: false,
  };
}
