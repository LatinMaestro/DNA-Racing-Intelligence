import { buildCoreEsportsPerformanceProfiles, type CoreEsportsRaceObservation } from "@/domain/core-esports-performance";
import type { ProLeagueOwnerCommissioningPlan } from "@/domain/pro-league-owner-commissioning-plan";
import type { ProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";
import type { ProLeagueSubstitutionWatch } from "@/domain/pro-league-substitution-watch";
import {
  buildProLeagueWeeklyRosterPerformance,
  type ProLeagueWeeklyRosterPerformance,
} from "@/domain/pro-league-weekly-roster-performance";

export type ProLeagueWeeklyEsportsRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listRaceObservationsByOwner: (
        ownerId: string,
      ) => Promise<
        Readonly<{
          observations: readonly CoreEsportsRaceObservation[];
          lastSyncedAt: string | null;
        }>
      >;
    }>;

export const unavailableProLeagueWeeklyEsportsRepository: ProLeagueWeeklyEsportsRepository =
  Object.freeze({ status: "not_configured" });

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(\`Pro League weekly \${label} is invalid.\`);
  }
  return value;
}

export async function loadProLeagueWeeklyRosterPerformance(input: Readonly<{
  ownerId: string;
  roster: ProLeagueDraftRosterRecommendation;
  ownerPlan: ProLeagueOwnerCommissioningPlan;
  substitutionWatch?: ProLeagueSubstitutionWatch;
  esportsRepository?: ProLeagueWeeklyEsportsRepository;
  now: Date;
}>): Promise<ProLeagueWeeklyRosterPerformance> {
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Pro League weekly performance time is invalid.");
  }
  const repository =
    input.esportsRepository ?? unavailableProLeagueWeeklyEsportsRepository;
  if (repository.status === "not_configured") {
    return buildProLeagueWeeklyRosterPerformance({
      roster: input.roster,
      ownerPlan: input.ownerPlan,
      ...(input.substitutionWatch === undefined
        ? {}
        : { substitutionWatch: input.substitutionWatch }),
      esportsSourceConnected: false,
      now: input.now,
    });
  }
  const projection = await repository.listRaceObservationsByOwner(input.ownerId);
  const lastSyncedAt =
    projection.lastSyncedAt === null
      ? null
      : timestamp(projection.lastSyncedAt, "Esports sync timestamp");
  if (projection.observations.length > 0 && lastSyncedAt === null) {
    throw new Error(
      "Pro League weekly Esports observations require a sync timestamp.",
    );
  }
  if (
    lastSyncedAt !== null &&
    projection.observations.some(
      ({ observedAt }) => Date.parse(observedAt) > Date.parse(lastSyncedAt),
    )
  ) {
    throw new Error(
      "Pro League weekly Esports evidence follows its sync timestamp.",
    );
  }
  // Reuse the existing Esports domain validator before weekly monitoring consumes
  // any repository observation. The resulting aggregate is intentionally not
  // substituted for the per-race weekly window.
  buildCoreEsportsPerformanceProfiles({
    observations: projection.observations,
    now: input.now,
  });
  return buildProLeagueWeeklyRosterPerformance({
    roster: input.roster,
    ownerPlan: input.ownerPlan,
    ...(input.substitutionWatch === undefined
      ? {}
      : { substitutionWatch: input.substitutionWatch }),
    esportsObservations: projection.observations,
    esportsSourceConnected: true,
    now: input.now,
  });
}
