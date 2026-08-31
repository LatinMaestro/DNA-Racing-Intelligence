import {
  DNA_OPEN_LAB_V1_BASE_URL,
  DnaOpenLabApiError,
  readDnaOpenLabRateLimit,
  type DnaOpenLabResponse,
  type DnaOpenLabTransport,
} from "./dna-open-lab-v1-client";

/**
 * DNA added the telemetry endpoints after the original v1 LLM reference.
 * Their payload schema and analytical meaning are intentionally left unknown
 * until connected read-only P3 inspection proves the real contract.
 */
export type DnaTelemetryPayload = unknown;

export type DnaOpenLabTelemetryClient = Readonly<{
  coreTelemetry: (
    hid: number,
  ) => Promise<DnaOpenLabResponse<DnaTelemetryPayload>>;
  coreTelemetryBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<DnaTelemetryPayload>>;
  coreTelemetryBenchmark: (
    hid: number,
    cb: number,
  ) => Promise<DnaOpenLabResponse<DnaTelemetryPayload>>;
}>;

const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/;

function invalidConfiguration(message: string): never {
  throw new DnaOpenLabApiError({ kind: "invalid_configuration", message });
}

function invalidRequest(message: string): never {
  throw new DnaOpenLabApiError({ kind: "invalid_request", message });
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalidRequest(`${field} must be a positive safe integer`);
  }
  return value;
}

function coreIds(hids: readonly number[]): readonly number[] {
  if (hids.length < 1 || hids.length > 20) {
    invalidRequest("hids must contain between 1 and 20 values");
  }
  return hids.map((hid) => positiveInteger(hid, "hid"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readEnvelope(
  response: Response,
): Promise<DnaOpenLabResponse<DnaTelemetryPayload>> {
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
    const message =
      typeof payload.err === "string" && payload.err.trim() !== ""
        ? payload.err
        : "DNA Open Lab returned an unspecified API error";
    throw new DnaOpenLabApiError({
      kind: response.status === 429 ? "rate_limited" : "api_error",
      message,
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
    result: payload.result,
    httpStatus: response.status,
    rateLimit,
  });
}

export function createDnaOpenLabV1TelemetryClient(input: {
  apiKey: string;
  transport?: DnaOpenLabTransport;
  baseUrl?: string;
}): DnaOpenLabTelemetryClient {
  if (!API_KEY_PATTERN.test(input.apiKey)) {
    invalidConfiguration("DNA Open Lab API key format is invalid");
  }

  const transport = input.transport ?? fetch;
  const baseUrl = (input.baseUrl ?? DNA_OPEN_LAB_V1_BASE_URL).replace(
    /\/+$/u,
    "",
  );
  if (!/^https:\/\//u.test(baseUrl)) {
    invalidConfiguration("DNA Open Lab base URL must use HTTPS");
  }

  const request = async (requestInput: {
    path: string;
    method: "GET" | "POST";
    body?: unknown;
  }): Promise<DnaOpenLabResponse<DnaTelemetryPayload>> => {
    const headers = new Headers({
      Authorization: `Bearer ${input.apiKey}`,
      Accept: "application/json",
    });
    let body: string | undefined;
    if (requestInput.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(requestInput.body);
    }

    const response = await transport(`${baseUrl}${requestInput.path}`, {
      method: requestInput.method,
      headers,
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
    });
    return readEnvelope(response);
  };

  return Object.freeze({
    coreTelemetry: (hid) =>
      request({
        path: `/cores/${positiveInteger(hid, "hid")}/telemetry`,
        method: "GET",
      }),
    coreTelemetryBulk: (hids) =>
      request({
        path: "/cores/telemetry_bulk",
        method: "POST",
        body: { hids: coreIds(hids) },
      }),
    coreTelemetryBenchmark: (hid, cb) =>
      request({
        path: `/cores/${positiveInteger(hid, "hid")}/telemetry_benchmark?cb=${positiveInteger(cb, "cb")}`,
        method: "GET",
      }),
  });
}
