import {
  auditProLeagueRoster,
  proLeagueCurrentRules,
  proLeagueOwnerRosterStrategy,
  type ProLeagueRosterAudit,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";

export const proLeagueRosterRoles = Object.freeze([
  "nucleus",
  "optional",
  "structural_coverage",
  "marginal",
  "alternate",
] as const);

export type ProLeagueRosterRole = (typeof proLeagueRosterRoles)[number];
export type ProLeagueRosterDisposition = "rostered" | "alternate";
export type ProLeagueInitialRosterCountingPolicy =
  "unresolved" | "counts_toward_annual_limit" | "does_not_count";

export type ProLeagueRosterEvidenceSnapshot = Readonly<{
  asOf: string;
  generationId: string;
  sha256: string;
  confidence: "strong" | "moderate" | "limited" | "unavailable";
}>;

export type ProLeagueRosterVersionMemberInput = Readonly<{
  core: ProLeagueRosterCore;
  disposition: ProLeagueRosterDisposition;
  role: ProLeagueRosterRole;
  reason: string;
  evidence: ProLeagueRosterEvidenceSnapshot;
}>;

export type ProLeagueRosterVersionMember = Readonly<{
  core: ProLeagueRosterCore;
  disposition: ProLeagueRosterDisposition;
  role: ProLeagueRosterRole;
  position: number;
  reason: string;
  evidence: ProLeagueRosterEvidenceSnapshot;
}>;

export type ProLeagueRosterVersion = Readonly<{
  rosterVersionId: string;
  versionNumber: number;
  rulesetId: string;
  strategyId: string;
  initialRosterCountingPolicy: ProLeagueInitialRosterCountingPolicy;
  evidenceCutoffAt: string;
  rationale: string;
  members: readonly ProLeagueRosterVersionMember[];
  rosteredCoreIds: readonly string[];
  alternateCoreIds: readonly string[];
  audit: ProLeagueRosterAudit;
}>;

export type ProLeagueRosterSubstitution = Readonly<{
  seasonYear: number;
  substitutionNumber: number;
  fromRosterVersionId: string;
  toRosterVersionId: string;
  outgoingCoreId: string;
  incomingCoreId: string;
  reason: string;
  evidence: ProLeagueRosterEvidenceSnapshot;
}>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;

function text(value: string, label: string, maximum = 2_000): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximum) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

function instant(value: string, label: string): string {
  const normalized = text(value, label, 64);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`Pro League ${label} must be an ISO timestamp.`);
  }
  return normalized;
}

function evidenceSnapshot(
  value: ProLeagueRosterEvidenceSnapshot,
  cutoff: string,
): ProLeagueRosterEvidenceSnapshot {
  const asOf = instant(value.asOf, "roster evidence timestamp");
  if (asOf > cutoff) {
    throw new Error("Pro League roster evidence exceeds its version cutoff.");
  }
  const generationId = text(value.generationId, "evidence generation ID", 128);
  const sha256 = value.sha256.trim();
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error("Pro League roster evidence SHA-256 is invalid.");
  }
  if (
    !["strong", "moderate", "limited", "unavailable"].includes(value.confidence)
  ) {
    throw new Error("Pro League roster evidence confidence is invalid.");
  }
  return { ...value, asOf, generationId, sha256 };
}

