import type { CorePerformanceProfile } from "@/domain/core-performance";
import {
  buildOpenRaceAdvisoryFields,
  type OpenRaceAdvisoryFieldEvidence,
} from "@/domain/open-race-advisory-field-builder";
import {
  evaluateOwnerVaultOpenRaceEnvelope,
  type OwnerVaultOpenRaceAdvisoryBatch,
} from "@/domain/open-race-accepted-evaluation";
import {
  readOpenRaceApiEnvelope,
  type OpenRaceApiEnvelopeReadOutcome,
} from "@/lib/open-race-api-envelope-reader";

type ApiReadInput = Parameters<typeof readOpenRaceApiEnvelope>[0];
type ApiReadUnavailableReason = Extract<
  OpenRaceApiEnvelopeReadOutcome,
  { status: "unavailable" }
>["reason"];

export type OpenRaceApiAdvisoryOutcome =
  | Readonly<{
      status: "ready";
      sourceStatus: "live_api" | "offline_replay";
      requestCount: number;
      activeRaceCount: number;
      detailRaceCount: number;
      prefilteredRaceCount: number;
      advisory: OwnerVaultOpenRaceAdvisoryBatch;
      advisoryOnly: true;
      queueAllowed: false;
      gameEntryAllowed: false;
    }>
  | Readonly<{
      status: "unavailable";
      sourceStatus: "live_api" | "offline_replay";
      reason: ApiReadUnavailableReason | "evaluation_unavailable";
      requestCount: number;
      activeRaceCount: number;
      advisory: null;
      advisoryOnly: true;
      queueAllowed: false;
      gameEntryAllowed: false;
    }>;

/**
 * Runs one bounded, read-only Open Lab observation through the existing
 * ordinary Open Race advisory flow. This is orchestration only: the shared
 * scanner owns the half-filled rule, existing eligibility owns hard filters,
 * and accepted profiles own ranking evidence. No queue or execution lane is
 * created here.
 */
export async function evaluateOpenRaceApiAdvisories(
  input: Readonly<{
    read: ApiReadInput;
    profiles: readonly CorePerformanceProfile[];
    fieldEvidence: OpenRaceAdvisoryFieldEvidence;
  }>,
): Promise<OpenRaceApiAdvisoryOutcome> {
  const read = await readOpenRaceApiEnvelope(input.read);
  if (read.status === "unavailable") {
    return {
      status: "unavailable",
      sourceStatus: read.sourceStatus,
      reason: read.reason,
      requestCount: read.requestCount,
      activeRaceCount: 0,
      advisory: null,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  }

  try {
    const fields = buildOpenRaceAdvisoryFields({
      scan: read.envelope,
      profiles: input.profiles,
      evidence: input.fieldEvidence,
    });
    if (fields.status === "unavailable") {
      throw new Error(fields.reason);
    }
    const advisory = evaluateOwnerVaultOpenRaceEnvelope({
      scan: read.envelope,
      profiles: input.profiles,
      fields: fields.fields,
    });
    return {
      status: "ready",
      sourceStatus: read.sourceStatus,
      requestCount: read.requestCount,
      activeRaceCount: read.activeRaceCount,
      detailRaceCount: read.detailRaceCount,
      prefilteredRaceCount: read.prefilteredRaceCount,
      advisory,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  } catch {
    return {
      status: "unavailable",
      sourceStatus: read.sourceStatus,
      reason: "evaluation_unavailable",
      requestCount: read.requestCount,
      activeRaceCount: read.activeRaceCount,
      advisory: null,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  }
}
