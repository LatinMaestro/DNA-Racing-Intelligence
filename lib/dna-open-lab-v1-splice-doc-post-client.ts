import {
  DNA_OPEN_LAB_V1_BASE_URL,
  DnaOpenLabApiError,
  readDnaOpenLabRateLimit,
  type DnaOpenLabResponse,
  type DnaOpenLabTransport,
  type DnaSpliceDocument,
} from "./dna-open-lab-v1-client";

const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/;

function invalidConfiguration(message: string): never {
  throw new DnaOpenLabApiError({ kind: "invalid_configuration", message });
}

function requiredRequestId(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    throw new DnaOpenLabApiError({
      kind: "invalid_request",
      message: "requestId is invalid",
    });
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readEnvelope(
  response: Response,
): Promise<DnaOpenLabResponse<DnaSpliceDocument>> {
  const rateLimit = readDnaOpenLabRateLimit(response.headers);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab returned non-JSON content",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (!isRecord(payload) || typeof payload.status !== "string") {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab response envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }
  if (payload.status === "error") {
    throw new DnaOpenLabApiError({
      kind: response.status === 429 ? "rate_limited" : "api_error",
      message:
        typeof payload.err === "string" && payload.err.trim() !== ""
          ? payload.err
          : "DNA Open Lab returned an unspecified API error",
      httpStatus: response.status,
      rateLimit,
    });
  }
  if (payload.status !== "success" || !("result" in payload)) {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab success envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }
  return Object.freeze({
    result: payload.result as DnaSpliceDocument,
    httpStatus: response.status,
    rateLimit,
  });
}

export type DnaOpenLabSpliceDocumentPostClient = Readonly<{
  spliceDocumentPost: (
    requestId: string,
  ) => Promise<DnaOpenLabResponse<DnaSpliceDocument>>;
}>;

/** Covers the documented `POST /splice/doc` form that mirrors the GET form. */
export function createDnaOpenLabV1SpliceDocumentPostClient(input: {
  apiKey: string;
  transport?: DnaOpenLabTransport;
  baseUrl?: string;
}): DnaOpenLabSpliceDocumentPostClient {
  if (!API_KEY_PATTERN.test(input.apiKey)) {
    invalidConfiguration("DNA Open Lab API key format is invalid");
  }
  const baseUrl = (input.baseUrl ?? DNA_OPEN_LAB_V1_BASE_URL).replace(
    /\/+$/u,
    "",
  );
  if (!/^https:\/\//u.test(baseUrl)) {
    invalidConfiguration("DNA Open Lab base URL must use HTTPS");
  }
  const transport = input.transport ?? fetch;

  return Object.freeze({
    spliceDocumentPost: async (requestId) => {
      const response = await transport(`${baseUrl}/splice/doc`, {
        method: "POST",
        headers: new Headers({
          Authorization: `Bearer ${input.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ reqid: requiredRequestId(requestId) }),
        cache: "no-store",
      });
      return readEnvelope(response);
    },
  });
}
