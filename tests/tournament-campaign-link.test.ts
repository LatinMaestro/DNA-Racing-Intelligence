import { describe, expect, it } from "vitest";

import {
  applyTournamentCampaignLinkActions,
  type HistoricalRaceCampaignFact,
  type TournamentCampaignLinkAction,
} from "@/domain/tournament-campaign-link";

const source: HistoricalRaceCampaignFact = {
  raceId: "race-1",
  sourceEventId: "event-1",
  occurredAt: "2026-07-03T10:00:00Z",
  sourceTournamentLabel: "Horse Maiden",
  sourceStageLabel: "Qualifier",
};

function linkAction(
  overrides: Partial<
    Extract<TournamentCampaignLinkAction, { kind: "link" }>
  > = {},
): Extract<TournamentCampaignLinkAction, { kind: "link" }> {
  return {
    actionId: "action-1",
    actionAt: "2026-07-10T00:00:00Z",
    expectedRevision: 0,
    kind: "link",
    reason: "Confirmed against the configured campaign.",
    link: {
      tournamentId: "horse-maiden",
      bracketId: "top-two",
      leaderboardId: "fire",
      stage: "qualification",
    },
    ...overrides,
  };
}

describe("tournament campaign link overlays", () => {
  it("links a historical race without mutating its source fact", () => {
    const result = applyTournamentCampaignLinkActions(source, [linkAction()]);

    expect(result).toEqual(
      expect.objectContaining({
        raceId: "race-1",
        revision: 1,
        effectiveLink: expect.objectContaining({
          tournamentId: "horse-maiden",
          stage: "qualification",
        }),
        rawSourceFactMutable: false,
        campaignTotalsEligible: true,
        requiresLiveConfirmation: false,
      }),
    );
    expect(result.sourceFact).toEqual({
      ...source,
      occurredAt: "2026-07-03T10:00:00.000Z",
    });
  });

  it("corrects an existing link with a complete audit trail", () => {
    const result = applyTournamentCampaignLinkActions(source, [
      linkAction(),
      {
        actionId: "action-2",
        actionAt: "2026-07-10T01:00:00Z",
        expectedRevision: 1,
        kind: "correct",
        reason: "The race belongs to the median bracket.",
        link: {
          tournamentId: "horse-maiden",
          bracketId: "double-up",
          leaderboardId: "fire",
          stage: "qualification",
        },
      },
    ]);

    expect(result.effectiveLink?.bracketId).toBe("double-up");
    expect(result.auditTrail).toHaveLength(2);
    expect(result.auditTrail[1]).toEqual(
      expect.objectContaining({
        before: expect.objectContaining({ bracketId: "top-two" }),
        after: expect.objectContaining({ bracketId: "double-up" }),
      }),
    );
  });

  it("unlinks recoverably and removes the race from campaign totals", () => {
    const result = applyTournamentCampaignLinkActions(source, [
      linkAction(),
      {
        actionId: "action-2",
        actionAt: "2026-07-10T01:00:00Z",
        expectedRevision: 1,
        kind: "unlink",
        reason: "The imported tag was not this tournament.",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        effectiveLink: null,
        previousLinkAvailable: true,
        campaignTotalsEligible: false,
        revision: 2,
      }),
    );
  });

  it("restores only the previously unlinked audited link", () => {
    const result = applyTournamentCampaignLinkActions(source, [
      linkAction(),
      {
        actionId: "action-2",
        actionAt: "2026-07-10T01:00:00Z",
        expectedRevision: 1,
        kind: "unlink",
        reason: "Temporary review hold.",
      },
      {
        actionId: "action-3",
        actionAt: "2026-07-10T02:00:00Z",
        expectedRevision: 2,
        kind: "restore",
        reason: "Evidence review confirmed the original link.",
      },
    ]);

    expect(result.effectiveLink?.bracketId).toBe("top-two");
    expect(result.previousLinkAvailable).toBe(false);
    expect(result.auditTrail[2]?.after).toEqual(result.effectiveLink);
  });

  it("rejects stale revisions and non-chronological actions", () => {
    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction(),
        {
          actionId: "action-2",
          actionAt: "2026-07-10T01:00:00Z",
          expectedRevision: 0,
          kind: "unlink",
          reason: "Stale edit.",
        },
      ]),
    ).toThrow("revision is stale");

    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction(),
        {
          actionId: "action-2",
          actionAt: "2026-07-09T01:00:00Z",
          expectedRevision: 1,
          kind: "unlink",
          reason: "Out of order.",
        },
      ]),
    ).toThrow("must be chronological");
  });

  it("requires correction rather than silently replacing a link", () => {
    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction(),
        linkAction({
          actionId: "action-2",
          actionAt: "2026-07-10T01:00:00Z",
          expectedRevision: 1,
        }),
      ]),
    ).toThrow("must use a correction");
  });

  it("rejects no-op corrections and restores without history", () => {
    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction(),
        {
          ...linkAction(),
          actionId: "action-2",
          actionAt: "2026-07-10T01:00:00Z",
          expectedRevision: 1,
          kind: "correct",
        },
      ]),
    ).toThrow("must change");

    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        {
          actionId: "action-1",
          actionAt: "2026-07-10T00:00:00Z",
          expectedRevision: 0,
          kind: "restore",
          reason: "No prior link.",
        },
      ]),
    ).toThrow("No previously unlinked");
  });

  it("requires unique action IDs and reasoned actions", () => {
    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction(),
        {
          actionId: "action-1",
          actionAt: "2026-07-10T01:00:00Z",
          expectedRevision: 1,
          kind: "unlink",
          reason: "Duplicate action ID.",
        },
      ]),
    ).toThrow("action IDs must be unique");

    expect(() =>
      applyTournamentCampaignLinkActions(source, [linkAction({ reason: " " })]),
    ).toThrow("reason is required");
  });

  it("rejects an audit action that predates the historical race", () => {
    expect(() =>
      applyTournamentCampaignLinkActions(source, [
        linkAction({ actionAt: "2026-07-01T00:00:00Z" }),
      ]),
    ).toThrow("cannot predate");
  });
});
