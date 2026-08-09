import type { CloudflareImportQueuePort } from "./cloudflare-import-queue-adapter";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const QUEUE_ID_PATTERN = /^[a-f0-9]{32}$/;
const QUEUE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

export type CloudflareImportQueuePortConfiguration = Readonly<{
  accountId: string;
  queueId: string;
  queueName: string;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
}>;

type CloudflareEnvelope = Readonly<{
  success?: unknown;
  result?: unknown;
}>;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare queue response is invalid.");
  }
  return value as Record<string, unknown>;
}

function secret(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("apiToken is invalid");
  }
  return normalized;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Cloudflare queue response is invalid.");
  }
  return value as number;
}

export function createCloudflareImportQueuePort(
  configuration: CloudflareImportQueuePortConfiguration,
): CloudflareImportQueuePort {
  const accountId = configuration.accountId.trim().toLowerCase();
  const queueId = configuration.queueId.trim().toLowerCase();
  const queueName = configuration.queueName.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId))
    throw new Error("accountId is invalid");
  if (!QUEUE_ID_PATTERN.test(queueId)) throw new Error("queueId is invalid");
  if (!QUEUE_NAME_PATTERN.test(queueName))
    throw new Error("queueName is invalid");
  const apiToken = secret(configuration.apiToken);
  const fetcher = configuration.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Cloudflare queue transport is unavailable.");
  }
  const url = `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${accountId}/queues/${queueId}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiToken}`,
  };

  async function envelope(response: Response): Promise<CloudflareEnvelope> {
    if (!response.ok) throw new Error("provider rejected queue operation");
    const value = (await response.json()) as CloudflareEnvelope;
    if (value.success !== true || value.result === undefined) {
      throw new Error("provider returned invalid queue evidence");
    }
    return value;
  }

  return Object.freeze({
    async readQueueEvidence(input) {
      if (input.queueName.trim() !== queueName) {
        throw new Error("Cloudflare queue identity is inconsistent.");
      }
      try {
        const result = record(
          (
            await envelope(
              await fetcher(url, { method: "GET", headers, cache: "no-store" }),
            )
          ).result,
        );
        if (result.queue_id !== queueId || result.queue_name !== queueName) {
          throw new Error("queue identity mismatch");
        }
        const consumers = result.consumers;
        if (!Array.isArray(consumers))
          throw new Error("consumer evidence missing");
        const consumerCount = safeInteger(result.consumers_total_count);
        const settings = record(result.settings);
        const consumer = consumers.length === 1 ? record(consumers[0]) : null;
        const consumerSettings =
          consumer === null ? null : record(consumer.settings);
        return {
          paused: settings.delivery_paused === true,
          consumerConfigured: consumerCount === 1 && consumers.length === 1,
          maxRetries:
            consumerSettings === null
              ? 0
              : safeInteger(consumerSettings.max_retries),
        };
      } catch {
        throw new Error("Cloudflare queue readiness check failed.");
      }
    },

    async sendJson(input) {
      if (input.queueName.trim() !== queueName) {
        throw new Error("Cloudflare queue identity is inconsistent.");
      }
      try {
        await envelope(
          await fetcher(`${url}/messages`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ body: input.body, content_type: "json" }),
          }),
        );
      } catch {
        throw new Error("Cloudflare queue message dispatch failed.");
      }
    },
  });
}
