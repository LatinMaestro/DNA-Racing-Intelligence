import type { CloudflareImportQueueMessage } from "./cloudflare-import-queue-adapter";
import {
  runImportPreviewDispatch,
  type ImportPreviewProcessingCapabilities,
} from "./import-preview-processing-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type ImportQueueConsumerDecision =
  | Readonly<{
      disposition: "acknowledge";
      reason: "completed" | "not_found";
    }>
  | Readonly<{ disposition: "retry"; reason: "not_configured" }>
  | Readonly<{
      disposition: "retry";
      reason: "leased_elsewhere";
      retryAfter: string;
    }>;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Import queue message is invalid.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error("Import queue message is invalid.");
  }
}

function safeIdentifier(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Import queue message is invalid.");
  }
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error("Import queue message is invalid.");
  }
  return normalized;
}

export function parseCloudflareImportQueueMessage(
  value: unknown,
): CloudflareImportQueueMessage {
  const message = record(value);
  if (message.version !== 1 || typeof message.kind !== "string") {
    throw new Error("Import queue message is invalid.");
  }
  if (message.kind === "preview") {
    exactKeys(message, [
      "version",
      "kind",
      "dispatchId",
      "uploadRequestFingerprint",
    ]);
    if (
      typeof message.uploadRequestFingerprint !== "string" ||
      !SHA_256_PATTERN.test(message.uploadRequestFingerprint)
    ) {
      throw new Error("Import queue message is invalid.");
    }
    return {
      version: 1,
      kind: "preview",
      dispatchId: safeIdentifier(message.dispatchId),
      uploadRequestFingerprint: message.uploadRequestFingerprint,
    };
  }
  if (
    message.kind === "import_activation" ||
    message.kind === "aggregate_refresh_retry"
  ) {
    exactKeys(message, ["version", "kind", "dispatchId"]);
    return {
      version: 1,
      kind: message.kind,
      dispatchId: safeIdentifier(message.dispatchId),
    };
  }
  throw new Error("Import queue message is invalid.");
}

export async function consumeImportPreviewQueueMessage(input: {
  body: unknown;
  workerId: string;
  now: Date;
  leaseDurationMilliseconds: number;
  maximumBatchBytes: number;
  capabilities: ImportPreviewProcessingCapabilities;
}): Promise<ImportQueueConsumerDecision> {
  const message = parseCloudflareImportQueueMessage(input.body);
  if (message.kind !== "preview") {
    throw new Error("Import queue message kind is not available in this worker.");
  }
  const result = await runImportPreviewDispatch({
    previewDispatchId: message.dispatchId,
    workerId: input.workerId,
    uploadRequestFingerprint: message.uploadRequestFingerprint,
    now: input.now,
    leaseDurationMilliseconds: input.leaseDurationMilliseconds,
    maximumBatchBytes: input.maximumBatchBytes,
    capabilities: input.capabilities,
  });
  if (result.status === "not_configured") {
    return { disposition: "retry", reason: "not_configured" };
  }
  if (result.status === "leased_elsewhere") {
    return {
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: result.retryAfter,
    };
  }
  if (result.status === "not_found") {
    return { disposition: "acknowledge", reason: "not_found" };
  }
  return { disposition: "acknowledge", reason: "completed" };
}
