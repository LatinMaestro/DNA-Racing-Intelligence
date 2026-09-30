import { describe, expect, it } from "vitest";

import {
  DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS,
  DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS,
  DNA_RACE_DOCUMENT_SYSTEMIC_INDIVIDUAL_PROBE_ATTEMPTS,
  DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS,
  hydrateDnaRaceDocumentsWithQuarantine,
} from "@/lib/dna-open-lab-race-document-quarantine-hydrator";
import { DnaOpenLabApiError } from "@/lib/dna-open-lab-v1-client";
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

  it("quarantines duplicate provider entrant membership without stalling the cohort", async () => {
    const target = clientWith(() => [
      { rid: 1, rvmode: "bike", hids: [101, 101] },
      { rid: 2, rvmode: "bike", hids: [202] },
    ]);
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client: target.client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result).toMatchObject({
      requestedRaceCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
    });
    expect(result.outcomes[0]).toMatchObject({
      status: "quarantined",
      sourceRaceId: "1",
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.outcomes[1]).toMatchObject({
      status: "resolved",
      sourceRaceId: "2",
      evidence: {
        canonical: {
          entrantCoreIds: ["202"],
        },
      },
    });
  });

  it("retries a transient malformed provider envelope through the request budget", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (raceIds) => {
        calls += 1;
        if (calls < DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS) {
          throw new DnaOpenLabApiError({
            kind: "malformed_response",
            message: "private malformed provider detail",
            httpStatus: 200,
          });
        }
        return response(
          raceIds.map((rid) => ({
            rid,
            rvmode: "bike",
            hids: [Number(rid) + 100],
          })),
        );
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result).toMatchObject({
      requestedRaceCount: 2,
      resolvedRaceCount: 2,
      quarantinedRaceCount: 0,
    });
    expect(calls).toBe(DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS,
    );
  });

  it("fails closed after the bounded malformed-response retry ceiling", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async () => {
        calls += 1;
        throw new DnaOpenLabApiError({
          kind: "malformed_response",
          message: "private persistent provider detail",
          httpStatus: 200,
        });
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client,
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      kind: "malformed_response",
      message: "private persistent provider detail",
    });
    expect(calls).toBe(DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS,
    );
  });

  it("retries a transient provider transport interruption through the request budget", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (raceIds) => {
        calls += 1;
        if (calls < DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS) {
          throw new DnaOpenLabApiError({
            kind: "transport_error",
            message: "private transient transport detail",
          });
        }
        return response(
          raceIds.map((rid) => ({
            rid,
            rvmode: "bike",
            hids: [Number(rid) + 100],
          })),
        );
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result).toMatchObject({
      requestedRaceCount: 2,
      providerRequestCount: DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS,
      resolvedRaceCount: 2,
      quarantinedRaceCount: 0,
    });
    expect(calls).toBe(DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS,
    );
  });

  it("fails closed after the bounded transport-error retry ceiling", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async () => {
        calls += 1;
        throw new DnaOpenLabApiError({
          kind: "transport_error",
          message: "private persistent transport detail",
        });
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client,
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      kind: "transport_error",
      message: "private persistent transport detail",
    });
    expect(calls).toBe(DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS,
    );
  });

  it("quarantines one returned Race whose document cannot be adapted", async () => {
    const target = clientWith(() => [
      { rid: 1, rvmode: "bike", hids: [101] },
      { rid: 2, status: "" },
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

  it("caps concurrent 20-Race hydration batches at three workers", async () => {
    const raceIds = Array.from({ length: 81 }, (_, index) => index + 1);
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let inFlight = 0;
    let peakInFlight = 0;

    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (batch) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await barrier;
        inFlight -= 1;
        return response(
          batch.map((rid) => ({
            rid,
            rvmode: "bike",
            hids: [Number(rid) + 100],
          })),
        );
      },
    });

    const pending = hydrateDnaRaceDocumentsWithQuarantine({
      raceIds,
      client,
      requestBudget: createDnaOpenLabRequestBudget(),
      observedAt: "2026-08-27T08:00:00Z",
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(peakInFlight).toBe(3);
    releaseBarrier?.();

    const result = await pending;
    expect(result).toMatchObject({
      requestedRaceCount: 81,
      batchCount: 5,
      resolvedRaceCount: 81,
      quarantinedRaceCount: 0,
    });
    expect(result.outcomes.map((entry) => entry.sourceRaceId)).toEqual(
      raceIds.map(String),
    );
  });

  it("retries a transient systemic empty batch before accepting the same deterministic batch", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (raceIds) => {
        calls += 1;
        if (calls < DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS) {
          return response([]);
        }
        return response(
          raceIds.map((rid) => ({
            rid,
            rvmode: "bike",
            hids: [Number(rid) + 100],
          })),
        );
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(result).toMatchObject({
      requestedRaceCount: 2,
      resolvedRaceCount: 2,
      quarantinedRaceCount: 0,
    });
    expect(calls).toBe(DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS);
    expect(result.providerRequestCount).toBe(
      DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS,
    );
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS,
    );
  });

  it("isolates a persistently empty multi-Race batch before quarantining verified missing Races", async () => {
    const target = clientWith(() => []);
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client: target.client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    const expectedRequests =
      DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS +
      2 * DNA_RACE_DOCUMENT_SYSTEMIC_INDIVIDUAL_PROBE_ATTEMPTS;
    expect(result).toMatchObject({
      requestedRaceCount: 2,
      batchCount: 1,
      providerRequestCount: expectedRequests,
      resolvedRaceCount: 0,
      quarantinedRaceCount: 2,
    });
    expect(result.outcomes).toEqual([
      {
        status: "quarantined",
        sourceRaceId: "1",
        observedAt: "2026-08-27T08:00:00Z",
        quarantineReason: "provider_document_missing",
      },
      {
        status: "quarantined",
        sourceRaceId: "2",
        observedAt: "2026-08-27T08:00:00Z",
        quarantineReason: "provider_document_missing",
      },
    ]);
    expect(target.calls).toHaveLength(expectedRequests);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(
      expectedRequests,
    );
  });

  it("isolates a persistently unresolved batch and retains stable Race-specific quarantine evidence", async () => {
    const target = clientWith((raceIds) =>
      raceIds.map((rid) => ({ rid, rvmode: "bike" })),
    );
    const requestBudget = createDnaOpenLabRequestBudget();

    const result = await hydrateDnaRaceDocumentsWithQuarantine({
      raceIds: [1, 2],
      client: target.client,
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    });

    const expectedRequests =
      DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS +
      2 * DNA_RACE_DOCUMENT_SYSTEMIC_INDIVIDUAL_PROBE_ATTEMPTS;
    expect(result).toMatchObject({
      providerRequestCount: expectedRequests,
      resolvedRaceCount: 0,
      quarantinedRaceCount: 2,
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        status: "quarantined",
        sourceRaceId: "1",
        quarantineReason: "entrant_authority_unresolved",
        sourceEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      expect.objectContaining({
        status: "quarantined",
        sourceRaceId: "2",
        quarantineReason: "entrant_authority_unresolved",
        sourceEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
  });

  it("fails closed when isolated quarantine evidence changes between probes", async () => {
    let calls = 0;
    const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (raceIds) => {
        calls += 1;
        if (raceIds.length > 1) return response([]);
        if (calls === DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS + 1) {
          return response([]);
        }
        return response([{ rid: raceIds[0]!, rvmode: "bike" }]);
      },
    });

    await expect(
      hydrateDnaRaceDocumentsWithQuarantine({
        raceIds: [1, 2],
        client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: "race-doc isolated quarantine evidence is unstable",
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
