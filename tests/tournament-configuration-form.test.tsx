import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TournamentConfigurationForm,
  tournamentStarterConfiguration,
} from "@/components/tournament-configuration-form";
import {
  normalizeTournamentRuleConfiguration,
  type TournamentMode,
  type TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";
import { rankTournamentCandidates } from "@/domain/tournament-candidate-ranking";
import { parseTournamentConfigurationFormData } from "@/lib/tournament-configuration-write-service";

const saveAction = async (_formData: FormData): Promise<void> => {};

function syntheticBracket(mode: TournamentMode) {
  const draft = JSON.parse(tournamentStarterConfiguration(mode)) as Record<
    string,
    unknown
  >;
  const rule = normalizeTournamentRuleConfiguration({
    ...draft,
    tournamentId: `synthetic-${mode}-event`,
    tournamentLabel: `Synthetic ${mode} Cup`,
    bracketId: `synthetic-${mode}-split`,
    splitLabel: `Synthetic ${mode} split`,
    seasonLabel: "Synthetic season",
    raceFormat: "Synthetic approved format",
    entryFee: { amount: "0.01", asset: "ETH" },
    evidence: {
      status: "uncertain",
      notes: "Synthetic evidence only.",
      sourceEvidence: "Fixture, not a real event.",
      provenance: {},
    },
    configurationVersion: `rules-${mode}-v1`,
    candidateSnapshotVersion: `snapshot-${mode}-v1`,
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as TournamentRuleConfiguration);

  return rankTournamentCandidates({
    tournamentId: rule.tournamentId,
    tournamentLabel: rule.tournamentLabel,
    bracketId: rule.bracketId,
    splitLabel: rule.splitLabel,
    mode: rule.mode,
    eligibleDistancesMetres: rule.eligibleDistancesMetres,
    discoveryRelevance: rule.discoveryRelevance,
    qualificationMetricLabel: "Fastest single time",
    configurationVersion: rule.configurationVersion,
    candidateSnapshotVersion: rule.candidateSnapshotVersion!,
    ruleConfiguration: rule,
    candidates: [],
  });
}

describe("Multi-mode Tournament configuration editor", () => {
  it.each(["bike", "car", "horse"] as const)(
    "provides a review-only %s starter that round-trips through real save parsing",
    (mode) => {
      const formData = new FormData();
      formData.set("ruleConfiguration", tournamentStarterConfiguration(mode));
      const draft = parseTournamentConfigurationFormData(formData);
      expect(draft.mode).toBe(mode);
      expect(draft.tournamentId).toBe("replace-with-tournament-id");
      expect(draft.bracketId).toBe(`replace-with-${mode}-split-id`);
      expect(draft.evidence.status).toBe("uncertain");
      expect(draft.campaignAction).toBeNull();
      expect(draft.qualification.rankingMetric).toBe("fastest_single_time");
    },
  );

  it(
    "selects the exact saved Car event without replacing a different Bike or Horse split",
    () => {
    const brackets = [
      syntheticBracket("bike"),
      syntheticBracket("car"),
      syntheticBracket("horse"),
    ];
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={brackets}
        connectionStatus="read_model_connected"
        saveAction={saveAction}
        selection={{
          kind: "existing",
          tournamentId: "synthetic-car-event",
          bracketId: "synthetic-car-split",
        }}
      />,
    );
    expect(html).toContain("Synthetic bike Cup");
    expect(html).toContain("Synthetic car Cup");
    expect(html).toContain("Synthetic horse Cup");
    expect(html).toContain("Editing saved car split");
    expect(html).toContain("&quot;mode&quot;: &quot;car&quot;");
    expect(html).not.toContain("&quot;mode&quot;: &quot;bike&quot;");
    expect(html).not.toContain("&quot;mode&quot;: &quot;horse&quot;");
    expect(html).not.toContain("&quot;configurationVersion&quot;");
    expect(html).not.toContain("&quot;candidateSnapshotVersion&quot;");
    expect(html).toContain("New Bike split");
    expect(html).toContain("New Car split");
    expect(html).toContain("New Horse split");
    },
  );

  it(
    "creates a new Horse draft even when existing Bike and Car splits are present",
    () => {
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={[syntheticBracket("bike"), syntheticBracket("car")]}
        connectionStatus="read_model_connected"
        saveAction={saveAction}
        selection={{ kind: "new", mode: "horse" }}
      />,
    );
    expect(html).toContain("New horse review draft");
    expect(html).toContain("&quot;mode&quot;: &quot;horse&quot;");
    expect(html).toContain("replace-with-horse-split-id");
    expect(html).not.toContain("&quot;mode&quot;: &quot;bike&quot;");
    expect(html).toContain("The starter is review-only");
    },
  );

  it(
    "does not silently edit a different event when the selected split is absent",
    () => {
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={[syntheticBracket("bike")]}
        connectionStatus="read_model_connected"
        saveAction={saveAction}
        selection={{
          kind: "existing",
          tournamentId: "missing",
          bracketId: "missing",
        }}
      />,
    );
    expect(html).toContain("no longer exist");
    expect(html).toContain("<fieldset disabled=\"\"");
    expect(html).not.toContain("&quot;mode&quot;: &quot;bike&quot;");
    },
  );

  it(
    "does not enable owner writes when the accepted repository is disconnected",
    () => {
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={[]}
        connectionStatus="persistence_not_configured"
        saveAction={saveAction}
        selection={{ kind: "new", mode: "bike" }}
      />,
    );
    expect(html).toContain("<fieldset disabled=\"\"");
    expect(html).toContain("Configuration editing stays disabled");
    },
  );
});