function id(value: string, label: string): string {
  const normalized = text(value, label, 128);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

export function buildProLeagueRosterVersion(
  input: Readonly<{
    rosterVersionId: string;
    versionNumber: number;
    initialRosterCountingPolicy: ProLeagueInitialRosterCountingPolicy;
    evidenceCutoffAt: string;
    rationale: string;
    members: readonly ProLeagueRosterVersionMemberInput[];
  }>,
): ProLeagueRosterVersion {
  const rosterVersionId = id(input.rosterVersionId, "roster version ID");
  if (!Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("Pro League roster version number is invalid.");
  }
  if (
    !["unresolved", "counts_toward_annual_limit", "does_not_count"].includes(
      input.initialRosterCountingPolicy,
    )
  ) {
    throw new Error("Pro League initial-roster counting policy is invalid.");
  }
  const evidenceCutoffAt = instant(
    input.evidenceCutoffAt,
    "roster evidence cutoff",
  );
  const rationale = text(input.rationale, "roster rationale");
  if (!Array.isArray(input.members) || input.members.length > 100) {
    throw new Error("Pro League roster version members are invalid.");
  }

  const seen = new Set<string>();
  let rosterPosition = 0;
  let alternatePosition = 0;
  const members = input.members.map((member) => {
    const coreId = id(member.core.coreId, "roster Core ID");
    if (seen.has(coreId)) {
      throw new Error(`Pro League roster version repeats Core ${coreId}.`);
    }
    seen.add(coreId);
    if (
      member.disposition !== "rostered" &&
      member.disposition !== "alternate"
    ) {
      throw new Error("Pro League roster disposition is invalid.");
    }
    if (!proLeagueRosterRoles.includes(member.role)) {
      throw new Error("Pro League roster role is invalid.");
    }
    if (
      (member.disposition === "alternate") !==
      (member.role === "alternate")
    ) {
      throw new Error("Pro League alternate role and disposition must agree.");
    }
    const position =
      member.disposition === "rostered"
        ? (rosterPosition += 1)
        : (alternatePosition += 1);
    return {
      ...member,
      core: { ...member.core, coreId },
      position,
      reason: text(member.reason, "member selection reason"),
      evidence: evidenceSnapshot(member.evidence, evidenceCutoffAt),
    };
  });
  const rostered = members.filter(
    ({ disposition }) => disposition === "rostered",
  );
  const alternates = members.filter(
    ({ disposition }) => disposition === "alternate",
  );
  const audit = auditProLeagueRoster(rostered.map(({ core }) => core));
  if (audit.readiness !== "compliant") {
    throw new Error(
      `Pro League roster version is not rule-valid: ${audit.issues
        .map(({ code }) => code)
        .join(", ")}.`,
    );
  }

  return Object.freeze({
    rosterVersionId,
    versionNumber: input.versionNumber,
    rulesetId: proLeagueCurrentRules.rulesetId,
    strategyId: proLeagueOwnerRosterStrategy.strategyId,
    initialRosterCountingPolicy: input.initialRosterCountingPolicy,
    evidenceCutoffAt,
    rationale,
    members: Object.freeze(members),
    rosteredCoreIds: Object.freeze(rostered.map(({ core }) => core.coreId)),
    alternateCoreIds: Object.freeze(alternates.map(({ core }) => core.coreId)),
    audit,
  });
}

export function buildProLeagueRosterSubstitution(
  input: Readonly<{
    seasonYear: number;
    substitutionNumber: number;
    from: ProLeagueRosterVersion;
    to: ProLeagueRosterVersion;
    reason: string;
    evidence: ProLeagueRosterEvidenceSnapshot;
  }>,
): ProLeagueRosterSubstitution {
  if (
    !Number.isSafeInteger(input.seasonYear) ||
    input.seasonYear < 2026 ||
    input.seasonYear > 9999
  ) {
    throw new Error("Pro League substitution season is invalid.");
  }
  if (
    !Number.isSafeInteger(input.substitutionNumber) ||
    input.substitutionNumber < 1 ||
    input.substitutionNumber > proLeagueCurrentRules.maximumSubstitutionsPerYear
  ) {
    throw new Error("Pro League annual substitution number is invalid.");
  }
  if (input.to.versionNumber !== input.from.versionNumber + 1) {
    throw new Error(
      "Pro League substitution must connect consecutive versions.",
    );
  }
  if (
    input.from.rulesetId !== input.to.rulesetId ||
    input.from.strategyId !== input.to.strategyId
  ) {
    throw new Error(
      "Pro League substitution authority changed between versions.",
    );
  }
  const before = new Set(input.from.rosteredCoreIds);
  const after = new Set(input.to.rosteredCoreIds);
  const outgoing = [...before].filter((coreId) => !after.has(coreId));
  const incoming = [...after].filter((coreId) => !before.has(coreId));
  if (outgoing.length !== 1 || incoming.length !== 1) {
    throw new Error("Pro League substitution must exchange exactly one Core.");
  }
  return Object.freeze({
    seasonYear: input.seasonYear,
    substitutionNumber: input.substitutionNumber,
    fromRosterVersionId: input.from.rosterVersionId,
    toRosterVersionId: input.to.rosterVersionId,
    outgoingCoreId: outgoing[0]!,
    incomingCoreId: incoming[0]!,
    reason: text(input.reason, "substitution reason"),
    evidence: evidenceSnapshot(input.evidence, input.to.evidenceCutoffAt),
  });
}
