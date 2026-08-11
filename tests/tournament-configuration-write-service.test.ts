import { describe, expect, it, vi } from "vitest";

import {
  parseTournamentConfigurationFormData,
  saveTournamentConfiguration,
} from "../lib/tournament-configuration-write-service";

function validPayload() {
  return {
    tournamentId: "spring-cup-2026",
    tournamentLabel: "Spring Cup",
    seasonLabel: "Season 12",
    qualificationStartsAt: "2026-09-01T00:00:00.000Z",
    qualificationEndsAt: "2026-09-07T23:59:59.000Z",
    bracketId: "bike-a",
    splitLabel: "Bike A",
    mode: "bike",
    eligibleDistancesMetres: [1600, 1200, 1400],
    gateCount: 8,
    entryFee: { amount: "0.0100", asset: "USD" },
    raceFormat: "Paid qualification",
    eligibility: {
      breeds: ["Genesis", "Elite"],
      classes: ["Bike"],
      elements: ["Metal", "Fire"],
      fNumbers: [3, 1, 2],
      fNumberRanges: [{ minimum: 4, maximum: 6 }],
      groups: [
        {
          id: "fire-metal",
          label: "Fire + Metal",
          breeds: [],
          classes: ["Bike"],
          elements: ["Metal", "Fire"],
          fNumbers: [3, 1, 2],
          fNumberRanges: [],
        },
      ],
    },
    leaderboard: {
      splitDimension: "element_group",
      groups: [{ id: "fire-metal", label: "Fire + Metal" }],
      qualifyingRaceSemantics: "shared",
    },
    qualification: {
      minimumRaceCount: 5,
      target: { kind: "percentage", value: "10.000" },
      rankingMetric: "top_x_finishes",
      topFinishPosition: 3,
      pointsTable: { "3": "3.0", "1": "10", "2": "6" },
      customScoringConfiguration: {},
    },
    discoveryRelevance: "priority",
    evidence: {
      status: "confirmed",
      notes: "Confirmed owner-entered rules.",
      sourceEvidence: "Rules screenshot.",
      provenance: { source: "owner_entry", version: "rules-v1" },
    },
    campaignAction: {
      kind: "configured",
      action: "Review candidates",
      ownerAcknowledgedAt: "2026-08-12T00:00:00.000Z",
      evidence: "Owner acknowledgement.",
    },
  };
}

function formData(payload: Record<string, unknown> = validPayload()) {
  const formData = new FormData();
  formData.set("ruleConfiguration", JSON.stringify(payload));
  return formData;
}

describe("Tournament configuration write service", () => {
  it("normalizes the complete rule model without accepting server metadata", () => {
    const configuration = parseTournamentConfigurationFormData(formData());
    expect(configuration).toMatchObject({
      tournamentId: "spring-cup-2026",
      seasonLabel: "Season 12",
      eligibleDistancesMetres: [1200, 1400, 1600],
      gateCount: 8,
      entryFee: { amount: "0.01", asset: "USD" },
      eligibility: {
        elements: ["Fire", "Metal"],
        fNumbers: [1, 2, 3],
      },
      qualification: {
        target: { kind: "percentage", value: "10" },
        rankingMetric: "top_x_finishes",
      },
      discoveryRelevance: "priority",
    });
    expect(configuration).not.toHaveProperty("configurationVersion");
    expect(configuration).not.toHaveProperty("candidateSnapshotVersion");
    expect(configuration).not.toHaveProperty("updatedAt");
  });

  it("rejects malformed, incomplete, or client-versioned payloads", () => {
    const malformed = new FormData();
    malformed.set("ruleConfiguration", "{");
    expect(() => parseTournamentConfigurationFormData(malformed)).toThrow(
      "valid JSON",
    );

    expect(() =>
      parseTournamentConfigurationFormData(
        formData({ ...validPayload(), mode: "spaceship" }),
      ),
    ).toThrow("mode is invalid");

    expect(() =>
      parseTournamentConfigurationFormData(
        formData({ ...validPayload(), configurationVersion: "client-v1" }),
      ),
    ).toThrow("cannot set server field configurationVersion");
  });

  it("requires exact owner identity before invoking persistence", async () => {
    const saveByOwner = vi.fn(async () => undefined);
    const configuration = parseTournamentConfigurationFormData(formData());

    await expect(
      saveTournamentConfiguration({
        authenticatedOwnerId: "user_other",
        configuredOwnerId: "user_owner",
        repository: { status: "ready", saveByOwner },
        configuration,
      }),
    ).rejects.toThrow("write denied");
    expect(saveByOwner).not.toHaveBeenCalled();

    await expect(
      saveTournamentConfiguration({
        authenticatedOwnerId: "user_owner",
        configuredOwnerId: "user_owner",
        repository: { status: "ready", saveByOwner },
        configuration,
      }),
    ).resolves.toBeUndefined();
    expect(saveByOwner).toHaveBeenCalledWith("user_owner", configuration);
  });
});
