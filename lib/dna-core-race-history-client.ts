import { DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE } from "@/lib/dna-core-race-history-acquisition-cycle";
import {
  DnaOpenLabApiError,
  readDnaOpenLabRateLimit,
  type DnaOpenLabResponse,
  type DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";

export const DNA_CORE_RACE_HISTORY_URL =
  "https://api.dnaracing.run/fbike/i/hraces" as const;

export type DnaCoreRaceHistoryRow = Readonly<
  {
    hid?: unknown;
    rid?: unknown;
    rvmode?: unknown;
    cb?: unknown;
    time?: unknown;
    pos?: unknown;
    rgate?: unknown;
    start_time?: unknown;
    race_name?: unknown;
    format?: unknown;
    track?: unknown;
  } & Record<string, unknown>
>;

export type DnaCoreRaceHistoryClient = Readonly<{
  page: (input: {
    coreId: number;
    page: number;
  }) => Promise<DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]>>;
}>;

export type DnaCoreRaceHistoryTransport = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readHistoryEnvelope(
  response: Response,
): Promise<DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]>> {
  const rateLimit = readDnaOpenLabRateLimit(response.headers);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Core race history returned non-JSON content",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (!isRecord(payload) || typeof payload.status !== "string") {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Core race history response envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (response.status === 429 || payload.status === "error") {
    throw new DnaOpenLabApiError({
      kind: response.status === 429 ? "rate_limited" : "api_error",
      message:
        response.status === 429
          ? "DNA Core race history rate limit was reached"
          : "DNA Core race history returned an API error",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (
    payload.status !== "success" ||
    !Array.isArray(payload.result) ||
    payload.result.length > DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE
  ) {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Core race history success envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }

  const rows = payload.result.map((value) => {
    if (!isRecord(value)) {
      throw new DnaOpenLabApiError({
        kind: "malformed_response",
        message: "DNA Core race history result row is invalid",
        httpStatus: response.status,
        rateLimit,
      });
    }
    return Object.freeze({ ...value }) as DnaCoreRaceHistoryRow;
  });

  return Object.freeze({
    result: Object.freeze(rows),
    httpStatus: response.status,
    rateLimit,
  });
}

export function createDnaCoreRaceHistoryClient(
  input: {
    transport?: DnaCoreRaceHistoryTransport;
    endpointUrl?: string;
  } = {},
): DnaCoreRaceHistoryClient {
  const transport = input.transport ?? fetch;
  const endpointUrl = input.endpointUrl ?? DNA_CORE_RACE_HISTORY_URL;
  if (!/^https:\/\//u.test(endpointUrl)) {
    invalidConfiguration("DNA Core race history URL must use HTTPS");
  }

  return Object.freeze({
    page: async ({ coreId, page }) => {
      const hid = positiveInteger(coreId, "coreId");
      const pageNumber = positiveInteger(page, "page");
      let response: Response;
      try {
        response = await transport(endpointUrl, {
          method: "POST",
          headers: new Headers({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ hid, page: pageNumber }),
          cache: "no-store",
        });
      } catch {
        throw new DnaOpenLabApiError({
          kind: "transport_error",
          message: "DNA Core race history transport is unavailable",
        });
      }
      return readHistoryEnvelope(response);
    },
  });
}

export function dnaCoreRaceHistoryRaceIdentifier(
  value: unknown,
): DnaRaceIdentifier | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : null;
}
