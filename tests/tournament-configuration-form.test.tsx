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
  it("parses a review-only starter for every mode", () => {
    for (const mode of ["bike", "car", "horse"] as const) {
      const formData = new FormData();
      formData.set("ruleConfiguration", tournamentStarterConfiguration(mode));
      const draft = parseTournamentConfigurationFormData(formData);
      expect(draft.mode).toBe(mode);
      expect(draft.bracketId).toBe(`replace-with-${mode}-split-id`);
      expect(draft.evidence.status).toBe("uncertain");
      expect(draft.campaignAction).toBeNull();
    }
  });

  it("edits the exact saved Car split", () => {
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={[
          syntheticBracket("bike"),
          syntheticBracket("car"),
          syntheticBracket("horse"),
        ]}
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
    expect(html).toContain("&quot;mode&quot;: &quot;car&quot;");
    expect(html).not.toContain("&quot;mode&quot;: &quot;bike&quot;");
    expect(html).not.toContain("&quot;configurationVersion&quot;");
  });

  it("creates a new Horse split without replacing a Bike one", () => {
    const html = renderToStaticMarkup(
      <TournamentConfigurationForm
        brackets={[syntheticBracket("bike")]}
        connectionStatus="read_model_connected"
        saveAction={saveAction}
        selection={{ kind: "new", mode: "horse" }}
      />,
    );
    expect(html).toContain("&quot;mode&quot;: &quot;horse&quot;");
    expect(html).toContain("replace-with-horse-split-id");
    expect(html).not.toContain("&quot;mode&quot;: &quot;bike&quot;");
  });

  it("disables editing when an exact saved split is missing", () => {
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
    expect(html).toContain("no longer exists");
    expect(html).toContain("<fieldset disabled=\"\"");
  });
});
