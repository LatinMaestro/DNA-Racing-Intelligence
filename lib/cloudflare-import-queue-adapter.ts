import type { AggregateRetryQueue } from "./import-aggregate-retry-action-service";
import type { BackgroundImportQueue } from "./import-activation-service";
import type { ImportPreviewQueue } from "./import-upload-completion-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const QUEUE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MESSAGE_BYTES = 128 * 1024;

export type CloudflareImportQueueKind =
  "preview" | "import_activation" | "aggregate_refresh_retry";

export type CloudflareImportQueueMessage =
  | Readonly<{
      version: 1;
      kind: "preview";
      dispatchId: string;
      uploadRequestFingerprint: string;
    }>
  | Readonly<{
      version: 1;
      kind: Exclude<CloudflareImportQueueKind, "preview">;
      dispatchId: string;
    }>;

export type CloudflareImportQueueEvidence = Readonly<{
  paused: boolean;
  consumerConfigured: boolean;
  maxRetries: number;
  deadLetterQueueName: string | null;
}>;

export type CloudflareImportQueuePort = Readonly<{
  readQueueEvidence: (input: {
    queueName: string;
  }) => Promise<CloudflareImportQueueEvidence>;
  sendJson: (input: {
    queueName: string;
    body: CloudflareImportQueueMessage;
  }) => Promise<void>;
}>;

export type CloudflareImportQueueConfiguration = Readonly<{
  queueName: string;
  deadLetterQueueName: string;
  createPort: () =>
    CloudflareImportQueuePort | Promise<CloudflareImportQueuePort>;
}>;

export type CloudflareOwnerImportQueue = ImportPreviewQueue &
  BackgroundImportQueue &
  AggregateRetryQueue;

type ImportQueueInput =
  | Parameters<ImportPreviewQueue["enqueue"]>[0]
  | Parameters<BackgroundImportQueue["enqueue"]>[0]
  | Parameters<AggregateRetryQueue["enqueue"]>[0];

function requireOwner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requireQueueName(value: string, field = "queueName"): string {
  const normalized = value.trim();
  if (!QUEUE_NAME_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function assertQueueEvidence(
  evidence: CloudflareImportQueueEvidence,
  expectedDeadLetterQueueName: string,
): void {
  if (
    evidence.paused !== false ||
    evidence.consumerConfigured !== true ||
    !Number.isSafeInteger(evidence.maxRetries) ||
    evidence.maxRetries < 1 ||
    evidence.maxRetries > 10 ||
    evidence.deadLetterQueueName !== expectedDeadLetterQueueName
  ) {
    throw new Error("Cloudflare import queue readiness verification failed.");
  }
}

export function createCloudflareImportQueueForOwner(input: {
  ownerId: string;
  configuration: CloudflareImportQueueConfiguration;
}): CloudflareOwnerImportQueue {
  const ownerId = requireOwner(input.ownerId);
  const queueName = requireQueueName(input.configuration.queueName);
  const deadLetterQueueName = requireQueueName(
    input.configuration.deadLetterQueueName,
    "deadLetterQueueName",
  );
  if (deadLetterQueueName === queueName) {
    throw new Error("deadLetterQueueName must differ from queueName");
  }
  let portPromise: Promise<CloudflareImportQueuePort> | null = null;
  let readinessPromise: Promise<void> | null = null;

  function assertOwner(candidate: string): void {
    if (requireOwner(candidate) !== ownerId) {
      throw new Error("Cloudflare import queue access denied.");
    }
  }

  async function readyPort(): Promise<CloudflareImportQueuePort> {
    if (portPromise === null) {
      portPromise = Promise.resolve(input.configuration.createPort()).then(
        (created) => {
          if (created === null || typeof created !== "object") {
            throw new Error("Cloudflare import queue initialization failed.");
          }
          return created;
        },
      );
    }
    const created = await portPromise;
    if (readinessPromise === null) {
      readinessPromise = created
        .readQueueEvidence({ queueName })
        .then((evidence) => assertQueueEvidence(evidence, deadLetterQueueName));
    }
    await readinessPromise;
    return created;
  }

  return Object.freeze({
    async enqueue(queueInput: ImportQueueInput) {
      assertOwner(queueInput.ownerId);
      const dispatchId = requireSafeIdentifier(
        "previewDispatchId" in queueInput
          ? queueInput.previewDispatchId
          : queueInput.dispatchId,
        "dispatchId",
      );
      if ("uploadBatchId" in queueInput) {
        requireSafeIdentifier(queueInput.uploadBatchId, "uploadBatchId");
        if (!SHA_256_PATTERN.test(queueInput.uploadRequestFingerprint)) {
          throw new Error("uploadRequestFingerprint is invalid");
        }
      } else if ("updateSessionId" in queueInput) {
        requireSafeIdentifier(queueInput.updateSessionId, "updateSessionId");
      } else {
        requireSafeIdentifier(queueInput.refreshId, "refreshId");
      }

      const message: CloudflareImportQueueMessage =
        "uploadBatchId" in queueInput
          ? {
              version: 1,
              kind: "preview",
              dispatchId,
              uploadRequestFingerprint: queueInput.uploadRequestFingerprint,
            }
          : {
              version: 1,
              kind:
                "updateSessionId" in queueInput
                  ? "import_activation"
                  : "aggregate_refresh_retry",
              dispatchId,
            };
      const byteLength = new TextEncoder().encode(
        JSON.stringify(message),
      ).length;
      if (byteLength <= 0 || byteLength > MAX_MESSAGE_BYTES) {
        throw new Error("Cloudflare import queue message is invalid.");
      }
      const created = await readyPort();
      await created.sendJson({ queueName, body: message });

      if ("uploadBatchId" in queueInput) {
        return {
          disposition: "created" as const,
          previewDispatchId: dispatchId,
          uploadRequestFingerprint: queueInput.uploadRequestFingerprint,
        };
      }
    },
  }) as CloudflareOwnerImportQueue;
}

export function cloudflareImportQueueConfigurationFromEnvironment(
  input: Readonly<{
    queueName: string | undefined;
    deadLetterQueueName: string | undefined;
    createPort: CloudflareImportQueueConfiguration["createPort"];
  }>,
): CloudflareImportQueueConfiguration | null {
  const queueName = input.queueName?.trim() ?? "";
  const deadLetterQueueName = input.deadLetterQueueName?.trim() ?? "";
  if (queueName === "" || deadLetterQueueName === "") return null;
  return Object.freeze({
    queueName,
    deadLetterQueueName,
    createPort: input.createPort,
  });
}
