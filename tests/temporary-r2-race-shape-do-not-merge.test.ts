import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only retained R2 evidence inspection only. */
const enabled = process.env.TEMP_R2_RACE_SHAPE === "1";
const d = enabled ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} missing`);
  return value;
}

const SAMPLE_KEYS = [
  "dna-open-lab/v1/010a116c388f486460ae12599b9c44842b608612c1a5b89e1e881cab1145b7ae/first-private-preview-backfill/250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4/requests/000001.json",
  "dna-open-lab/v1/010a116c388f486460ae12599b9c44842b608612c1a5b89e1e881cab1145b7ae/first-private-preview-backfill/250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4/requests/000010.json",
] as const;

function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return { kind: "array", length: value.length, sample: value.slice(0, 2) };
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return { kind: "object", keys: Object.keys(row), value: row };
  }
  return value;
}

d("TEMPORARY retained race evidence shape - DO NOT MERGE", () => {
  it("reads two retained finished-race objects without writes", async () => {
    const accountId = required("CLOUDFLARE_ACCOUNT_ID");
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: required("DNA_R2_ACCESS_KEY_ID"),
        secretAccessKey: required("DNA_R2_SECRET_ACCESS_KEY"),
      },
    });
    const bucket = required("DNA_R2_BUCKET_NAME");
    const out: unknown[] = [];
    for (const Key of SAMPLE_KEYS) {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
      const raw = await response.Body!.transformToString();
      const parsed = JSON.parse(raw) as unknown;
      out.push({ key: Key.split("/").at(-1), bytes: raw.length, summary: summarize(parsed) });
    }
    console.log("R2_RACE_SHAPE", JSON.stringify(out));
    expect(out.length).toBe(2);
  }, 30_000);
});
