import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import {
  decodeMaidenAllocationEvidenceSnapshot,
  encodeMaidenAllocationEvidenceSnapshot,
  MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES,
} from "@/lib/maiden-allocation-evidence-snapshot";
import {
  loadMaidenWorkspacePageState,
  type MaidenAllocationEvidence,
} from "@/lib/maiden-workspace-service";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const sourceEvidenceSha256 = "a".repeat(64);
const now = new Date("2026-10-15T00:00:00.000Z");
const materializedAt = now.toISOString();
const versions = {
  configurationVersion: "config-v3",
  candidateSnapshotVersion: "snapshot-v9",
  projectionVersion: "projection-v4",
} as const;
const bracket: MaidenAllocationBracketInput = {
  tournamentId: "synthetic-maiden",
  tournamentLabel: "Synthetic Maiden",
  bracketId: "synthetic-bracket",
  bracketLabel: "Synthetic Bracket",
  mode: "horse",
  ...versions,
  reviewCapacity: 1,
  availability: "upcoming",
  ruleStatus: "confirmed",
};
const candidate: MaidenAllocationCandidateInput = {
  candidateId: "synthetic-candidate",
  coreId: "synthetic-core",
  tournamentId: bracket.tournamentId,
  bracketId: bracket.bracketId,
  mode: bracket.mode,
  ...versions,
  projectionBasis: "time_led_chronological",
  projectedValueBasisPoints: 8_500,
  suitability: "review_candidate",
  lifecycleState: "eligible",
  evidenceConfidence: "moderate",
  timeEvidence: "competitive",
  historicalStarSupport: "supports",
  crossModeEvidenceComplete: true,
  dataCurrentThrough: "2026-10-14T00:00:00.000Z",
  lastImported: "2020-01-01T00:00:00.000Z",
  freshness: "stale",
};
const evidence: MaidenAllocationEvidence = {
  brackets: [bracket],
  candidates: [candidate],
  lastImportedAt: "2026-10-14T01:00:00.000Z",
};

const encode = (value = evidence) =>
  encodeMaidenAllocationEvidenceSnapshot({
    databaseOwnerId,
    sourceEvidenceSha256,
    materializedAt,
    evidence: value,
    now,
  });
const decode = (
  snapshot = encode(),
  overrides: Partial<
    Parameters<typeof decodeMaidenAllocationEvidenceSnapshot>[0]
  > = {},
) =>
  decodeMaidenAllocationEvidenceSnapshot({
    ...snapshot,
    databaseOwnerId,
    sourceEvidenceSha256,
    now,
    ...overrides,
  });
const rehash = (json: string) => ({
  json,
  sha256: createHash("sha256").update(json).digest("hex"),
});

