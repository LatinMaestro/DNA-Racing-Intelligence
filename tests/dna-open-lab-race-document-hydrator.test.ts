import { describe, expect, it } from "vitest";

import {
  hydrateDnaRaceDocuments,
  type DnaRaceDocumentHydrationResult,
} from "../lib/dna-open-lab-race-document-hydrator";
import {
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabRequestBudget } from "../lib/dna-open-lab-request-budget";

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
  ) => Promise<readonly DnaRaceDocument[]>,
): {
  client: Pick<DnaOpenLabClient, "raceDocs">;
  calls: DnaRaceIdentifier[][];
} {
  const calls: DnaRaceIdentifier[][] = [];
  return {
    client: {
      raceDocs: async (raceIds) => {
        calls.push([...raceIds]);
        return response(await handler(raceIds));
      },
    },
    calls,
  };
}

async function hydrate(input: {
  raceIds: readonly DnaRaceIdentifier[];
  handler: (
    raceIds: readonly DnaRaceIdentifier[],
  ) => Promise<readonly DnaRaceDocument[]>;
}): Promise<{
  result: DnaRaceDocumentHydrationResult;
  calls: DnaRaceIdentifier[][];
  requestCount: number;
}> {
  const source = clientWith(input.handler);
  const requestBudget = createDnaOpenLabRequestBudget();
  const result = await hydrateDnaRaceDocuments({
    raceIds: input.raceIds,
    client: source.client,
    requestBudget,
    observedAt: "2026-08-27T08:00:00Z",
  });
  return {
    result,
    calls: source.calls,
    requestCount: requestBudget.snapshot().requestsInCurrentWindow,
  };
}

describe("DNA Open Lab race document hydrator", () => {
  it("hydrates 45 races in bounded 20, 20, 5 batches and restores requested order", async () => {
    const raceIds = Array.from({ length: 45 }, (_, index) => index + 1);
    const { result, calls, requestCount } = await hydrate({
      raceIds,
      handler: async (batch) =>
        [...batch]
          .reverse()
          .map((rid) => ({ rid, future_optional_field: { retained: true } })),
    });

    expect(calls.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(requestCount).toBe(3);
    expect(result.batchCount).toBe(3);
    expect(result.requestedRaceCount).toBe(45);
    expect(result.documents.map((entry) => entry.canonical.sourceRaceId)).toEqual(
      raceIds.map(String),
    );
    expect(result.documents[0]).toMatchObject({
      source: "dna_open_lab",
      sourceVersion: "v1",
      scope: "races",
      endpoint: "races.docs",
      entityKey: "race:1",
      observedAt: "2026-08-27T08:00:00.000Z",
      rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("fails closed when DNA omits a requested race document", async () => {
    await expect(
      hydrate({
        raceIds: [1, 2],
        handler: async () => [{ rid: 1 }],
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "missing_document",
      message: expect.stringContaining("race 2"),
    });
  });

  it("fails closed when DNA returns a race that was not requested in the batch", async () => {
    await expect(
      hydrate({
        raceIds: [1, 2],
        handler: async () => [{ rid: 1 }, { rid: 3 }],
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "unexpected_document",
      message: expect.stringContaining("race 3"),
    });
  });

  it("rejects duplicate returned documents even when their payloads are identical", async () => {
    await expect(
      hydrate({
        raceIds: [1],
        handler: async () => [{ rid: 1 }, { rid: 1 }],
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "duplicate_document",
      message: expect.stringContaining("race 1"),
    });
  });

  it("distinguishes conflicting duplicate payloads", async () => {
    await expect(
      hydrate({
        raceIds: [1],
        handler: async () => [
          { rid: 1, version: "first" },
          { rid: 1, version: "second" },
        ],
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "conflicting_document",
      message: expect.stringContaining("race 1"),
    });
  });

  it("rejects duplicate requested race ids before making an API call", async () => {
    const source = clientWith(async () => []);
    const requestBudget = createDnaOpenLabRequestBudget();

    await expect(
      hydrateDnaRaceDocuments({
        raceIds: [1, "1"],
        client: source.client,
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "invalid_request",
      message: "requested race ids must be unique",
    });
    expect(source.calls).toHaveLength(0);
    expect(requestBudget.snapshot().requestsInCurrentWindow).toBe(0);
  });

  it("rejects empty or invalid race-id input before transport", async () => {
    const source = clientWith(async () => []);
    const requestBudget = createDnaOpenLabRequestBudget();

    await expect(
      hydrateDnaRaceDocuments({
        raceIds: [],
        client: source.client,
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });

    await expect(
      hydrateDnaRaceDocuments({
        raceIds: [0],
        client: source.client,
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });

    expect(source.calls).toHaveLength(0);
  });
});
