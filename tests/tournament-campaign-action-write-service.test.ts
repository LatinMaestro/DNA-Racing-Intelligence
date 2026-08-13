import { describe, expect, it, vi } from "vitest";

import {
  parseTournamentCampaignActionFormData,
  saveTournamentCampaignAction,
} from "@/lib/tournament-campaign-action-write-service";

function formData(snapshot = "snapshot-22222222222222222222222222222222") {
  const data = new FormData();
  data.set("tournamentId", "season-12");
  data.set("bracketId", "bike-a");
  data.set("configurationVersion", "cfg-11111111111111111111111111111111");
  data.set("candidateSnapshotVersion", snapshot);
  data.set("action", " Review the strongest candidates. ");
  data.set("evidence", " Confirmed rules and current candidate evidence. ");
  return data;
}

describe("Tournament campaign action write service", () => {
  it("parses exact configuration and snapshot bindings", () => {
    expect(parseTournamentCampaignActionFormData(formData())).toEqual({
      tournamentId: "season-12",
      bracketId: "bike-a",
      configurationVersion: "cfg-11111111111111111111111111111111",
      candidateSnapshotVersion: "snapshot-22222222222222222222222222222222",
      action: "Review the strongest candidates.",
      evidence: "Confirmed rules and current candidate evidence.",
    });
  });

  it("rejects unbound evidence", () => {
    expect(() =>
      parseTournamentCampaignActionFormData(formData("snapshot-unbound")),
    ).toThrow("snapshot is not bound");
  });

  it("requires the exact owner before persistence", async () => {
    const acknowledgeByOwner = vi.fn(async () => undefined);
    const acknowledgement = parseTournamentCampaignActionFormData(formData());
    await expect(
      saveTournamentCampaignAction({
        authenticatedOwnerId: "user_other",
        configuredOwnerId: "user_owner",
        repository: { status: "ready", acknowledgeByOwner },
        acknowledgement,
      }),
    ).rejects.toThrow("write denied");
    expect(acknowledgeByOwner).not.toHaveBeenCalled();

    await saveTournamentCampaignAction({
      authenticatedOwnerId: "user_owner",
      configuredOwnerId: "user_owner",
      repository: { status: "ready", acknowledgeByOwner },
      acknowledgement,
    });
    expect(acknowledgeByOwner).toHaveBeenCalledWith(
      "user_owner",
      acknowledgement,
    );
  });
});
