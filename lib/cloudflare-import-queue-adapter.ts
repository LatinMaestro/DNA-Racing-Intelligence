import { createHash } from "node:crypto";

import type { AggregateRetryQueue } from "./import-aggregate-retry-action-service";
import type { BackgroundImportQueue } from "./import-activation-service";
import type { ImportPreviewQueue } from "./import-upload-completion-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const QUEUE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const MAX_MESSAGE_BYTES = 128 * 1024;

export type CloudflareImportQueueKind =
  "preview" | "import_activation" | "aggregate_refresh_retry";

export type CloudflareImportQueueMessage = Readonly<{
  version: 1;
  kind: CloudflareImportQueueKind;
  dispatchId: string;
  ownerScopeSha256: string;
}>;

export type CloudflareImportQueueEvidence = Readonly<{
  paused: boolean;
  consumerConfigured: boolean;
  deadLetterQueueConfigured: boolean;
  maxRetries: number;
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
  previewQueueName: string;
  backgroundQueueName: string;
  createPort: () =>
    CloudflareImportQueuePort | Promise<CloudflareImportQueuePort>;
}>;

export type CloudflareOwnerImportQueues = Readonly<{
  previewQueue: ImportPreviewQueue;
  backgroundQueue: BackgroundImportQueue & AggregateRetryQueue;
}>;

type BackgroundQueueInput =
  | Readonly<{
      ownerId: string;
      updateSessionId: string;
      dispatchId: string;
    }>
  | Readonly<{
      ownerId: string;
      refreshId: string;
      dispatchId: string;
    }>;

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

function requireQueueName(value: string, field: string): string {
  const normalized = value.trim();
  if (!QUEUE_NAME_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function ownerScopeSha256(ownerId: string): string {
  return createHash("sha256").update(`dna-queue\u0000${ownerId}`).digest("hex");
}

function assertQueueEvidence(evidence: CloudflareImportQueueEvidence): void {
  if (
    evidence.paused !== false ||
    evidence.consumerConfigured !== true ||
    evidence.deadLetterQueueConfigured !== true ||
    !Number.isSafeInteger(evidence.maxRetries) ||
    evidence.maxRetries < 1 ||
    evidence.maxRetries > 100
  ) {
    throw new Error("Cloudflare import queue readiness verification failed.");
  }
}

function validateMessageSize(message: CloudflareImportQueueMessage): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(message)).length;
  if (byteLength <= 0 || byteLength > MAX_MESSAGE_BYTES) {
    throw new Error("Cloudflare import queue message is invalid.");
  }
}

export function createCloudflareImportQueuesForOwner(input: {
  ownerId: string;
  configuration: CloudflareImportQueueConfiguration;
}): CloudflareOwnerImportQueues {
  const ownerId = requireOwner(input.ownerId);
  const previewQueueName = requireQueueName(
    input.configuration.previewQueueName,
    "previewQueueName",
  );
  const backgroundQueueName = requireQueueName(
    input.configuration.backgroundQueueName,
    "backgroundQueueName",
  );
  if (previewQueueName === backgroundQueueName) {
    throw new Error("Preview and background queues must remain separate.");
  }

  let portPromise: Promise<CloudflareImportQueuePort> | null = null;
  const evidencePromises = new Map<string, Promise<void>>();

  function assertOwner(candidate: string): void {
    if (requireOwner(candidate) !== ownerId) {
      throw new Error("Cloudflare import queue access denied.");
    }
  }

  async function port(): Promise<CloudflareImportQueuePort> {
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
    return portPromise;
  }

  async function readyPort(
    queueName: string,
  ): Promise<CloudflareImportQueuePort> {
    const created = await port();
    let evidencePromise = evidencePromises.get(queueName);
    if (evidencePromise === undefined) {
      evidencePromise = created
        .readQueueEvidence({ queueName })
        .then(assertQueueEvidence);
      evidencePromises.set(queueName, evidencePromise);
    }
    await evidencePromise;
    return created;
  }

  async function enqueue(
    queueName: string,
    kind: CloudflareImportQueueKind,
    candidateOwnerId: string,
    dispatchId: string,
  ): Promise<void> {
    assertOwner(candidateOwnerId);
    const message: CloudflareImportQueueMessage = {
      version: 1,
      kind,
      dispatchId: requireSafeIdentifier(dispatchId, "dispatchId"),
      ownerScopeSha256: ownerScopeSha256(ownerId),
    };
    validateMessageSize(message);
    const created = await readyPort(queueName);
    await created.sendJson({ queueName, body: message });
  }

  return Object.freeze({
    previewQueue: Object.freeze({
      async enqueue(
        previewInput: Parameters<ImportPreviewQueue["enqueue"]>[0],
      ) {
        requireSafeIdentifier(previewInput.uploadBatchId, "uploadBatchId");
        await enqueue(
          previewQueueName,
          "preview",
          previewInput.ownerId,
          previewInput.previewDispatchId,
        );
      },
    }),
    backgroundQueue: Object.freeze({
      async enqueue(backgroundInput: BackgroundQueueInput) {
        const kind: CloudflareImportQueueKind =
          "updateSessionId" in backgroundInput
            ? "import_activation"
            : "aggregate_refresh_retry";
        if ("updateSessionId" in backgroundInput) {
          requireSafeIdentifier(
            backgroundInput.updateSessionId,
            "updateSessionId",
          );
        } else {
          requireSafeIdentifier(backgroundInput.refreshId, "refreshId");
        }
        await enqueue(
          backgroundQueueName,
          kind,
          backgroundInput.ownerId,
          backgroundInput.dispatchId,
        );
      },
    }),
  });
}

export function cloudflareImportQueueConfigurationFromEnvironment(
  input: Readonly<{
    previewQueueName: string | undefined;
    backgroundQueueName: string | undefined;
    createPort: CloudflareImportQueueConfiguration["createPort"];
  }>,
): CloudflareImportQueueConfiguration | null {
  const previewQueueName = input.previewQueueName?.trim() ?? "";
  const backgroundQueueName = input.backgroundQueueName?.trim() ?? "";
  if (previewQueueName === "" || backgroundQueueName === "") return null;
  return Object.freeze({
    previewQueueName,
    backgroundQueueName,
    createPort: input.createPort,
  });
}
