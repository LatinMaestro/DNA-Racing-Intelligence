import { describe, expect, it } from "vitest";

import {
  assessTournamentConfigurationAuthority,
  normalizeTournamentRuleConfiguration,
  type TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";
import { parseTournamentConfigurationFormData } from "@/lib/tournament-configuration-write-service";

const ownerConfirmedPartialRules: TournamentRuleConfiguration = {
  tournamentId: "car-6-gate-double-up",
  tournamentLabel: "Car 6-gate Double Up",
  seasonLabel: "Unspecified",
  qualificationStartsAt: null,
  qualificationEndsAt: null,
  bracketId: "spliced-by-element",
  splitLabel: "Spliced by element",
  mode: "car",
  eligibleDistancesMetres: [1200, 1600, 2000],
  gateCount: 6,
  entryFee: { amount: "0", asset: "Unspecified" },
  raceFormat: "Double Up",
  eligibility: {
    breeds: ["Spliced"],
    classes: [],
    elements: ["Earth", "Fire", "Metal", "Water"],
    fNumbers: [],
    fNumberRanges: [],
    groups: [],
  },
  leaderboard: {
    splitDimension: "element",
    groups: [
      { id: "earth", label: "Earth" },
      { id: "fire", label: "Fire" },
      { id: "metal", label: "Metal" },
      { id: "water", label: "Water" },
    ],
    qualifyingRaceSemantics: "separate",
  },
  qualification: {
    minimumRaceCount: 1,
    target: { kind: "count", value: 1 },
    rankingMetric: "custom",
    topFinishPosition: null,
    pointsTable: {},
    customScoringConfiguration: { status: "unconfirmed" },
  },
  discoveryRelevance: "priority",
  evidence: {
    status: "uncertain",
    notes:
      "Mode, gates, format, spliced eligibility, distances and element segmentation are owner-confirmed; remaining rules are unavailable.",
    sourceEvidence: "Owner direction dated 26 October 2026.",
    provenance: { source: "owner_direction", acceptedDataCutoff: "2026-10-26" },
  },
  campaignAction: null,
  configurationVersion: "offline-owner-replay",
  candidateSnapshotVersion: null,
  updatedAt: "2026-10-27T00:00:00.000Z",
};

describe("owner Car Tournament partial-rule replay", () => {
  it("preserves confirmed fields while withholding an actionable recommendation", () => {
    const normalized = normalizeTournamentRuleConfiguration(
      ownerConfirmedPartialRules,
    );
    expect(normalized).toMatchObject({
      mode: "car",
      gateCount: 6,
      raceFormat: "Double Up",
      eligibleDistancesMetres: [1200, 1600, 2000],
      eligibility: {
        breeds: ["Spliced"],
        elements: ["Earth", "Fire", "Metal", "Water"],
      },
    });
    expect(assessTournamentConfigurationAuthority(normalized)).toEqual({
      status: "review_required",
      reasons: [
        "CANDIDATE_SNAPSHOT_UNBOUND",
        "ENTRY_FEE_RULE_INCOMPLETE",
        "QUALIFICATION_WINDOW_INCOMPLETE",
        "RULE_EVIDENCE_UNCERTAIN",
        "SEASON_RULE_INCOMPLETE",
      ],
      actionableRecommendationAllowed: false,
    });
  });

  it("rejects the incomplete owner rules before the write repository is called", () => {
    const {
      configurationVersion,
      candidateSnapshotVersion,
      updatedAt,
      ...payload
    } = ownerConfirmedPartialRules;
    void configurationVersion;
    void candidateSnapshotVersion;
    void updatedAt;
    const form = new FormData();
    form.set("ruleConfiguration", JSON.stringify(payload));
    expect(() => parseTournamentConfigurationFormData(form)).toThrow(
      "Tournament rule configuration still contains review placeholders: seasonLabel, entryFee.asset.",
    );
  });
});
