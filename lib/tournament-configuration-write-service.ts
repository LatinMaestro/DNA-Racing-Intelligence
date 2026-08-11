export type TournamentConfigurationMode = "bike" | "car" | "horse";
export type TournamentDiscoveryRelevance = "eligible" | "priority";

export type TournamentConfigurationWrite = Readonly<{
  tournamentId: string;
  tournamentLabel: string;
  bracketId: string;
  splitLabel: string;
  mode: TournamentConfigurationMode;
  eligibleDistancesMetres: readonly number[];
  discoveryRelevance: TournamentDiscoveryRelevance;
  qualificationMetricLabel: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  updatedAt: string;
}>;

export type TournamentConfigurationWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveByOwner: (
        ownerId: string,
        configuration: TournamentConfigurationWrite,
      ) => Promise<void>;
    }>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MODES = new Set<TournamentConfigurationMode>(["bike", "car", "horse"]);
const RELEVANCE = new Set<TournamentDiscoveryRelevance>([
  "eligible",
  "priority",
]);

function text(value: FormDataEntryValue | null, label: string, max = 160): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized === "" || normalized.length > max) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function id(value: FormDataEntryValue | null, label: string): string {
  const normalized = text(value, label, 100);
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function distances(value: FormDataEntryValue | null): readonly number[] {
  const raw = text(value, "Eligible distances", 240);
  const parsed = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((item) => Number(item));
  if (
    parsed.length === 0 ||
    parsed.length > 20 ||
    parsed.some(
      (distance) =>
        !Number.isSafeInteger(distance) || distance < 100 || distance > 100000,
    )
  ) {
    throw new Error("Eligible distances are invalid.");
  }
  return [...new Set(parsed)].sort((left, right) => left - right);
}

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export function parseTournamentConfigurationFormData(
  formData: FormData,
  updatedAt: string,
): TournamentConfigurationWrite {
  const mode = text(formData.get("mode"), "Mode", 10);
  const discoveryRelevance = text(
    formData.get("discoveryRelevance"),
    "Discovery relevance",
    10,
  );
  if (!MODES.has(mode as TournamentConfigurationMode)) {
    throw new Error("Mode is invalid.");
  }
  if (!RELEVANCE.has(discoveryRelevance as TournamentDiscoveryRelevance)) {
    throw new Error("Discovery relevance is invalid.");
  }
  const parsedUpdatedAt = new Date(updatedAt);
  if (
    Number.isNaN(parsedUpdatedAt.getTime()) ||
    parsedUpdatedAt.toISOString() !== updatedAt
  ) {
    throw new Error("Tournament configuration timestamp is invalid.");
  }

  return {
    tournamentId: id(formData.get("tournamentId"), "Tournament ID"),
    tournamentLabel: text(formData.get("tournamentLabel"), "Tournament label"),
    bracketId: id(formData.get("bracketId"), "Bracket ID"),
    splitLabel: text(formData.get("splitLabel"), "Split label"),
    mode: mode as TournamentConfigurationMode,
    eligibleDistancesMetres: distances(formData.get("eligibleDistancesMetres")),
    discoveryRelevance:
      discoveryRelevance as TournamentDiscoveryRelevance,
    qualificationMetricLabel: text(
      formData.get("qualificationMetricLabel"),
      "Qualification metric label",
    ),
    configurationVersion: id(
      formData.get("configurationVersion"),
      "Configuration version",
    ),
    candidateSnapshotVersion: id(
      formData.get("candidateSnapshotVersion"),
      "Candidate snapshot version",
    ),
    updatedAt,
  };
}

export async function saveTournamentConfiguration(input: Readonly<{
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: TournamentConfigurationWriteRepository;
  configuration: TournamentConfigurationWrite;
}>): Promise<void> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    throw new Error("Tournament configuration owner identity is unavailable.");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Tournament configuration write denied.");
  }
  if (input.repository.status !== "ready") {
    throw new Error("Tournament configuration write repository is not configured.");
  }
  await input.repository.saveByOwner(authenticatedOwnerId, input.configuration);
}
