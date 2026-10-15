import { createHash } from "node:crypto";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import {
  normalizeMaidenAllocationEvidence,
  type MaidenAllocationEvidence,
} from "@/lib/maiden-workspace-service";

// A transport/storage limit, never permission to truncate Maiden evidence.
export const MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES = 512 * 1024;
const VERSION = 1;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

const bracketFields = {
  tournamentId: true,
  tournamentLabel: true,
  bracketId: true,
  bracketLabel: true,
  mode: true,
  configurationVersion: true,
  candidateSnapshotVersion: true,
  projectionVersion: true,
  reviewCapacity: true,
  availability: true,
  ruleStatus: true,
} satisfies Record<keyof MaidenAllocationBracketInput, true>;

const candidateFields = {
  candidateId: true,
  coreId: true,
  tournamentId: true,
  bracketId: true,
  mode: true,
  configurationVersion: true,
  candidateSnapshotVersion: true,
  projectionVersion: true,
  projectionBasis: true,
  projectedValueBasisPoints: true,
  suitability: true,
  lifecycleState: true,
  evidenceConfidence: true,
  timeEvidence: true,
  historicalStarSupport: true,
  crossModeEvidenceComplete: true,
  dataCurrentThrough: true,
  lastImported: true,
  freshness: true,
} satisfies Record<keyof MaidenAllocationCandidateInput, true>;

type Snapshot = Readonly<{
  version: typeof VERSION;
  databaseOwnerId: string;
  sourceEvidenceSha256: string;
  materializedAt: string;
  evidence: MaidenAllocationEvidence;
}>;

function fail(): never {
  // Never interpolate owner identities, source evidence or candidate values.
  throw new Error("Invalid Maiden allocation evidence snapshot.");
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail();
  const row = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(row);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key)) ||
    fields.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })
  )
    fail();
  return row;
}

function canonical(value: unknown): string {
  if (
    value === null ||
    ["string", "boolean", "number"].includes(typeof value)
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") fail();
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function digest(json: string): string {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") fail();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

function validNow(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();
}

function evidenceShape(value: unknown): MaidenAllocationEvidence {
  const row = exactObject(value, ["brackets", "candidates", "lastImportedAt"]);
  if (!Array.isArray(row.brackets) || !Array.isArray(row.candidates)) fail();
  for (const bracket of row.brackets)
    exactObject(bracket, Object.keys(bracketFields));
  for (const candidate of row.candidates)
    exactObject(candidate, Object.keys(candidateFields));
  if (row.lastImportedAt !== null && typeof row.lastImportedAt !== "string")
    fail();
  return row as MaidenAllocationEvidence;
}

function orderedEvidence(
  evidence: MaidenAllocationEvidence,
): MaidenAllocationEvidence {
  return {
    brackets: [...evidence.brackets].sort((left, right) =>
      left.bracketId.localeCompare(right.bracketId),
    ),
    candidates: [...evidence.candidates].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
    lastImportedAt: evidence.lastImportedAt,
  };
}

function validateSnapshot(value: unknown, now: Date): Snapshot {
  validNow(now);
  const row = exactObject(value, [
    "version",
    "databaseOwnerId",
    "sourceEvidenceSha256",
    "materializedAt",
    "evidence",
  ]);
  if (
    row.version !== VERSION ||
    typeof row.databaseOwnerId !== "string" ||
    !UUID.test(row.databaseOwnerId) ||
    typeof row.sourceEvidenceSha256 !== "string" ||
    !HASH.test(row.sourceEvidenceSha256)
  )
    fail();
  const materializedAt = timestamp(row.materializedAt);
  if (Date.parse(materializedAt) > now.getTime()) fail();
  const evidence = orderedEvidence(
    normalizeMaidenAllocationEvidence(
      evidenceShape(row.evidence),
      new Date(materializedAt),
    ),
  );
  return {
    version: VERSION,
    databaseOwnerId: row.databaseOwnerId,
    sourceEvidenceSha256: row.sourceEvidenceSha256,
    materializedAt,
    evidence,
  };
}

export function encodeMaidenAllocationEvidenceSnapshot(
  input: Readonly<{
    databaseOwnerId: string;
    sourceEvidenceSha256: string;
    materializedAt: string;
    evidence: MaidenAllocationEvidence;
    now: Date;
  }>,
): Readonly<{ json: string; sha256: string }> {
  try {
    const snapshot = validateSnapshot(
      {
        version: VERSION,
        databaseOwnerId: input.databaseOwnerId,
        sourceEvidenceSha256: input.sourceEvidenceSha256,
        materializedAt: input.materializedAt,
        evidence: input.evidence,
      },
      input.now,
    );
    const json = canonical(snapshot);
    if (Buffer.byteLength(json, "utf8") > MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES)
      fail();
    return { json, sha256: digest(json) };
  } catch {
    return fail();
  }
}

export function decodeMaidenAllocationEvidenceSnapshot(
  input: Readonly<{
    json: string;
    sha256: string;
    databaseOwnerId: string;
    sourceEvidenceSha256: string;
    now: Date;
  }>,
): MaidenAllocationEvidence {
  try {
    if (
      typeof input.json !== "string" ||
      Buffer.byteLength(input.json, "utf8") >
        MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES ||
      !HASH.test(input.sha256) ||
      digest(input.json) !== input.sha256
    )
      fail();
    const snapshot = validateSnapshot(JSON.parse(input.json), input.now);
    if (
      snapshot.databaseOwnerId !== input.databaseOwnerId ||
      snapshot.sourceEvidenceSha256 !== input.sourceEvidenceSha256 ||
      canonical(snapshot) !== input.json
    )
      fail();
    return orderedEvidence(
      normalizeMaidenAllocationEvidence(snapshot.evidence, input.now),
    );
  } catch {
    return fail();
  }
}
