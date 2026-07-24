export const tournamentCampaignStages = [
  "qualification",
  "round",
  "final",
] as const;
export type TournamentCampaignStage = (typeof tournamentCampaignStages)[number];

export type TournamentCampaignLink = Readonly<{
  tournamentId: string;
  bracketId: string | null;
  leaderboardId: string | null;
  stage: TournamentCampaignStage;
}>;

export type TournamentCampaignLinkAction =
  | Readonly<{
      actionId: string;
      actionAt: string;
      expectedRevision: number;
      kind: "link";
      reason: string;
      link: TournamentCampaignLink;
    }>
  | Readonly<{
      actionId: string;
      actionAt: string;
      expectedRevision: number;
      kind: "correct";
      reason: string;
      link: TournamentCampaignLink;
    }>
  | Readonly<{
      actionId: string;
      actionAt: string;
      expectedRevision: number;
      kind: "unlink";
      reason: string;
    }>
  | Readonly<{
      actionId: string;
      actionAt: string;
      expectedRevision: number;
      kind: "restore";
      reason: string;
    }>;

export type HistoricalRaceCampaignFact = Readonly<{
  raceId: string;
  sourceEventId: string;
  occurredAt: string;
  sourceTournamentLabel: string | null;
  sourceStageLabel: string | null;
}>;

export type TournamentCampaignLinkAudit = Readonly<{
  actionId: string;
  actionAt: string;
  revision: number;
  kind: TournamentCampaignLinkAction["kind"];
  reason: string;
  before: TournamentCampaignLink | null;
  after: TournamentCampaignLink | null;
}>;

export type TournamentCampaignLinkState = Readonly<{
  raceId: string;
  sourceEventId: string;
  sourceFact: HistoricalRaceCampaignFact;
  effectiveLink: TournamentCampaignLink | null;
  previousLinkAvailable: boolean;
  revision: number;
  auditTrail: readonly TournamentCampaignLinkAudit[];
  rawSourceFactMutable: false;
  campaignTotalsEligible: boolean;
  requiresLiveConfirmation: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Expected revision must be a non-negative safe integer.");
  }
  return value;
}

function normalizeLink(link: TournamentCampaignLink): TournamentCampaignLink {
  if (!tournamentCampaignStages.includes(link.stage)) {
    throw new Error("Tournament campaign stage is invalid.");
  }
  return {
    tournamentId: required(link.tournamentId, "Tournament ID"),
    bracketId: optional(link.bracketId),
    leaderboardId: optional(link.leaderboardId),
    stage: link.stage,
  };
}

function sameLink(
  left: TournamentCampaignLink | null,
  right: TournamentCampaignLink | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.tournamentId === right.tournamentId &&
    left.bracketId === right.bracketId &&
    left.leaderboardId === right.leaderboardId &&
    left.stage === right.stage
  );
}

function normalizeSource(
  input: HistoricalRaceCampaignFact,
): HistoricalRaceCampaignFact {
  return {
    raceId: required(input.raceId, "Race ID"),
    sourceEventId: required(input.sourceEventId, "Source event ID"),
    occurredAt: timestamp(input.occurredAt, "Race timestamp"),
    sourceTournamentLabel: optional(input.sourceTournamentLabel),
    sourceStageLabel: optional(input.sourceStageLabel),
  };
}

export function applyTournamentCampaignLinkActions(
  source: HistoricalRaceCampaignFact,
  actions: readonly TournamentCampaignLinkAction[],
): TournamentCampaignLinkState {
  const sourceFact = normalizeSource(source);
  const actionIds = actions.map((action) =>
    required(action.actionId, "Link action ID"),
  );
  if (new Set(actionIds).size !== actionIds.length) {
    throw new Error("Campaign link action IDs must be unique.");
  }

  let effectiveLink: TournamentCampaignLink | null = null;
  let previousLink: TournamentCampaignLink | null = null;
  let currentRevision = 0;
  let previousActionAt: number | null = null;
  const auditTrail: TournamentCampaignLinkAudit[] = [];

  for (const action of actions) {
    if (!["link", "correct", "unlink", "restore"].includes(action.kind)) {
      throw new Error("Campaign link action kind is invalid.");
    }
    const actionAt = timestamp(action.actionAt, "Link action timestamp");
    const actionTime = Date.parse(actionAt);
    if (actionTime < Date.parse(sourceFact.occurredAt)) {
      throw new Error(
        "Campaign link action cannot predate the historical race.",
      );
    }
    if (previousActionAt !== null && actionTime < previousActionAt) {
      throw new Error("Campaign link actions must be chronological.");
    }
    previousActionAt = actionTime;

    if (revision(action.expectedRevision) !== currentRevision) {
      throw new Error("Campaign link action revision is stale.");
    }
    const reason = required(action.reason, "Link action reason");
    const before: TournamentCampaignLink | null = effectiveLink;
    let after: TournamentCampaignLink | null;

    switch (action.kind) {
      case "link":
        if (effectiveLink !== null) {
          throw new Error("A linked race must use a correction action.");
        }
        after = normalizeLink(action.link);
        previousLink = null;
        break;
      case "correct":
        if (effectiveLink === null) {
          throw new Error("An unlinked race cannot be corrected.");
        }
        after = normalizeLink(action.link);
        if (sameLink(before, after)) {
          throw new Error("A correction must change the campaign link.");
        }
        previousLink = before;
        break;
      case "unlink":
        if (effectiveLink === null) {
          throw new Error("An unlinked race cannot be unlinked again.");
        }
        previousLink = effectiveLink;
        after = null;
        break;
      case "restore":
        if (effectiveLink !== null || previousLink === null) {
          throw new Error("No previously unlinked campaign link is available.");
        }
        after = previousLink;
        previousLink = null;
        break;
      default:
        throw new Error("Campaign link action kind is invalid.");
    }

    currentRevision += 1;
    effectiveLink = after;
    auditTrail.push({
      actionId: required(action.actionId, "Link action ID"),
      actionAt,
      revision: currentRevision,
      kind: action.kind,
      reason,
      before,
      after,
    });
  }

  return {
    raceId: sourceFact.raceId,
    sourceEventId: sourceFact.sourceEventId,
    sourceFact,
    effectiveLink,
    previousLinkAvailable: effectiveLink === null && previousLink !== null,
    revision: currentRevision,
    auditTrail,
    rawSourceFactMutable: false,
    campaignTotalsEligible: effectiveLink !== null,
    requiresLiveConfirmation: false,
  };
}
