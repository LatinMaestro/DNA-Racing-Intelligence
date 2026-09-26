import { describe, expect, it } from "vitest";

import { hydrateDnaRaceDocumentsWithQuarantine } from "@/lib/dna-open-lab-race-document-quarantine-hydrator";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";

function response(
  documents: readonly DnaRaceDocument[],
): DnaOpenLabResponse<readonly DnaRaceDocument[]> {
  return Object.freeze({
    result: documents,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 40,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function clientWith(
  handler: (
    raceIds: readonly DnaRaceIdentifier[],
  ) => readonly DnaRaceDocument[],
) {
  const calls: DnaRaceIdentifier[][] = [];
  const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
    raceDocs: async (raceIds) => {
      calls.push([...raceIds]);
      return response(handler(raceIds));
    },
  });
  return { client, calls };
}

describe("DNA race document quarantine hydrator", () => {
  it("continues past isolated unresolved and missing Races in requested order", async () => {
    const target = clientWith(() => [
      { rid: 1, rvmode: "bike", hids: [101] },
      { rid: 2, rvmode: "bike" },
    ]);
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2, 3],
      client: target.client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result).toMatchObject({
      requestedRaceCount: 3,
      batchCount: 1,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 2,
    });
    expect(result.outcomes.map((entry) => entry.sourceRaceId)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(result.outcomes[0]).toMatchObject({
      status: "resolved",
      sourceRaceId: "1",
      evidence: {
        canonical: {
          sourceRaceId: "1",
          mode: "bike",
          entrantCoreIds: ["101"],
        },
      },
    });
    expect(result.outcomes[1]).toMatchObject({
      status: "quarantined",
      sourceRaceId: "2",
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.outcomes[2]).toEqual({
      status: "quarantined",
      sourceRaceId: "3",
      observedAt: "2026-08-27T08:00:00Z",
      quarantineReason: "provider_document_missing",
    });
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(1);
  });

  it("quarantines one returned Race whose document cannot be adapted", async () => {
    const target = clientWith(() => [
      { rid: 1, rvmode: "bike", hids: [101] },
      { rid: 2, non_json_value: undefined },
    ]);

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client: target.client,
      requestBudget: createDnaOpenLabRequestBudget(),
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result.resolvedRaceCount).toBe(1);
    expect(result.quarantinedRaceCount).toBe(1);
    expect(result.outcomes[1]).toMatchObject({
      status: "quarantined",
      sourceRaceId: "2",
      quarantineReason: "provider_document_unusable",
      sourceEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("keeps 20-ID request batching while allowing isolated omissions", async () => {
    const raceIds = Array.from({ length: 21 }, (_, index) => index + 1);
    const target = clientWith((batch) =>
      batch
        .filter((raceId) => Number(raceId) !== 20)
        .map((rid) => ({ rid, rvmode: "bike", hids: [Number(rid) + 100] })),
    );
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds,
      client: target.client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(target.calls.map((batch) => batch.length)).toEqual([20, 1]);
    expect(result.batchCount).toBe(2);
    expect(result.resolvedRaceCount).toBe(20);
    expect(result.quarantinedRaceCount).toBe(1);
    expect(result.outcomes[19]).toMatchObject({
      status: "quarantined",
      sourceRaceId: "20",
      quarantineReason: "provider_document_missing",
    });
  });

  it("fails closed instead of mass-quarantining an empty multi-Race batch", async () => {
    const target = clientWith(() => []);

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client: target.client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "invalid_response",
      message: "race-doc batch coverage is systemically unavailable",
    });
  });

  it("fails closed when every Race in a multi-Race batch remains unresolved", async () => {
    const target = clientWith((raceIds) =>
      raceIds.map((rid) => ({ rid, rvmode: "bike" })),
    );

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client: target.client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: "race-doc batch entrant authority is systemically unavailable",
    });
  });

  it("fails closed on unexpected or duplicate returned identities", async () => {
    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client: clientWith(() => [
          { rid: 1, rvmode: "bike", hids: [101] },
          { rid: 3, rvmode: "bike", hids: [103] },
        ]).client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({ kind: "unexpected_document" });

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1],
        client: clientWith(() => [
          { rid: 1, rvmode: "bike", hids: [101] },
          { rid: 1, rvmode: "bike", hids: [101] },
        ]).client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({ kind: "duplicate_document" });
  });
});
