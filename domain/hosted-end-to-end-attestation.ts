import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_JOURNEYS = [
  "fail_closed_access",
  "import_upload_preview_confirmation",
  "import_processing_completion_recovery",
  "vault_core_discovery_reads",
  "tournament_maiden_reads",
  "breeding_lifecycle_reads",
  "vault_performance_economics",
  "open_race_stage_boundary",
  "readiness_non_activation",
] as const;

const COMMAND_BY_JOURNEY = {
  fail_closed_access: "e2e_verify_fail_closed_access",
  import_upload_preview_confirmation: "e2e_verify_import_upload_preview",
  import_processing_completion_recovery: "e2e_verify_import_recovery",
  vault_core_discovery_reads: "e2e_verify_intelligence_reads",
  tournament_maiden_reads: "e2e_verify_tournament_maiden",
  breeding_lifecycle_reads: "e2e_verify_breeding_lifecycle",
  vault_performance_economics: "e2e_verify_vault_performance",
  open_race_stage_boundary: "e2e_verify_open_race_boundary",
  readiness_non_activation: "e2e_verify_readiness_non_activation",
} as const;

const PROVIDER_JOURNEYS = new Set<HostedEndToEndJourney>([
  "import_upload_preview_confirmation",
  "import_processing_completion_recovery",
  "vault_performance_economics",
]);

export type HostedEndToEndJourney = (typeof REQUIRED_JOURNEYS)[number];
export type HostedEndToEndCommandId =
  (typeof COMMAND_BY_JOURNEY)[HostedEndToEndJourney];

export type HostedEndToEndJourneyAttestation = Readonly<{
  attestationId: string;
  journey: HostedEndToEndJourney;
  commandId: HostedEndToEndCommandId;
  headSha: string;
  routeManifestSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  checkpointsPassed: number;
  checkpointsTotal: number;
  browserExecutionComplete: boolean;
  ownerBoundaryVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
  connectedProviderEvidence: boolean;
  productionDisabled: boolean;
  publicRouteExposed: boolean;
  productionMutationObserved: boolean;
}>;

export type HostedEndToEndAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  routeManifestSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedEndToEndJourneyAttestation[];
}>;

export type HostedEndToEndAttestationIssue = Readonly<{
  code:
    | "JOURNEY_MISSING"
    | "JOURNEY_STALE"
    | "COMMAND_MISMATCH"
    | "ROUTE_MANIFEST_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "CHECKPOINTS_INCOMPLETE"
    | "BROWSER_EXECUTION_INCOMPLETE"
    | "OWNER_BOUNDARY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "PROVIDER_EVIDENCE_UNCONNECTED"
    | "PRODUCTION_NOT_DISABLED"
    | "PUBLIC_ROUTE_EXPOSED"
    | "PRODUCTION_MUTATION_OBSERVED"
    | "INVALID_TIME_ORDER";
  journey: HostedEndToEndJourney;
  severity: "review" | "block";
}>;

export type HostedEndToEndAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedJourneys: readonly HostedEndToEndJourney[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedEndToEndAttestationIssue[];
  privateArtifactsRetained: false;
  workflowDispatchAllowed: false;
  mergeAllowed: false;
  providerMutationAllowed: false;
  productionMutationAllowed: false;
}>;

function requiredText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
}

function exactSha(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      `${field} must contain 40 lowercase hexadecimal characters.`,
    );
  }
}

function sha256(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `${field} must contain 64 lowercase hexadecimal characters.`,
    );
  }
}

