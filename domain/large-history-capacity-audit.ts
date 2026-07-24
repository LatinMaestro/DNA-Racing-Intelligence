export type CapacityEvidenceSource =
  "synthetic" | "sanitized_representative" | "private_hosted";

export type LargeHistoryCapacityInput = {
  measurementId: string;
  evidenceSource: CapacityEvidenceSource;
  exactHeadSha: string;
  datasetRows: number;
  repetitions: number;
  routineRequest: {
    usesPrecomputedAggregates: boolean;
    rawHistoryRowsScanned: number;
    p95Milliseconds: number | null;
    latencyBudgetMilliseconds: number;
  };
  backgroundPipeline: {
    importRunsOffRequestPath: boolean;
    aggregateRefreshRunsOffRequestPath: boolean;
    maxBatchRows: number;
    completed: boolean;
    peakMemoryMegabytes: number | null;
    memoryBudgetMegabytes: number;
  };
  privateDataObservedInLogs: boolean;
  productionMutationRequested: boolean;
  providerChangeRequested: boolean;
};

export type CapacityAuditCheck = {
  code:
    | "REPRESENTATIVE_SCALE"
    | "ROUTINE_REQUEST_BOUNDARY"
    | "ROUTINE_LATENCY"
    | "BACKGROUND_EXECUTION"
    | "MEMORY_BUDGET"
    | "REPEATABLE_EXACT_HEAD_EVIDENCE"
    | "CONFIDENTIAL_NON_PRODUCTION_SCOPE";
  status: "pass" | "review" | "block";
  detail: string;
};

export type LargeHistoryCapacityAudit = {
  status: "verified_representative" | "review_required" | "blocked";
  evidenceClass: "contract_only" | "representative_measurement";
  checks: readonly CapacityAuditCheck[];
  productionReady: false;
  gateFStatus: "not_assessed";
};

const REPRESENTATIVE_RACE_ROWS = 2_000_000;

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite.`);
  }
}

function optionalPositiveFinite(value: number | null, label: string): void {
  if (value !== null) positiveFinite(value, label);
}

function check(
  code: CapacityAuditCheck["code"],
  status: CapacityAuditCheck["status"],
  detail: string,
): CapacityAuditCheck {
  return { code, status, detail };
}

export function auditLargeHistoryCapacity(
  input: LargeHistoryCapacityInput,
): LargeHistoryCapacityAudit {
  if (input.measurementId.trim() === "") {
    throw new Error("Measurement ID is required.");
  }
  if (
    !["synthetic", "sanitized_representative", "private_hosted"].includes(
      input.evidenceSource,
    )
  ) {
    throw new Error("Capacity evidence source is invalid.");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.exactHeadSha)) {
    throw new Error("Exact-head SHA must contain 40 hexadecimal characters.");
  }
  nonNegativeSafeInteger(input.datasetRows, "Dataset rows");
  nonNegativeSafeInteger(input.repetitions, "Repetitions");
  nonNegativeSafeInteger(
    input.routineRequest.rawHistoryRowsScanned,
    "Raw history rows scanned",
  );
  positiveFinite(
    input.routineRequest.latencyBudgetMilliseconds,
    "Latency budget",
  );
  optionalPositiveFinite(
    input.routineRequest.p95Milliseconds,
    "Measured p95 latency",
  );
  nonNegativeSafeInteger(
    input.backgroundPipeline.maxBatchRows,
    "Maximum batch rows",
  );
  positiveFinite(
    input.backgroundPipeline.memoryBudgetMegabytes,
    "Memory budget",
  );
  optionalPositiveFinite(
    input.backgroundPipeline.peakMemoryMegabytes,
    "Peak memory",
  );

  const checks: CapacityAuditCheck[] = [];
  const representativeSource = input.evidenceSource !== "synthetic";
  checks.push(
    check(
      "REPRESENTATIVE_SCALE",
      representativeSource && input.datasetRows >= REPRESENTATIVE_RACE_ROWS
        ? "pass"
        : "review",
      "Capacity evidence must use representative sanitized or private hosted data at the expected multi-million-row scale.",
    ),
  );

  checks.push(
    check(
      "ROUTINE_REQUEST_BOUNDARY",
      input.routineRequest.usesPrecomputedAggregates &&
        input.routineRequest.rawHistoryRowsScanned === 0
        ? "pass"
        : "block",
      "Routine requests must use compact aggregates and scan no raw race history.",
    ),
  );

  checks.push(
    check(
      "ROUTINE_LATENCY",
      input.routineRequest.p95Milliseconds === null
        ? "review"
        : input.routineRequest.p95Milliseconds <=
            input.routineRequest.latencyBudgetMilliseconds
          ? "pass"
          : "block",
      "Measured routine-request p95 latency must remain within the declared budget.",
    ),
  );

  const offRequestPath =
    input.backgroundPipeline.importRunsOffRequestPath &&
    input.backgroundPipeline.aggregateRefreshRunsOffRequestPath;
  checks.push(
    check(
      "BACKGROUND_EXECUTION",
      !offRequestPath || input.backgroundPipeline.maxBatchRows === 0
        ? "block"
        : input.backgroundPipeline.completed
          ? "pass"
          : "review",
      "Import and aggregate refresh must run off the request path in bounded batches.",
    ),
  );

  checks.push(
    check(
      "MEMORY_BUDGET",
      input.backgroundPipeline.peakMemoryMegabytes === null
        ? "review"
        : input.backgroundPipeline.peakMemoryMegabytes <=
            input.backgroundPipeline.memoryBudgetMegabytes
          ? "pass"
          : "block",
      "Measured peak background memory must remain within the declared budget.",
    ),
  );

  checks.push(
    check(
      "REPEATABLE_EXACT_HEAD_EVIDENCE",
      input.repetitions >= 3 ? "pass" : "review",
      "Measurements must be repeated at least three times against one exact repository head.",
    ),
  );

  checks.push(
    check(
      "CONFIDENTIAL_NON_PRODUCTION_SCOPE",
      input.privateDataObservedInLogs ||
        input.productionMutationRequested ||
        input.providerChangeRequested
        ? "block"
        : "pass",
      "Capacity validation must not expose private data or change providers or Production.",
    ),
  );

  const status = checks.some((item) => item.status === "block")
    ? "blocked"
    : checks.some((item) => item.status === "review")
      ? "review_required"
      : "verified_representative";

  return {
    status,
    evidenceClass:
      representativeSource && input.datasetRows >= REPRESENTATIVE_RACE_ROWS
        ? "representative_measurement"
        : "contract_only",
    checks,
    productionReady: false,
    gateFStatus: "not_assessed",
  };
}
