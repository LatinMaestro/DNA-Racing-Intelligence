import {
  normalizeTournamentRuleConfiguration,
  type TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";

export type TournamentConfigurationWrite = Omit<
  TournamentRuleConfiguration,
  "configurationVersion" | "candidateSnapshotVersion" | "updatedAt"
>;

export type TournamentConfigurationWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveByOwner: (
        ownerId: string,
        configuration: TournamentConfigurationWrite,
      ) => Promise<void>;
    }>;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function configurationPayload(formData: FormData): Record<string, unknown> {
  const value = formData.get("ruleConfiguration");
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 100_000
  ) {
    throw new Error("Complete Tournament rule configuration is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Tournament rule configuration must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Tournament rule configuration must be a JSON object.");
  }
  const payload = parsed as Record<string, unknown>;
  for (const serverField of [
    "configurationVersion",
    "candidateSnapshotVersion",
    "updatedAt",
  ]) {
    if (serverField in payload) {
      throw new Error(
        `Tournament rule configuration cannot set server field ${serverField}.`,
      );
    }
  }
  return payload;
}

export function parseTournamentConfigurationFormData(
  formData: FormData,
): TournamentConfigurationWrite {
  const normalized = normalizeTournamentRuleConfiguration({
    ...configurationPayload(formData),
    configurationVersion: "server-derived",
    candidateSnapshotVersion: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  } as TournamentRuleConfiguration);
  if (normalized.campaignAction?.kind === "configured") {
    throw new Error(
      "Configured campaign actions must use the owner acknowledgement action.",
    );
  }
  const {
    configurationVersion,
    candidateSnapshotVersion,
    updatedAt,
    ...configuration
  } = normalized;
  void configurationVersion;
  void candidateSnapshotVersion;
  void updatedAt;
  return configuration;
}

export async function saveTournamentConfiguration(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentConfigurationWriteRepository;
    configuration: TournamentConfigurationWrite;
  }>,
): Promise<void> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    throw new Error("Tournament configuration owner identity is unavailable.");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Tournament configuration write denied.");
  }
  if (input.repository.status !== "ready") {
    throw new Error(
      "Tournament configuration write repository is not configured.",
    );
  }
  await input.repository.saveByOwner(authenticatedOwnerId, input.configuration);
}
