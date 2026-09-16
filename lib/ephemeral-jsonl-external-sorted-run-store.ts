import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type RunReceipt = Readonly<{
  path: string;
  recordCount: number;
  byteLength: number;
  sha256: string;
}>;

function safeText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`Ephemeral external-sort ${field} is invalid.`);
  }
  return normalized;
}

/**
 * Process-local scratch for one bounded hosted command. Run IDs are hashed so
 * source identities never become paths, and each completed file is verified
 * while it is read. The caller owns removal of the containing temp directory.
 */
export function createEphemeralJsonlExternalSortedRunStore<T>(input: {
  rootDirectory: string;
  namespace: string;
  maximumRecordBytes?: number;
}): RaceArchiveExternalSortedRunStore<T> {
  const rootDirectory = safeText(input.rootDirectory, "root directory", 4_096);
  const namespace = safeText(input.namespace, "namespace", 128);
  const maximumRecordBytes = input.maximumRecordBytes ?? 1024 * 1024;
  if (
    !Number.isSafeInteger(maximumRecordBytes) ||
    maximumRecordBytes < 1 ||
    maximumRecordBytes > 16 * 1024 * 1024
  ) {
    throw new Error("Ephemeral external-sort record-byte bound is invalid.");
  }
  const receipts = new Map<string, RunReceipt>();

  function identity(runId: string): Readonly<{ runId: string; path: string }> {
    const normalized = safeText(runId, "run ID", 512);
    const digest = createHash("sha256")
      .update(`${namespace}\u0000${normalized}`, "utf8")
      .digest("hex");
    return Object.freeze({
      runId: normalized,
      path: join(rootDirectory, `${digest}.jsonl`),
    });
  }

  return Object.freeze({
    async writeRun({ runId, records }) {
      const target = identity(runId);
      if (receipts.has(target.runId)) {
        throw new Error("Ephemeral external-sort run already exists.");
      }
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const handle = await open(target.path, "wx", 0o600);
      const digest = createHash("sha256");
      let recordCount = 0;
      let byteLength = 0;
      let pending = "";
      try {
        for await (const record of records) {
          const serialized = `${JSON.stringify(record)}\n`;
          const serializedBytes = Buffer.byteLength(serialized, "utf8");
          if (serializedBytes < 2 || serializedBytes > maximumRecordBytes) {
            throw new Error(
              "Ephemeral external-sort record exceeds its byte bound.",
            );
          }
          recordCount += 1;
          byteLength += serializedBytes;
          if (
            !Number.isSafeInteger(byteLength) ||
            byteLength > Number.MAX_SAFE_INTEGER
          ) {
            throw new Error(
              "Ephemeral external-sort byte accounting overflowed.",
            );
          }
          digest.update(serialized, "utf8");
          pending += serialized;
          if (Buffer.byteLength(pending, "utf8") >= 1024 * 1024) {
            await handle.writeFile(pending, { encoding: "utf8" });
            pending = "";
          }
        }
        if (pending !== "") {
          await handle.writeFile(pending, { encoding: "utf8" });
        }
        await handle.sync();
        receipts.set(
          target.runId,
          Object.freeze({
            path: target.path,
            recordCount,
            byteLength,
            sha256: digest.digest("hex"),
          }),
        );
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(target.path).catch(() => undefined);
        throw error;
      }
      await handle.close();
    },

    readRun({ runId }) {
      const target = identity(runId);
      const receipt = receipts.get(target.runId);
      if (receipt === undefined || receipt.path !== target.path) {
        throw new Error("Ephemeral external-sort run is unavailable.");
      }
      return (async function* () {
        const stream = createReadStream(receipt.path, {
          encoding: "utf8",
          highWaterMark: 1024 * 1024,
        });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        const digest = createHash("sha256");
        let recordCount = 0;
        let byteLength = 0;
        let completed = false;
        try {
          for await (const line of lines) {
            const serialized = `${line}\n`;
            const serializedBytes = Buffer.byteLength(serialized, "utf8");
            if (serializedBytes < 2 || serializedBytes > maximumRecordBytes) {
              throw new Error(
                "Ephemeral external-sort record exceeds its byte bound.",
              );
            }
            digest.update(serialized, "utf8");
            recordCount += 1;
            byteLength += serializedBytes;
            yield JSON.parse(line) as T;
          }
          completed = true;
        } finally {
          lines.close();
          stream.destroy();
        }
        if (!completed) return;
        if (
          recordCount !== receipt.recordCount ||
          byteLength !== receipt.byteLength ||
          digest.digest("hex") !== receipt.sha256
        ) {
          throw new Error(
            "Ephemeral external-sort run failed exact verification.",
          );
        }
      })();
    },

    async deleteRun({ runId }) {
      const target = identity(runId);
      const receipt = receipts.get(target.runId);
      if (receipt === undefined) return;
      if (receipt.path !== target.path) {
        throw new Error("Ephemeral external-sort run ownership changed.");
      }
      await unlink(receipt.path);
      receipts.delete(target.runId);
    },
  });
}
