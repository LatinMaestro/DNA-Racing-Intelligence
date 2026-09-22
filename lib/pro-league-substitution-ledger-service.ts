import { proLeagueCurrentRules } from "@/domain/pro-league-roster";
import type {
  ProLeagueRosterVersionRepository,
  StoredProLeagueRosterSubstitution,
} from "@/lib/neon-pro-league-roster-version-repository";

export type ProLeagueSubstitutionLedgerState = Readonly<{
  status: "connected" | "not_configured" | "invalid_state";
  seasonYear: number;
  maximumSubstitutions: number;
  usedCount: number | null;
  remainingCount: number | null;
  substitutions: readonly Readonly<{
    substitutionNumber: number;
    recordedAt: string;
  }>[];
}>;

function unavailable(
  status: "not_configured" | "invalid_state",
  seasonYear: number,
): ProLeagueSubstitutionLedgerState {
  return Object.freeze({
    status,
    seasonYear,
    maximumSubstitutions: proLeagueCurrentRules.maximumSubstitutionsPerYear,
    usedCount: null,
    remainingCount: null,
    substitutions: Object.freeze([]),
  });
}

export async function loadProLeagueSubstitutionLedgerState(
  input: Readonly<{
    ownerId: string;
    seasonYear: number;
    repository: Pick<
      ProLeagueRosterVersionRepository,
      "listSubstitutions"
    > | null;
  }>,
): Promise<ProLeagueSubstitutionLedgerState> {
  if (
    !Number.isSafeInteger(input.seasonYear) ||
    input.seasonYear < 2026 ||
    input.seasonYear > 9999
  ) {
    throw new Error("Pro League substitution ledger season is invalid.");
  }
  if (input.repository === null) {
    return unavailable("not_configured", input.seasonYear);
  }
  let substitutions: readonly StoredProLeagueRosterSubstitution[];
  try {
    substitutions = await input.repository.listSubstitutions(
      input.ownerId,
      input.seasonYear,
    );
  } catch {
    return unavailable("invalid_state", input.seasonYear);
  }
  if (
    substitutions.length > proLeagueCurrentRules.maximumSubstitutionsPerYear ||
    substitutions.some(
      (value, index) =>
        value.seasonYear !== input.seasonYear ||
        value.substitutionNumber !== index + 1,
    )
  ) {
    return unavailable("invalid_state", input.seasonYear);
  }
  const usedCount = substitutions.length;
  return Object.freeze({
    status: "connected" as const,
    seasonYear: input.seasonYear,
    maximumSubstitutions: proLeagueCurrentRules.maximumSubstitutionsPerYear,
    usedCount,
    remainingCount:
      proLeagueCurrentRules.maximumSubstitutionsPerYear - usedCount,
    substitutions: Object.freeze(
      substitutions.map(({ substitutionNumber, recordedAt }) =>
        Object.freeze({ substitutionNumber, recordedAt }),
      ),
    ),
  });
}
