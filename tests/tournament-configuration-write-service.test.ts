import { describe, expect, it, vi } from "vitest";

import {
  parseTournamentConfigurationFormData,
  saveTournamentConfiguration,
} from "../lib/tournament-configuration-write-service";

function validFormData() {
  const formData = new FormData();
  formData.set("tournamentId", "spring-cup-2026");
  formData.set("tournamentLabel", "Spring Cup");
  formData.set("bracketId", "bike-a");
  formData.set("splitLabel", "Bike A");
  formData.set("mode", "bike");
  formData.set("eligibleDistancesMetres", "1600, 1200, 1600, 1400");
  formData.set("discoveryRelevance", "priority");
  formData.set("qualificationMetricLabel", "Qualification points");
  formData.set("configurationVersion", "config-2");
  formData.set("candidateSnapshotVersion", "snapshot-3");
  return formData;
}

describe("Tournament configuration write service", () => {
  it("normalizes a valid owner configuration form", () => {
    expect(
      parseTournamentConfigurationFormData(
        validFormData(),
        "2026-08-11T10:30:00.000Z",
      ),
    ).toEqual({
      tournamentId: "spring-cup-2026",
      tournamentLabel: "Spring Cup",
      bracketId: "bike-a",
      splitLabel: "Bike A",
      mode: "bike",
      eligibleDistancesMetres: [1200, 1400, 1600],
      discoveryRelevance: "priority",
      qualificationMetricLabel: "Qualification points",
      configurationVersion: "config-2",
      candidateSnapshotVersion: "snapshot-3",
      updatedAt: "2026-08-11T10:30:00.000Z",
    });
  });

  it("rejects invalid mode and invalid distance evidence", () => {
    const invalidMode = validFormData();
    invalidMode.set("mode", "spaceship");
    expect(() =>
      parseTournamentConfigurationFormData(
        invalidMode,
        "2026-08-11T10:30:00.000Z",
      ),
    ).toThrow("Mode is invalid");

    const invalidDistance = validFormData();
    invalidDistance.set("eligibleDistancesMetres", "1200, nope");
    expect(() =>
      parseTournamentConfigurationFormData(
        invalidDistance,
        "2026-08-11T10:30:00.000Z",
      ),
    ).toThrow("Eligible distances are invalid");
  });

  it("requires exact owner identity before invoking persistence", async () => {
    const saveByOwner = vi.fn(async () => undefined);
    const configuration = parseTournamentConfigurationFormData(
      validFormData(),
      "2026-08-11T10:30:00.000Z",
    );

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
