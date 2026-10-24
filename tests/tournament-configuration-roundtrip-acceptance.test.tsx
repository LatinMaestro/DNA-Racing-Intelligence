import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TournamentConfigurationForm } from "@/components/tournament-configuration-form";
import {
  season12DetailedCompetitionEntries,
  season12OfficialScheduleAuthority,
} from "@/domain/season-12-official-schedule";
import {
  tournamentRankingMetrics,
  type TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";
import type { TournamentCandidateRankingInput } from "@/domain/tournament-candidate-ranking";
import {
  parseTournamentConfigurationFormData,
  saveTournamentConfiguration,
  type TournamentConfigurationWrite,
} from "@/lib/tournament-configuration-write-service";
import { loadTournamentWorkspacePageState } from "@/lib/tournament-workspace-service";

const ownerId = "fixture-owner";
const importedAt = "2026-10-24T00:00:00.000Z";

function formData(payload: Record<string, unknown>): FormData {
  const result = new FormData();
  result.set("ruleConfiguration", JSON.stringify(payload));
  return result;
}

function draft(
  entry: (typeof season12DetailedCompetitionEntries)[number],
  index: number,
): Record<string, unknown> {
  if (entry.mode === null || entry.distances.kind !== "listed") {
    throw new Error("Detailed calendar fixture is incomplete.");
  }
  const rankingMetric =
    tournamentRankingMetrics[index % tournamentRankingMetrics.length]!;
  return {
    tournamentId: `fixture-season-12-${entry.date}`,
    tournamentLabel: `${entry.event} ${entry.mode} ${entry.date}`,
    seasonLabel: "Season 12 calendar fixture",
    qualificationStartsAt: null,
    qualificationEndsAt: null,
    bracketId: `fixture-${entry.mode}-${entry.date}`,
    splitLabel: `${entry.mode} calendar split`,
    mode: entry.mode,
    eligibleDistancesMetres: entry.distances.metres,
    // The official calendar does not establish gates. This value exercises the
    // storage contract only and the uncertain evidence below prevents authority.
    gateCount: 4,
    entryFee: { amount: "0", asset: "Fixture-only" },
    raceFormat: entry.event,
    eligibility: {
      breeds: [],
      classes: [],
      elements: [],
      fNumbers: [],
      fNumberRanges: [],
      groups: [],
    },
    leaderboard: {
      splitDimension: "none",
      groups: [],
      qualifyingRaceSemantics: "separate",
    },
    qualification: {
      minimumRaceCount: 1,
      target: { kind: "count", value: 1 },
      rankingMetric,
      topFinishPosition: rankingMetric === "top_x_finishes" ? 3 : null,
      pointsTable: rankingMetric === "points" ? { "1": "1" } : {},
      customScoringConfiguration:
        rankingMetric === "custom" ? { fixtureOnly: true } : {},
    },
    discoveryRelevance: "eligible",
    evidence: {
      status: "uncertain",
      notes:
        "Fixture replay only. Gates, fees, scoring, windows and leaderboard mechanics are not supplied by the calendar.",
      sourceEvidence:
        "Owner-supplied Season 12 calendar; incomplete mechanics remain unknown.",
      provenance: {
        calendarOnly: true,
        sourceImageSha256: season12OfficialScheduleAuthority.sourceImageSha256,
        publishedEligibility: entry.eligibility,
      },
    },
    campaignAction: null,
  };
}

function acceptanceHarness() {
  const stored = new Map<string, TournamentRuleConfiguration>();
  let version = 0;
  const writeRepository = {
    status: "ready" as const,
    saveByOwner: async (
      savedOwnerId: string,
      configuration: TournamentConfigurationWrite,
    ) => {
      expect(savedOwnerId).toBe(ownerId);
      version += 1;
      stored.set(`${configuration.tournamentId}:${configuration.bracketId}`, {
        ...configuration,
        configurationVersion: `fixture-cfg-${version}`,
        candidateSnapshotVersion: "snapshot-unbound",
        updatedAt: importedAt,
      });
    },
  };
  const readRepository = {
    status: "ready" as const,
    listCandidateEvidenceByOwner: async (readOwnerId: string) => {
      expect(readOwnerId).toBe(ownerId);
      const brackets: TournamentCandidateRankingInput[] = [
        ...stored.values(),
      ].map((configuration) => ({
        tournamentId: configuration.tournamentId,
        tournamentLabel: configuration.tournamentLabel,
        bracketId: configuration.bracketId,
        splitLabel: configuration.splitLabel,
        mode: configuration.mode,
        eligibleDistancesMetres: configuration.eligibleDistancesMetres,
        discoveryRelevance: configuration.discoveryRelevance,
        qualificationMetricLabel: configuration.qualification.rankingMetric,
        configurationVersion: configuration.configurationVersion,
        candidateSnapshotVersion:
          configuration.candidateSnapshotVersion ?? "snapshot-unbound",
        ruleConfiguration: configuration,
        candidates: [],
      }));
      return { brackets, lastImportedAt: importedAt };
    },
  };
  return { readRepository, stored, writeRepository };
}

describe("Tournament configuration offline round-trip acceptance", () => {
  it("creates, reloads and edits every detailed Season 12 mode/event/distance row without inventing authority", async () => {
    const harness = acceptanceHarness();

    for (const [index, entry] of season12DetailedCompetitionEntries.entries()) {
      const configuration = parseTournamentConfigurationFormData(
        formData(draft(entry, index)),
      );
      await saveTournamentConfiguration({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: harness.writeRepository,
        configuration,
      });
    }

    const firstRead = await loadTournamentWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: harness.readRepository,
      now: new Date(importedAt),
    });
    expect(firstRead.connectionStatus).toBe("read_model_connected");
    expect(firstRead.brackets).toHaveLength(9);
    expect(
      firstRead.brackets.reduce<Record<string, number>>(
        (counts, bracket) => ({
          ...counts,
          [bracket.mode]: (counts[bracket.mode] ?? 0) + 1,
        }),
        {},
      ),
    ).toEqual({ horse: 3, car: 3, bike: 3 });
    expect(
      new Set(
        firstRead.brackets.map((item) => item.ruleConfiguration?.raceFormat),
      ),
    ).toEqual(new Set(["Spin Battles", "1v1 Wars", "Double Up"]));
    expect(
      firstRead.brackets.every(
        (item) =>
          item.ruleConfiguration?.evidence.status === "uncertain" &&
          item.ruleConfiguration.candidateSnapshotVersion ===
            "snapshot-unbound",
      ),
    ).toBe(true);

    for (const bracket of firstRead.brackets) {
      const rule = bracket.ruleConfiguration!;
      const {
        configurationVersion: _configurationVersion,
        candidateSnapshotVersion: _candidateSnapshotVersion,
        updatedAt: _updatedAt,
        ...editable
      } = rule;
      void _configurationVersion;
      void _candidateSnapshotVersion;
      void _updatedAt;
      const configuration = parseTournamentConfigurationFormData(
        formData({
          ...editable,
          qualification: {
            ...editable.qualification,
            minimumRaceCount: editable.qualification.minimumRaceCount + 1,
          },
          evidence: {
            ...editable.evidence,
            notes: `${editable.evidence.notes} Edited and reloaded.`,
          },
        }),
      );
      await saveTournamentConfiguration({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: harness.writeRepository,
        configuration,
      });
    }

    const secondRead = await loadTournamentWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: harness.readRepository,
      now: new Date(importedAt),
    });
    expect(secondRead.brackets).toHaveLength(9);
    expect(
      secondRead.brackets.every(
        (item) =>
          item.ruleConfiguration?.qualification.minimumRaceCount === 2 &&
          item.ruleConfiguration.evidence.notes.endsWith(
            "Edited and reloaded.",
          ),
      ),
    ).toBe(true);

    const horse = secondRead.brackets.find(
      (item) =>
        item.mode === "horse" &&
        item.ruleConfiguration?.raceFormat === "1v1 Wars",
    )!;
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={secondRead.brackets}
        connectionStatus={secondRead.connectionStatus}
        saveAction={async () => undefined}
        selection={{
          kind: "existing",
          tournamentId: horse.tournamentId,
          bracketId: horse.bracketId,
        }}
      />,
    );
    expect(html).toContain("&quot;mode&quot;: &quot;horse&quot;");
    expect(html).toContain("1v1 Wars");
    expect(html).toContain("1000");
    expect(html).toContain("1400");
    expect(html).toContain("2200");
    expect(html).toContain("Edited and reloaded.");
    expect(html).not.toContain("&quot;configurationVersion&quot;");
  });
});