function exactUtc(value: string, field: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${field} must be an exact UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function assertRuntimeShape(input: HostedEndToEndAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.routeManifestSha256, "Route-manifest digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("End-to-end attestations must be an array.");
  }

  const ids = new Set<string>();
  const journeys = new Set<HostedEndToEndJourney>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_JOURNEYS.includes(attestation.journey)) {
      throw new Error("End-to-end journey is invalid.");
    }
    if (journeys.has(attestation.journey)) {
      throw new Error(
        `End-to-end journey ${attestation.journey} must be unique.`,
      );
    }
    journeys.add(attestation.journey);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.journey} head`);
    sha256(
      attestation.routeManifestSha256,
      `${attestation.journey} route-manifest digest`,
    );
    sha256(
      attestation.fixtureManifestSha256,
      `${attestation.journey} fixture-manifest digest`,
    );
    exactUtc(attestation.startedAt, `${attestation.journey} start`);
    exactUtc(attestation.completedAt, `${attestation.journey} completion`);
    nonNegativeInteger(attestation.exitCode, `${attestation.journey} exit`);
    sha256(attestation.summarySha256, `${attestation.journey} summary`);
    nonNegativeInteger(
      attestation.checkpointsPassed,
      `${attestation.journey} passed checkpoints`,
    );
    positiveInteger(
      attestation.checkpointsTotal,
      `${attestation.journey} total checkpoints`,
    );
    for (const [field, value] of Object.entries({
      browserExecutionComplete: attestation.browserExecutionComplete,
      ownerBoundaryVerified: attestation.ownerBoundaryVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
      connectedProviderEvidence: attestation.connectedProviderEvidence,
      productionDisabled: attestation.productionDisabled,
      publicRouteExposed: attestation.publicRouteExposed,
      productionMutationObserved: attestation.productionMutationObserved,
    })) {
      explicitBoolean(value, `${attestation.journey} ${field}`);
    }
  }
}

function issue(
  code: HostedEndToEndAttestationIssue["code"],
  journey: HostedEndToEndJourney,
  severity: HostedEndToEndAttestationIssue["severity"],
): HostedEndToEndAttestationIssue {
  return { code, journey, severity };
}

export function projectHostedEndToEndAttestations(
  input: HostedEndToEndAttestationInput,
): HostedEndToEndAttestationProjection {
  assertRuntimeShape(input);
  const byJourney = new Map(
    input.attestations.map((attestation) => [attestation.journey, attestation]),
  );
  const issues: HostedEndToEndAttestationIssue[] = [];
  const passedJourneys: HostedEndToEndJourney[] = [];

  for (const journey of REQUIRED_JOURNEYS) {
    const attestation = byJourney.get(journey);
    if (attestation === undefined) {
      issues.push(issue("JOURNEY_MISSING", journey, "review"));
      continue;
    }

    const blocking: HostedEndToEndAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("JOURNEY_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_JOURNEY[journey]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.routeManifestSha256 !== input.routeManifestSha256) {
      blocking.push("ROUTE_MANIFEST_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.checkpointsPassed !== attestation.checkpointsTotal) {
      blocking.push("CHECKPOINTS_INCOMPLETE");
    }
    if (!attestation.browserExecutionComplete) {
      blocking.push("BROWSER_EXECUTION_INCOMPLETE");
    }
    if (!attestation.ownerBoundaryVerified) {
      blocking.push("OWNER_BOUNDARY_UNVERIFIED");
    }
    if (!attestation.syntheticFixturesOnly) {
      blocking.push("NON_SYNTHETIC_FIXTURE");
    }
    if (attestation.privateDataObserved) {
      blocking.push("PRIVATE_DATA_OBSERVED");
    }
    if (attestation.retainedPrivateArtifact) {
      blocking.push("PRIVATE_ARTIFACT_RETAINED");
    }
    if (
      PROVIDER_JOURNEYS.has(journey) &&
      !attestation.connectedProviderEvidence
    ) {
      blocking.push("PROVIDER_EVIDENCE_UNCONNECTED");
    }
    if (!attestation.productionDisabled) {
      blocking.push("PRODUCTION_NOT_DISABLED");
    }
    if (attestation.publicRouteExposed) {
      blocking.push("PUBLIC_ROUTE_EXPOSED");
    }
    if (attestation.productionMutationObserved) {
      blocking.push("PRODUCTION_MUTATION_OBSERVED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    if (blocking.length === 0) {
      passedJourneys.push(journey);
    } else {
      issues.push(...blocking.map((code) => issue(code, journey, "block")));
    }
  }

  const status = issues.some(({ severity }) => severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "review_required"
      : "attested";

  return {
    status,
    passedJourneys,
    check: {
      name: "end_to_end_workflows",
      state:
        status === "attested"
          ? "passed"
          : status === "blocked"
            ? "failed"
            : "not_run",
      headSha: status === "review_required" ? null : input.composedHeadSha,
    },
    issues,
    privateArtifactsRetained: false,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    providerMutationAllowed: false,
    productionMutationAllowed: false,
  };
}
