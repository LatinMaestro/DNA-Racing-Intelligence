export type TournamentCoreSelection = Readonly<{
  tournamentId: string;
  bracketId: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  coreIds: readonly string[];
  updatedAt: string;
}>;

export type TournamentCoreSelectionRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      readSelection: (
        ownerId: string,
        tournamentId: string,
        bracketId: string,
      ) => Promise<TournamentCoreSelection | null>;
      replaceSelection: (
        ownerId: string,
        selection: TournamentCoreSelection,
      ) => Promise<TournamentCoreSelection>;
    }>;

export type TournamentCoreSelectionState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "read_failed"
    | "connected";
  selection: TournamentCoreSelection | null;
}>;

export const unavailableTournamentCoreSelectionRepository: TournamentCoreSelectionRepository =
  Object.freeze({ status: "not_configured" });

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function normalizeSelection(
  value: Omit<TournamentCoreSelection, "updatedAt"> & {
    updatedAt: string | Date;
  },
): TournamentCoreSelection {
  const coreIds = value.coreIds.map((coreId) => text(coreId, "Core ID"));
  if (coreIds.length > 500 || new Set(coreIds).size !== coreIds.length) {
    throw new Error("Tournament Core selection is invalid.");
  }
  const updatedAt =
    value.updatedAt instanceof Date
      ? value.updatedAt.toISOString()
      : value.updatedAt;
  if (
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt)) ||
    new Date(updatedAt).toISOString() !== updatedAt
  ) {
    throw new Error("Tournament Core selection timestamp is invalid.");
  }
  return Object.freeze({
    tournamentId: text(value.tournamentId, "Tournament ID"),
    bracketId: text(value.bracketId, "Bracket ID"),
    configurationVersion: text(
      value.configurationVersion,
      "Configuration version",
    ),
    candidateSnapshotVersion: text(
      value.candidateSnapshotVersion,
      "Candidate snapshot version",
    ),
    coreIds: Object.freeze(coreIds),
    updatedAt,
  });
}

function authorisedOwner(
  authenticatedOwnerId: string | null,
  configuredOwnerId: string | null,
): string | null {
  const authenticated = identity(authenticatedOwnerId);
  const configured = identity(configuredOwnerId);
  if (authenticated === null || configured === null) return null;
  if (authenticated !== configured) {
    throw new Error("Tournament Core selection access denied.");
  }
  return authenticated;
}

export async function loadTournamentCoreSelectionState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentCoreSelectionRepository;
    tournamentId: string | null;
    bracketId: string | null;
  }>,
): Promise<TournamentCoreSelectionState> {
  const ownerId = authorisedOwner(
    input.authenticatedOwnerId,
    input.configuredOwnerId,
  );
  if (
    ownerId === null ||
    input.tournamentId === null ||
    input.bracketId === null
  ) {
    return { connectionStatus: "identity_not_connected", selection: null };
  }
  if (input.repository.status === "not_configured") {
    return { connectionStatus: "persistence_not_configured", selection: null };
  }
  try {
    const selection = await input.repository.readSelection(
      ownerId,
      text(input.tournamentId, "Tournament ID"),
      text(input.bracketId, "Bracket ID"),
    );
    return {
      connectionStatus: "connected",
      selection: selection === null ? null : normalizeSelection(selection),
    };
  } catch {
    return { connectionStatus: "read_failed", selection: null };
  }
}

export function parseTournamentCoreSelectionFormData(
  formData: FormData,
  now = new Date(),
): TournamentCoreSelection {
  return normalizeSelection({
    tournamentId: text(formData.get("tournamentId"), "Tournament ID"),
    bracketId: text(formData.get("bracketId"), "Bracket ID"),
    configurationVersion: text(
      formData.get("configurationVersion"),
      "Configuration version",
    ),
    candidateSnapshotVersion: text(
      formData.get("candidateSnapshotVersion"),
      "Candidate snapshot version",
    ),
    coreIds: formData.getAll("coreId").map((value) => text(value, "Core ID")),
    updatedAt: now,
  });
}

export async function saveTournamentCoreSelection(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentCoreSelectionRepository;
    selection: TournamentCoreSelection;
  }>,
): Promise<TournamentCoreSelection> {
  const ownerId = authorisedOwner(
    input.authenticatedOwnerId,
    input.configuredOwnerId,
  );
  if (ownerId === null) {
    throw new Error("Tournament Core selection identity is not connected.");
  }
  if (input.repository.status === "not_configured") {
    throw new Error("Tournament Core selection persistence is not configured.");
  }
  return normalizeSelection(
    await input.repository.replaceSelection(
      ownerId,
      normalizeSelection(input.selection),
    ),
  );
}
