import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-publication";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { neonProLeagueEvidenceReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-evidence-generation-repository";
import { createNeonProLeagueRosterVersionRepository } from "@/lib/neon-pro-league-roster-version-repository";
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

      const combinedServingRepository =
        neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment({
          ...databaseEnvironment,
          validatedAt: verifiedAt,
        });
      const rosterVersionRepository =
        createNeonProLeagueRosterVersionRepository({
          databaseUrl: databaseEnvironment.databaseUrl,
          databaseOwnerId: databaseEnvironment.databaseOwnerId,
          ownerId,
          runtimeRole: databaseEnvironment.runtimeRole,
        });
      const state = await loadProLeagueDraftCommissioningState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        useOwnerFinalPlan: true,
        vaultRepository:
          neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
        evidenceRepository: neonProLeagueEvidenceReadRepositoryFromEnvironment({
          ...databaseEnvironment,
          ownerId,
        }),
        ownedCoreRepository: combinedServingRepository,
        currentStateRepository: combinedServingRepository,
        currentRaceRepository: combinedServingRepository,
        breedingRepository:
          neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
            ...databaseEnvironment,
            ownerId,
          }),
        syncRatePolicyRepository:
          neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment(
            databaseEnvironment,
          ),
        syncHealthRepository: combinedServingRepository,
        historyCoverageRepository:
          neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment(
            { ...databaseEnvironment, ownerId },
            DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
          ),
        rosterVersionRepository,
        substitutionSeasonYear: 2026,
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
      expect(state.roster?.draftRoster?.rosteredCoreIds).toHaveLength(25);
      expect(state.roster?.selectionMethod.rosterTarget).toBe(
        "owner_finalized_25",
      );
      expect(state.ownerPlan).toBeDefined();
      expect(state.ownerPlan?.roster).toHaveLength(25);
      expect(state.ownerPlan?.maps).toHaveLength(4);
      expect(state.ownerPlan?.requiredCoreEntries).toBe(1_021);
      expect(state.ownerPlan?.assignedCoreEntries).toBe(1_021);
      expect(state.ownerPlan?.allSlotsFilled).toBe(true);
      expect(
        state.ownerPlan?.maps.every(
          (map) =>
            map.allSlotsFilled &&
            map.lines.length === 42 &&
            map.lines.every(
              (line) =>
                line.allSlotsFilled &&
                line.coreIds.length === line.ourSlots &&
                line.ourSlots * 2 === line.totalGateEntries,
            ),
        ),
      ).toBe(true);
      expect(state.ownerPlan?.mapStrategy).toMatchObject({
        homePick: "Anchor",
        homeDeny: "Miracles",
        awayPriority: ["Anchor", "Measure", "Glory", "Miracles"],
        contingencyMap: "Miracles",
      });
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
      expect(state.currentState?.status).toBe("connected");
      expect(state.syncRatePolicy?.policy.effectiveRequestsPerMinute).toBe(30);
      expect(state.syncHealth?.connectionStatus).toBe("connected");
      expect(state.syncHealth?.lastGood).not.toBeNull();
      expect(state.historyCoverage).toMatchObject({
        connectionStatus: "connected",
        baselineStatus: "complete",
        receiptCount: 17_464,
        finishedRaceReceiptCount: 17_369,
        retainedR2Bytes: 874_370_990,
        omittedIdentityObservationCount: 1,
      });
      expect(state.readiness?.status).toBe("blocked");
      expect(state.readiness?.checks).toContainEqual(
        expect.objectContaining({
          code: "POPULATION_BENCHMARK",
          status: "block",
          requiredForProtectedPreview: true,
        }),
      );
      expect(state.readiness?.summary.blockCount).toBeGreaterThanOrEqual(1);
      expect(state.weeklyPerformance).toBeDefined();
      expect(state.weeklyPerformance?.sourceStatus).toBe("intrinsic_only");
      expect(state.weeklyPerformance?.rows).toHaveLength(25);
      expect(state.weeklyPerformance?.summary.substitutionReviewCount).toBe(0);
      expect(state.weeklyPerformance?.summary.remapReviewCount).toBe(0);
      expect(
        state.weeklyPerformance?.rows.every(
          ({ action, weeklyRaceCount }) =>
            action === "monitor" && weeklyRaceCount === null,
        ),
      ).toBe(true);
      expect(["connected", "not_configured"]).toContain(
        state.substitutionLedger?.status,
      );
      expect(state.substitutionLedger?.maximumSubstitutions).toBe(10);
      if (state.substitutionLedger?.status === "connected") {
        expect(state.substitutionLedger.usedCount).not.toBeNull();
      } else {
        expect(state.substitutionLedger?.usedCount).toBeNull();
        expect(state.substitutionLedger?.remainingCount).toBeNull();
      }
      expect(state.substitutionWatch?.candidates.length).toBeGreaterThan(0);
      expect(state.substitutionWatch?.methodology).toMatchObject({
        primaryEvidence: "same_bike_race_type_and_exact_distance",
        first16Priority: true,
        primaryMaps: ["Anchor", "Measure", "Glory"],
        contingencyMap: "Miracles",
        maximumAdjacentDistanceSteps: 1,
        automaticRosterMutationAllowed: false,
      });
      expect(
        state.substitutionWatch?.candidates.every(
          ({ recommendedScenario }) =>
            recommendedScenario.rosterCompliant &&
            recommendedScenario.allSlotsFilled &&
            recommendedScenario.assignedCoreEntries ===
              recommendedScenario.requiredCoreEntries,
        ),
      ).toBe(true);
      expect(state.readiness?.protectedPreviewDeploymentAllowed).toBe(false);
      expect(state.readiness?.productionActivationAllowed).toBe(false);
      expect(state.readiness?.rosterOrMapSubmissionAllowed).toBe(false);

      const markup = renderToStaticMarkup(
        createElement(ProLeagueCommissioningPanel, { state }),
      );
      expect(markup).toContain("Roster recommendation");
      expect(markup).toContain("Map selection &amp; deny preference");
      expect(markup).toContain("Race mapping");
      expect(markup).toContain("Roster health");
      expect(markup).toContain("Weekly roster performance");
      expect(markup).toContain("league result source pending");
      expect(markup).toContain("API lane pending");
      expect(markup).toContain("Substitution watch");
      expect(markup).toContain("Analyse");
      expect(markup).toContain("Population benchmark pending");
      expect(markup).toContain(
        "remain provisional against the whole DNA Bike population",
      );
      expect(markup).toContain("Anchor");
      expect(markup).toContain("Miracles");
      expect(markup).toContain("1,021/1,021 gate entries");
      expect(markup).not.toContain("API refresh safety");
      expect(markup).not.toContain("Breeding for roster quality");
      expect(markup).not.toContain("Discovery");

      const audit = state.roster!.draftRoster!.audit;
      console.log(
        JSON.stringify({
          status: state.connectionStatus,
          populationProfileCount: state.evidence!.populationProfileCount,
          ownedProfileCount: state.evidence!.ownedProfileCount,
          unownedProfileCount: state.evidence!.unownedProfileCount,
          ownedCoreWithoutEvidenceCount:
            state.evidence!.ownedCoreWithoutEvidenceCount,
          rosterCoreCount: audit.selectedCoreCount,
          rosterCompliant: audit.readiness === "compliant",
          femaleCount: audit.femaleCount,
          aboveF15Count: audit.aboveF15Count,
          elementCounts: audit.elementCounts,
          mapCount: state.lineup!.maps.length,
          fullGateRequiredCoreEntries: state.ownerPlan!.requiredCoreEntries,
          fullGateAssignedCoreEntries: state.ownerPlan!.assignedCoreEntries,
          fullGateComplete: state.ownerPlan!.allSlotsFilled,
          homePick: state.ownerPlan!.mapStrategy.homePick,
          homeDeny: state.ownerPlan!.mapStrategy.homeDeny,
          lineCount: state.lineup!.totals.lineCount,
          first16LineCount: state.lineup!.totals.first16LineCount,
          winningRangeLineCount: state.lineup!.totals.winningRangeLineCount,
          topThreeRangeLineCount: state.lineup!.totals.topThreeRangeLineCount,
          provisionalLineCount: state.lineup!.totals.provisionalLineCount,
          noExactEvidenceLineCount:
            state.lineup!.totals.noExactEvidenceLineCount,
          coverageGapCount: state.roster!.coverageGaps.length,
          readinessStatus: state.readiness!.status,
          readinessPassCount: state.readiness!.summary.passCount,
          readinessReviewCount: state.readiness!.summary.reviewCount,
          readinessBlockCount: state.readiness!.summary.blockCount,
          currentCoreStateStatus: state.currentState!.status,
          syncStatus: state.syncHealth!.syncStatus,
          lastGoodAvailable: state.syncHealth!.lastGood !== null,
          historyBaselineStatus: state.historyCoverage!.baselineStatus,
          discoveryExperimentCount: state.discoveryQueue!.experiments.length,
          breedingObjectiveCount: state.breedingObjectives!.objectives.length,
          substitutionLedgerStatus: state.substitutionLedger!.status,
          substitutionsUsed: state.substitutionLedger!.usedCount,
          substitutionWatchCandidateCount:
            state.substitutionWatch!.candidates.length,
          weeklyPerformanceSource: state.weeklyPerformance!.sourceStatus,
          weeklyPerformanceRowCount: state.weeklyPerformance!.rows.length,
          weeklyRemapReviewCount:
            state.weeklyPerformance!.summary.remapReviewCount,
          weeklySubstitutionReviewCount:
            state.weeklyPerformance!.summary.substitutionReviewCount,
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
