export type HistoricalSnapshotSurface =
  | "core_profile"
  | "discovery"
  | "tournament"
  | "maiden"
  | "breeding"
  | "lifecycle"
  | "open_race";

export type HistoricalSnapshotPresentationInput = Readonly<{
  auditId: string;
  surface: HistoricalSnapshotSurface;
  visibleText: readonly string[];
}>;

export type HistoricalSnapshotPresentationIssue =
  | "missing_historical_snapshot_label"
  | "missing_data_current_through_label"
  | "missing_last_imported_label"
  | "missing_freshness_label"
  | "live_state_claim"
  | "missing_open_race_source_distinction";

export type HistoricalSnapshotPresentationResult = Readonly<{
  auditId: string;
  surface: HistoricalSnapshotSurface;
  compliant: boolean;
  issues: readonly HistoricalSnapshotPresentationIssue[];
  liveStateClaimDetected: boolean;
  requiredDisclosureCount: number;
  historicalSnapshotRequired: true;
  authoritativeLiveIntegrationPresent: false;
  productionApprovalGranted: false;
}>;

const FRESHNESS_LABEL =
  /\b(current import|ageing|stale|freshness unknown|not imported)\b/i;
const LIVE_CLAIMS = [
  /\blive (data|race|field|opponents?|arena|listings?|vault|recommendations?)\b/i,
  /\breal[- ]time\b/i,
  /\bup[- ]to[- ]date\b/i,
  /\bcurrently entered opponents?\b/i,
  /\bactive right now\b/i,
  /\bno later (races?|events?) (exist|occurred|have occurred)\b/i,
];
const NEGATED_LIVE_DISCLOSURE =
  /\b(not|is not|isn't|never|cannot|can't|does not|doesn't)\b[^.]{0,80}\b(live|real[- ]time|up[- ]to[- ]date)\b/i;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function hasLiveClaim(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+/)
    .some(
      (sentence) =>
        LIVE_CLAIMS.some((pattern) => pattern.test(sentence)) &&
        !NEGATED_LIVE_DISCLOSURE.test(sentence),
    );
}

export function auditHistoricalSnapshotPresentation(
  input: HistoricalSnapshotPresentationInput,
): HistoricalSnapshotPresentationResult {
  const auditId = required(input.auditId, "Audit ID");
  if (
    ![
      "core_profile",
      "discovery",
      "tournament",
      "maiden",
      "breeding",
      "lifecycle",
      "open_race",
    ].includes(input.surface)
  ) {
    throw new Error("Historical snapshot surface is invalid.");
  }
  if (input.visibleText.length === 0) {
    throw new Error("Presentation audit requires visible text.");
  }
  const visibleText = input.visibleText.map((text) =>
    required(text, "Visible text"),
  );
  const combined = visibleText.join("\n");
  const issues: HistoricalSnapshotPresentationIssue[] = [];
  if (!/\bhistorical snapshot\b/i.test(combined)) {
    issues.push("missing_historical_snapshot_label");
  }
  if (!/\bdata current through\b/i.test(combined)) {
    issues.push("missing_data_current_through_label");
  }
  if (!/\blast imported\b/i.test(combined)) {
    issues.push("missing_last_imported_label");
  }
  if (!FRESHNESS_LABEL.test(combined)) {
    issues.push("missing_freshness_label");
  }
  const liveStateClaimDetected = hasLiveClaim(combined);
  if (liveStateClaimDetected) {
    issues.push("live_state_claim");
  }
  if (
    input.surface === "open_race" &&
    (!/\bmanually entered (current )?field\b/i.test(combined) ||
      !/\bimported historical (data|evidence)\b/i.test(combined))
  ) {
    issues.push("missing_open_race_source_distinction");
  }

  return {
    auditId,
    surface: input.surface,
    compliant: issues.length === 0,
    issues,
    liveStateClaimDetected,
    requiredDisclosureCount: input.surface === "open_race" ? 5 : 4,
    historicalSnapshotRequired: true,
    authoritativeLiveIntegrationPresent: false,
    productionApprovalGranted: false,
  };
}
