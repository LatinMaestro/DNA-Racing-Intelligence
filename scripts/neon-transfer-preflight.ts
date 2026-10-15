import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Must remain equal to the accepted operating ceiling, not the paid allowance.
export const NEON_TRANSFER_OPERATING_CEILING_BYTES = 4_750_000_000;

type Receipt = Readonly<{
  ready: boolean;
  reason:
    | "ready"
    | "configuration_unavailable"
    | "measurement_unavailable"
    | "measurement_invalid"
    | "transfer_exhausted";
  dataTransferBytes: number | null;
  billingWindowEndAt: string | null;
}>;

function held(reason: Receipt["reason"]): Receipt {
  return {
    ready: false,
    reason,
    dataTransferBytes: null,
    billingWindowEndAt: null,
  };
}

function instant(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  )
    return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/** Metadata only: no SQL driver, database URL, R2 access, credentials output or retry. */
export async function inspectNeonTransfer(
  input: Readonly<{
    apiKey: string | undefined;
    projectId: string | undefined;
    now?: Date;
    fetcher?: typeof fetch;
  }>,
): Promise<Receipt> {
  const { apiKey, projectId } = input;
  if (
    typeof apiKey !== "string" ||
    apiKey.length < 1 ||
    apiKey.length > 4096 ||
    apiKey.trim() !== apiKey ||
    /[\u0000-\u001f\u007f]/u.test(apiKey) ||
    typeof projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(projectId)
  )
    return held("configuration_unavailable");
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    return held("measurement_invalid");
  try {
    const response = await (input.fetcher ?? fetch)(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return held("measurement_unavailable");
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return held("measurement_invalid");
    const project = (body as Record<string, unknown>).project;
    if (
      project === null ||
      typeof project !== "object" ||
      Array.isArray(project)
    )
      return held("measurement_invalid");
    const row = project as Record<string, unknown>;
    const start = instant(row.consumption_period_start);
    const end = instant(row.consumption_period_end);
    const used = row.data_transfer_bytes;
    if (
      row.id !== projectId ||
      typeof used !== "number" ||
      !Number.isSafeInteger(used) ||
      used < 0 ||
      start === null ||
      end === null ||
      start >= end ||
      now.getTime() < start ||
      now.getTime() >= end
    )
      return held("measurement_invalid");
    const ready = used < NEON_TRANSFER_OPERATING_CEILING_BYTES;
    return {
      ready,
      reason: ready ? "ready" : "transfer_exhausted",
      dataTransferBytes: used,
      billingWindowEndAt: new Date(end).toISOString(),
    };
  } catch {
    return held("measurement_unavailable");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const receipt = await inspectNeonTransfer({
    apiKey: process.env.NEON_API_KEY,
    projectId: process.env.NEON_PROJECT_ID,
  });
  // Fixed aggregate receipt only. Never print response bodies or exception values.
  console.log(`DNA_NEON_TRANSFER_PREFLIGHT=${JSON.stringify(receipt)}`);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `ready=${receipt.ready}\n`);
}
