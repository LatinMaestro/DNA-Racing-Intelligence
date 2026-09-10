import { describe, expect, it } from "vitest";

import {
  DnaRaceDocumentHydrationProcessingError,
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
  it("classifies unexpected input processing before transport", async () => {
    const raceIds = new Proxy([1] as DnaRaceIdentifier[], {
      get(target, property, receiver) {
        if (property === "length") {
          throw new Error("private input-processing detail");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const source = clientWith(async () => []);

    await expect(
      hydrateDnaRaceDocuments({
        raceIds,
        client: source.client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationProcessingError",
      diagnostic: "race_document_hydration_input_processing_unavailable",
      message: "DNA race-document hydration processing is unavailable",
    });
    expect(source.calls).toHaveLength(0);
  });

  it("replaces unexpected response-processing detail with a stable diagnostic", async () => {
    const documents = new Proxy([] as DnaRaceDocument[], {
      get(target, property, receiver) {
        if (property === "length") {
          throw new Error("private response-processing detail");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const requestBudget = createDnaOpenLabRequestBudget();

    const error = await hydrateDnaRaceDocuments({
      raceIds: [1],
      client: { raceDocs: async () => response(documents) },
      requestBudget,
      observedAt: "2026-08-27T08:00:00Z",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DnaRaceDocumentHydrationProcessingError);
    expect(error).toMatchObject({
      name: "DnaRaceDocumentHydrationProcessingError",
      diagnostic: "race_document_hydration_response_processing_unavailable",
      message: "DNA race-document hydration processing is unavailable",
    });
    expect(String(error)).not.toContain("private response-processing detail");
  });

  it("distinguishes response identity processing without exposing detail", async () => {
    const document = new Proxy({ rid: 1 } as DnaRaceDocument, {
      get(target, property, receiver) {
        if (property === "rid") {
          throw new Error("private identity-processing detail");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const error = await hydrateDnaRaceDocuments({
      raceIds: [1],
      client: { raceDocs: async () => response([document]) },
      requestBudget: createDnaOpenLabRequestBudget(),
      observedAt: "2026-08-27T08:00:00Z",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "DnaRaceDocumentHydrationProcessingError",
      diagnostic:
        "race_document_hydration_response_identity_processing_unavailable",
    });
    expect(String(error)).not.toContain("private identity-processing detail");
  });

  it("distinguishes response evidence hashing from later adaptation", async () => {
    await expect(
      hydrateDnaRaceDocuments({
        raceIds: [1],
        client: {
          raceDocs: async () =>
            response([{ rid: 1, non_json_value: undefined }]),
        },
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationProcessingError",
      diagnostic:
        "race_document_hydration_response_hash_processing_unavailable",
    });
  });

  it("hydrates unsupported Race mode evidence without asserting a canonical mode", async () => {
    const hydrated = await hydrateDnaRaceDocuments({
      raceIds: [1],
      client: {
        raceDocs: async () =>
          response([{ rid: 1, rvmode: "unsupported" as never }]),
      },
      requestBudget: createDnaOpenLabRequestBudget(),
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(hydrated.documents[0]?.canonical).toMatchObject({
      sourceRaceId: "1",
      modeEvidenceStatus: "unsupported_source_value",
    });
    expect(hydrated.documents[0]?.canonical).not.toHaveProperty("mode");
  });

  it("classifies unexpected result materialization after complete coverage", async () => {
    const requestedKeys = new Proxy(["1"], {
      get(target, property, receiver) {
        if (property === "map") {
          throw new Error("private result-processing detail");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const raceIds = new Proxy([1] as DnaRaceIdentifier[], {
      get(target, property, receiver) {
        if (property === "map") return () => requestedKeys;
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      hydrateDnaRaceDocuments({
        raceIds,
        client: clientWith(async () => [{ rid: 1 }]).client,
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationProcessingError",
      diagnostic: "race_document_hydration_result_processing_unavailable",
      message: "DNA race-document hydration processing is unavailable",
    });
  });

  it("fails closed when DNA returns a non-array document result", async () => {
    const requestBudget = createDnaOpenLabRequestBudget();

    await expect(
      hydrateDnaRaceDocuments({
        raceIds: [1],
        client: {
          raceDocs: async () =>
            Object.freeze({
              result: { unexpected: true } as never,
              httpStatus: 200,
              rateLimit: Object.freeze({
                limit: 30,
                remaining: 29,
                resetSeconds: 40,
                rateClass: "api_key",
                retryAfterSeconds: null,
              }),
            }),
        },
        requestBudget,
        observedAt: "2026-08-27T08:00:00Z",
      }),
    ).rejects.toMatchObject({
      name: "DnaRaceDocumentHydrationError",
      kind: "invalid_response",
    });
  });

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
    expect(
      result.documents.map((entry) => entry.canonical.sourceRaceId),
    ).toEqual(raceIds.map(String));
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
