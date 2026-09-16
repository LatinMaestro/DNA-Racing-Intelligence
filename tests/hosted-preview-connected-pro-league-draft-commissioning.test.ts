import { describe, expect, it } from "vitest";

import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { neonProLeagueEvidenceReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-evidence-generation-repository";
import { loadProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

const connected =
  process.env.PRO_LEAGUE_DRAFT_COMMISSIONING_VERIFICATION === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("hosted Preview Pro League draft commissioning", () => {
  it(
    "builds one compliant roster and all four maps without exposing private rows",
    async () => {
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseEnvironment = {
        databaseUrl: requiredEnvironment("DATABASE_URL"),
        databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
        runtimeRole: "dna_app_runtime",
      };
      const verifiedAt = requiredEnvironment(
        "PRO_LEAGUE_DRAFT_COMMISSIONING_VERIFIED_AT",
      );
      const now = new Date(verifiedAt);
      if (
        Number.isNaN(now.getTime()) ||
        now.toISOString() !== verifiedAt ||
        now.getTime() > Date.now()
      ) {
        throw new Error("Pro League draft verification time is invalid");
      }

      const state = await loadProLeagueDraftCommissioningState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        vaultRepository:
          neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
        evidenceRepository: neonProLeagueEvidenceReadRepositoryFromEnvironment({
          ...databaseEnvironment,
          ownerId,
        }),
        now,
      });

      expect(state.connectionStatus).toBe("read_model_connected");
      expect(state.evidence).not.toBeNull();
      expect(state.roster?.draftRoster).not.toBeNull();
      expect(state.roster?.search.status).toBe("constructed");
      expect(state.roster?.draftRoster?.audit).toMatchObject({
        readiness: "compliant",
        issues: [],
      });
      expect(state.roster?.draftRoster?.initialRosterCountingPolicy).toBe(
        "does_not_count",
      );
      expect(
        state.roster?.draftRoster?.rosteredCoreIds.length,
      ).toBeGreaterThanOrEqual(12);
      expect(
        state.roster?.draftRoster?.rosteredCoreIds.length,
      ).toBeLessThanOrEqual(25);
      expect(state.lineup?.maps).toHaveLength(4);
      expect(state.lineup?.maps.every(({ lines }) => lines.length === 42)).toBe(
        true,
      );
      expect(state.lineup?.totals).toMatchObject({
        lineCount: 168,
        first16LineCount: 64,
      });
      expect(state.mapPreparation?.matchActionAllowed).toBe(false);
      expect(state.discoveryQueue?.automaticRaceEntryAllowed).toBe(false);
      expect(state.discoveryQueue?.automaticRosterMutationAllowed).toBe(false);

      const audit = state.roster!.draftRoster!.audit;
      console.log(
        JSON.stringify({
          status: state.connectionStatus,
          populationProfileCount: state.evidence!.populationProfileCount,
          ownedProfileCount: state.evidence!.ownedProfileCount,
          ownedCoreWithoutEvidenceCount:
            state.evidence!.ownedCoreWithoutEvidenceCount,
          rosterCoreCount: audit.selectedCoreCount,
          rosterCompliant: audit.readiness === "compliant",
          femaleCount: audit.femaleCount,
          aboveF15Count: audit.aboveF15Count,
          elementCounts: audit.elementCounts,
          mapCount: state.lineup!.maps.length,
          lineCount: state.lineup!.totals.lineCount,
          first16LineCount: state.lineup!.totals.first16LineCount,
          winningRangeLineCount: state.lineup!.totals.winningRangeLineCount,
          topThreeRangeLineCount: state.lineup!.totals.topThreeRangeLineCount,
          provisionalLineCount: state.lineup!.totals.provisionalLineCount,
          noExactEvidenceLineCount:
            state.lineup!.totals.noExactEvidenceLineCount,
          coverageGapCount: state.roster!.coverageGaps.length,
          initialRosterConsumesSubstitution: false,
          automaticActionAllowed: false,
          previewOnly: true,
          persistentWritePerformed: false,
          paidUsageAllowed: false,
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA").toLowerCase(),
          verifiedAt,
        }),
      );
    },
    30 * 60_000,
  );
});