describe("compact Maiden allocation evidence snapshots", () => {
  it("round-trips approved evidence while deriving accepted import freshness", () => {
    const snapshot = encode();
    expect(decode(snapshot)).toEqual({
      brackets: [bracket],
      candidates: [
        {
          ...candidate,
          lastImported: evidence.lastImportedAt,
          freshness: "current",
        },
      ],
      lastImportedAt: evidence.lastImportedAt,
    });
    expect(Buffer.byteLength(snapshot.json)).toBeLessThan(
      MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES,
    );
  });

  it("feeds the unchanged approved allocator without authorising commitment", async () => {
    const stored = decode();
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "synthetic-owner",
        configuredOwnerId: "synthetic-owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () => ({
            evidence: stored,
            sourceEvidenceSha256,
            snapshotSha256: encode().sha256,
            materializedAt,
          }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      allocation: {
        assignments: [{ candidateId: candidate.candidateId }],
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
      },
    });
  });

  it("binds owner and source independently of the body checksum", () => {
    const snapshot = encode();
    expect(() =>
      decode(snapshot, {
        databaseOwnerId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow("Invalid Maiden allocation evidence snapshot.");
    expect(() =>
      decode(snapshot, { sourceEvidenceSha256: "b".repeat(64) }),
    ).toThrow("Invalid Maiden allocation evidence snapshot.");
    expect(() =>
      decode({
        ...snapshot,
        json: snapshot.json.replace("8500", "8501"),
      }),
    ).toThrow();
  });

  it("uses deterministic object and evidence order", () => {
    const second = {
      ...candidate,
      candidateId: "candidate-a",
      coreId: "core-a",
    };
    const reversedBracket = Object.fromEntries(
      Object.entries(bracket).reverse(),
    ) as MaidenAllocationBracketInput;
    const reversedCandidate = Object.fromEntries(
      Object.entries(candidate).reverse(),
    ) as MaidenAllocationCandidateInput;
    expect(
      encode({
        brackets: [reversedBracket],
        candidates: [reversedCandidate, second],
        lastImportedAt: evidence.lastImportedAt,
      }),
    ).toEqual(
      encode({
        brackets: [bracket],
        candidates: [second, candidate],
        lastImportedAt: evidence.lastImportedAt,
      }),
    );
    const snapshot = encode();
    expect(() =>
      decode(rehash(JSON.stringify(JSON.parse(snapshot.json), null, 2))),
    ).toThrow();
  });

  it("re-derives freshness at read time without changing projected value", () => {
    const result = decode(encode(), {
      now: new Date("2026-10-23T00:00:00.000Z"),
    });
    expect(result.candidates[0]).toMatchObject({
      projectedValueBasisPoints: 8_500,
      freshness: "stale",
      lastImported: evidence.lastImportedAt,
    });
  });

  it("supports an explicit empty accepted read model", () => {
    const empty = {
      brackets: [],
      candidates: [],
      lastImportedAt: null,
    } satisfies MaidenAllocationEvidence;
    expect(decode(encode(empty))).toEqual(empty);
  });

  it("rejects unknown fields, malformed types and invalid approved evidence", () => {
    const cases = [
      { ...evidence, privateOwnerNote: "synthetic-private-evidence" },
      { ...evidence, brackets: [{ ...bracket, extra: true }] },
      { ...evidence, candidates: [{ ...candidate, rawPayload: "private" }] },
      { ...evidence, lastImportedAt: 1 },
      { ...evidence, candidates: [{ ...candidate, mode: "bike" }] },
      {
        ...evidence,
        candidates: [{ ...candidate, projectedValueBasisPoints: 10_001 }],
      },
      { ...evidence, brackets: [], candidates: [candidate] },
    ];
    for (const value of cases)
      expect(() => encode(value as MaidenAllocationEvidence)).toThrow(
        "Invalid Maiden allocation evidence snapshot.",
      );
  });

  it("rejects invalid chronology, identity and unsupported schemas", () => {
    const snapshot = encode();
    const body = JSON.parse(snapshot.json);
    for (const changes of [
      { version: 2 },
      { materializedAt: "2026-10-16T00:00:00.000Z" },
      { materializedAt: "2026-10-15" },
      { databaseOwnerId: "not-an-owner" },
      { sourceEvidenceSha256: "unknown" },
      {
        evidence: {
          ...evidence,
          lastImportedAt: "2026-10-16T00:00:00.000Z",
        },
      },
    ])
      expect(() =>
        decode(rehash(JSON.stringify({ ...body, ...changes }))),
      ).toThrow();
    expect(() => decode(snapshot, { now: new Date("invalid") })).toThrow();
  });

  it("rejects oversized stored bodies before parsing and never truncates", () => {
    expect(() =>
      decode(rehash(" ".repeat(MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES + 1))),
    ).toThrow();
    expect(() =>
      encode({
        ...evidence,
        candidates: [
          {
            ...candidate,
            coreId: "x".repeat(MAIDEN_ALLOCATION_SNAPSHOT_MAX_BYTES),
          },
        ],
      }),
    ).toThrow();
  });
});
