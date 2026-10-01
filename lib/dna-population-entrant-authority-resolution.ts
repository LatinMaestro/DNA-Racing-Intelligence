import { replayDnaPopulationEntrantAuthority } from "./dna-population-entrant-authority-replay";
import type {
  DnaPopulationEntrantAuthorityQuarantineReason,
  DnaPopulationEntrantAuthorityRecord,
} from "./dna-population-entrant-authority-record";

export const DNA_POPULATION_ENTRANT_AUTHORITY_RESOLUTION_VERSION =
  "dna-population-entrant-authority-resolution/v1" as const;

export type DnaPopulationEntrantAuthorityResolution = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_RESOLUTION_VERSION;
  status: "resolved_authority_complete" | "coverage_complete_with_quarantine";
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  recordSetSha256: string;
  resolvedRaceCount: number;
  quarantinedRaceCount: number;
  quarantinedRaceCountByReason: Readonly<
    Record<DnaPopulationEntrantAuthorityQuarantineReason, number>
  >;
  quarantinedRaceSetSha256: string | null;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

/**
 * Distinguishes complete compact-record coverage from complete resolved
 * Race-to-Core authority. Strict replay proves the exact audited Race set;
 * any quarantine keeps the authority fail-closed for downstream use.
 */
export function resolveDnaPopulationEntrantAuthority(input: {
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
}): DnaPopulationEntrantAuthorityResolution {
  const replay = replayDnaPopulationEntrantAuthority(input);

  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_RESOLUTION_VERSION,
    status:
      replay.quarantinedRaceCount === 0
        ? ("resolved_authority_complete" as const)
        : ("coverage_complete_with_quarantine" as const),
    unresolvedRaceCount: replay.authority.unresolvedRaceCount,
    unresolvedRaceSetSha256: replay.authority.unresolvedRaceSetSha256,
    recordSetSha256: replay.recordSetSha256,
    resolvedRaceCount: replay.resolvedRaceCount,
    quarantinedRaceCount: replay.quarantinedRaceCount,
    quarantinedRaceCountByReason: replay.quarantinedRaceCountByReason,
    quarantinedRaceSetSha256: replay.quarantinedRaceSetSha256,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
