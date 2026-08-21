import type {
  CloudflareImportQueueMessage,
  CloudflareImportQueuePort,
} from "./cloudflare-import-queue-adapter";

export type CloudflareQueueProducerBinding = Readonly<{
  send: (
    body: CloudflareImportQueueMessage,
    options: Readonly<{ contentType: "json" }>,
  ) => Promise<unknown>;
}>;

function queueName(value: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error("queueName is invalid");
  }
  return normalized;
}

export function createCloudflareImportQueueBindingPort(input: {
  queueName: string;
  binding: CloudflareQueueProducerBinding;
  evidencePort: Pick<CloudflareImportQueuePort, "readQueueEvidence">;
}): CloudflareImportQueuePort {
  const configuredQueueName = queueName(input.queueName);

  function assertConfiguredQueue(candidate: string): void {
    if (queueName(candidate) !== configuredQueueName) {
      throw new Error("Cloudflare import queue binding mismatch.");
    }
  }

  return Object.freeze({
    async readQueueEvidence(request) {
      assertConfiguredQueue(request.queueName);
      return input.evidencePort.readQueueEvidence(request);
    },

    async sendJson(request) {
      assertConfiguredQueue(request.queueName);
      await input.binding.send(request.body, { contentType: "json" });
    },
  });
}
