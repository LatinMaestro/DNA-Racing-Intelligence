import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TournamentWorkspace } from "@/components/tournament-workspace";
import { Season12TournamentSchedule } from "@/components/season-12-tournament-schedule";
import { rankTournamentCandidates } from "@/domain/tournament-candidate-ranking";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

describe("Tournament workspace", () => {
  it("renders the official Season 12 schedule without inventing missing rules", () => {
    const html = renderToStaticMarkup(<Season12TournamentSchedule />);

    expect(html).toContain("Season 12 schedule");
    expect(html).toContain("Mon 14 Sept");
    expect(html).toContain("Spin Battles");
    expect(html).toContain("1v1 Wars");
    expect(html).toContain("Double Up");
    expect(html).toContain("Spliced");
    expect(html).toContain("1,000 m · 1,800 m · 2,200 m");
    expect(html.match(/Not specified/g)?.length).toBeGreaterThan(5);
    expect(html).toContain("not a negative eligibility decision");
  });

  it("renders unavailable evidence without a fake opportunity", () => {
    const html = renderToStaticMarkup(
      <TournamentWorkspace
        brackets={[]}
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
      />,
    );

    expect(html).toContain("Tournament read model not connected");
    expect(html).toContain("No accepted tournament evidence");
    expect(html).toContain("Tournament entry unavailable");
    expect(html).toContain("Gate C not passed");
    expect(html).toContain("Calibrated tournament optimiser not commissioned");
    expect(html).not.toContain("Recommended entry");
    expect(html).not.toContain("/search-core?");
  });

  it("renders safe failure states without fake rankings", () => {
    const states = [
      ["read_failed", "Tournament evidence temporarily unavailable"],
      ["integrity_failed", "Tournament evidence failed validation"],
    ] as const;

    for (const [status, heading] of states) {
      const html = renderToStaticMarkup(
        <TournamentWorkspace
          brackets={[]}
          connectionStatus={status}
          lastImportedAt={null}
        />,
      );

      expect(html).toContain(heading);
      expect(html).toContain("No accepted tournament evidence");
      expect(html).toContain("Tournament entry unavailable");
      expect(html).not.toContain("View Core profile");
      expect(html).not.toContain("private database");
      expect(html).not.toContain("Recommended entry");
    }
  });

  it("renders split and group labels, version binding, ties and Maiden preservation", () => {
    const common = {
      leaderboardGroupId: "synthetic-group",
      leaderboardGroupLabel: "Elite Group",
      configurationVersion: "config-v3",
      candidateSnapshotVersion: "snapshot-v9",
      eligibility: "eligible" as const,
      metricStatus: "complete" as const,
      metricRank: 2,
      metricEvidenceLabel: "Qualification points",
      timeEvidence: "competitive" as const,
      historicalStarSupport: "supports" as const,
      evidenceConfidence: "medium" as const,
      maidenState: "eligible" as const,
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-21T00:00:00.000Z",
      freshness: "current" as const,
    };
    const bracket = rankTournamentCandidates({
      tournamentId: "synthetic-tournament",
      tournamentLabel: "Synthetic Tournament",
      bracketId: "synthetic-split",
      splitLabel: "Horse Sprint Split",
      mode: "horse",
      eligibleDistancesMetres: [1_200, 1_600],
      discoveryRelevance: "priority",
      qualificationMetricLabel: "Qualification points",
      configurationVersion: "config-v3",
      candidateSnapshotVersion: "snapshot-v9",
      candidates: [
        {
          ...common,
          coreId: "synthetic-core",
          maidenModeDisposition: "preferred_here",
        },
        {
          ...common,
          coreId: "preserved:core",
          maidenModeDisposition: "preserve_for_stronger_mode",
        },
        {
          ...common,
          coreId: "stale-core",
          freshness: "stale",
          dataCurrentThrough: "2026-07-10T00:00:00.000Z",
          maidenState: "not_eligible",
          maidenModeDisposition: "not_applicable",
        },
        {
          ...common,
          coreId: "unknown-core",
          eligibility: "review_required",
          metricStatus: "unavailable",
          metricRank: null,
          metricEvidenceLabel: null,
          dataCurrentThrough: null,
          lastImported: null,
          freshness: "unknown",
          maidenState: "unknown",
          maidenModeDisposition: "unresolved",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TournamentWorkspace
        brackets={[bracket]}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-21T00:00:00.000Z"
      />,
    );

    expect(html).toContain("Synthetic Tournament");
    expect(html).toContain("Horse Sprint Split");
    expect(html).toContain("Horse · 1,200 m · 1,600 m");
    expect(html).toContain("Priority Discovery relevance");
    expect(html).toContain("Elite Group");
    expect(html).toContain("Configuration config-v3");
    expect(html).toContain("Candidate snapshot snapshot-v9");
    expect(html).toContain("Group rank 2");
    expect(html).toContain("Preserve Me");
    expect(html).toContain("equal metric ranks remain ties");
    expect(html).toContain("50% race gate is a hard cap");
    expect(html).toContain("Historical tournament evidence connected");
    expect(html).toContain("Calibrated tournament optimiser not commissioned");
    expect(html).toContain("1v1 opponent-field P(win)");
    expect(html).toContain("Configured qualification probability");
    expect(html).toContain("Same-element top-10% stress P(win)");
    expect(html).toContain("Actual fee/prize economic break-even");
    expect(html).toContain("Per-race and campaign expected value");
    expect(html.match(/Not computed/g)).toHaveLength(5);
    expect(html).toContain("Historical freshness");
    expect(html).toContain("Data current through");
    expect(html).toContain("Last imported");
    expect(html).toContain('dateTime="2026-07-20T00:00:00.000Z"');
    expect(html).toContain('dateTime="2026-07-10T00:00:00.000Z"');
    expect(html).toContain("Stale");
    expect(html).toContain("Unknown");
    expect(html).toContain("Not available");
    expect(html).toContain("50% Car 1v1 P(win) screening rule");
    expect(html.match(/View Core profile/g)).toHaveLength(4);
    expect(html).toContain(
      'href="/search-core?q=preserved%3Acore&amp;coreId=preserved%3Acore"',
    );
    expect(html).toContain("Core preserved:core");
    expect(html).not.toContain("Positive-EV recommendation");
  });

  it.each([
    ["bike", "Sprint Battles", 8, "Bike", "Fire, Water", "F1–F3"],
    ["car", "Double Up", 6, "Car", "Earth", "F4"],
    ["horse", "Spliced", 2, "Horse", "Air", "F5–F7"],
  ] as const)(
    "renders the persisted %s format, gates, groupings and qualification safeguards",
    (mode, raceFormat, gateCount, coreClass, elements, fRule) => {
      const ruleConfiguration = {
        tournamentId: `${mode}-event`,
        tournamentLabel: `${mode} event`,
        seasonLabel: "Season 12",
        qualificationStartsAt: "2026-09-14T00:00:00.000Z",
        qualificationEndsAt: "2026-09-20T23:59:59.000Z",
        bracketId: `${mode}-split`,
        splitLabel: `${mode} split`,
        mode,
        eligibleDistancesMetres: [1_200, 1_800],
        gateCount,
        entryFee: { amount: "12.5", asset: "BGC" },
        raceFormat,
        eligibility: {
          breeds: mode === "horse" ? ["Genesis"] : [],
          classes: [coreClass],
          elements: elements.split(", "),
          fNumbers: mode === "car" ? [4] : [],
          fNumberRanges:
            mode === "bike"
              ? [{ minimum: 1, maximum: 3 }]
              : mode === "horse"
                ? [{ minimum: 5, maximum: 7 }]
                : [],
          groups: [
            {
              id: "eligible-alpha",
              label: `${mode} eligible Alpha`,
              breeds: [],
              classes: [coreClass],
              elements: elements.split(", "),
              fNumbers: [],
              fNumberRanges: [],
            },
          ],
        },
        leaderboard: {
          splitDimension: "element",
          groups: [{ id: "alpha", label: "Alpha" }],
          qualifyingRaceSemantics: "separate",
        },
        qualification: {
          minimumRaceCount: 5,
          target: { kind: "percentage", value: "25" },
          rankingMetric: "median_time",
          topFinishPosition: null,
          pointsTable: {},
          customScoringConfiguration: {},
        },
        discoveryRelevance: "eligible",
        evidence: {
          status: "confirmed",
          notes: "Accepted fixture evidence.",
          sourceEvidence: "Accepted fixture source.",
          provenance: {},
        },
        campaignAction: null,
        configurationVersion: `${mode}-config-v1`,
        candidateSnapshotVersion: `${mode}-snapshot-v1`,
        updatedAt: "2026-10-19T00:00:00.000Z",
      } satisfies TournamentRuleConfiguration;
      const bracket = rankTournamentCandidates({
        tournamentId: ruleConfiguration.tournamentId,
        tournamentLabel: ruleConfiguration.tournamentLabel,
        bracketId: ruleConfiguration.bracketId,
        splitLabel: ruleConfiguration.splitLabel,
        mode,
        eligibleDistancesMetres: ruleConfiguration.eligibleDistancesMetres,
        discoveryRelevance: "eligible",
        qualificationMetricLabel: "median_time",
        configurationVersion: ruleConfiguration.configurationVersion,
        candidateSnapshotVersion: ruleConfiguration.candidateSnapshotVersion!,
        ruleConfiguration,
        candidates: [],
      });
      const html = renderToStaticMarkup(
        <TournamentWorkspace
          brackets={[bracket]}
          connectionStatus="read_model_connected"
          lastImportedAt="2026-10-19T00:00:00.000Z"
        />,
      );

      expect(html).toContain(raceFormat);
      expect(html).toContain(`${gateCount} gates`);
      expect(html).toContain("12.5 BGC");
      expect(html).toContain(coreClass);
      expect(html).toContain(elements);
      expect(html).toContain(fRule);
      expect(html).toContain(`${mode} eligible Alpha`);
      expect(html).toContain("Alpha");
      expect(html).toContain("element · Separate");
      expect(html).toContain("Minimum 5 races · 25% of leaderboard");
    },
  );
});
