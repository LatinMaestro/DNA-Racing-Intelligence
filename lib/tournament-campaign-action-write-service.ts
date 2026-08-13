export type TournamentCampaignActionAcknowledgement = Readonly<{
  tournamentId: string;
  bracketId: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  action: string;
  evidence: string;
}>;

export type TournamentCampaignActionRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      acknowledgeByOwner: (
        ownerId: string,
        acknowledgement: TournamentCampaignActionAcknowledgement,
      ) => Promise<void>;
    }>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const CONFIGURATION_VERSION_PATTERN = /^cfg-[a-f0-9]{32}$/;
const SNAPSHOT_VERSION_PATTERN = /^snapshot-[a-f0-9]{32}$/;

function required(formData: FormData, name: string, maximum: number): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`${name} is required.`);
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximum) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

export function parseTournamentCampaignActionFormData(
  formData: FormData,
): TournamentCampaignActionAcknowledgement {
  const tournamentId = required(formData, "tournamentId", 100);
  const bracketId = required(formData, "bracketId", 100);
  const configurationVersion = required(formData, "configurationVersion", 128);
  const candidateSnapshotVersion = required(
    formData,
    "candidateSnapshotVersion",
    128,
  );
  if (!ID_PATTERN.test(tournamentId) || !ID_PATTERN.test(bracketId)) {
    throw new Error("Tournament campaign action identity is invalid.");
  }
  if (!CONFIGURATION_VERSION_PATTERN.test(configurationVersion)) {
    throw new Error("Tournament campaign action configuration is invalid.");
  }
  if (!SNAPSHOT_VERSION_PATTERN.test(candidateSnapshotVersion)) {
    throw new Error("Tournament campaign action snapshot is not bound.");
  }
  return {
    tournamentId,
    bracketId,
    configurationVersion,
    candidateSnapshotVersion,
    action: required(formData, "action", 200),
    evidence: required(formData, "evidence", 2_000),
  };
}

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function saveTournamentCampaignAction(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentCampaignActionRepository;
    acknowledgement: TournamentCampaignActionAcknowledgement;
  }>,
): Promise<void> {
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    throw new Error(
      "Tournament campaign action owner identity is unavailable.",
    );
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Tournament campaign action write denied.");
  }
  if (input.repository.status !== "ready") {
    throw new Error("Tournament campaign action repository is not configured.");
  }
  await input.repository.acknowledgeByOwner(
    authenticatedOwnerId,
    input.acknowledgement,
  );
}
