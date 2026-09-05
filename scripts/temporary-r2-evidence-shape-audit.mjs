#!/usr/bin/env node

/**
 * TEMPORARY / DO NOT MERGE.
 * Schema-only audit of a bounded sample of retained P5 R2 evidence.
 * R2 LIST + GET only. No DNA API calls, no writes, no raw scalar values emitted.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const OUTPUT_DIR = process.env.TEMP_ANALYSIS_OUTPUT_DIR ?? "temp-shape-output";
const MAX_LISTED_OBJECTS = 17_500;
const MAX_OBJECT_BYTES = 8_388_608;
const FINISHED_SAMPLE_LIMIT = 250;
const NON_FINISHED_LIMIT = 256;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 1 || value.trim() !== value || value.length > 4096) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function ownerPrefix(ownerId) {
  return createHash("sha256").update(`dna-open-lab-owner\u0000${ownerId}`, "utf8").digest("hex");
}

function objectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function noteShape(accumulator, value, path = "", depth = 0) {
  if (depth > 7) return;
  const type = typeName(value);
  if (path !== "") {
    const current = accumulator[path] ?? { occurrences: 0, types: {}, arrayNonEmpty: 0 };
    current.occurrences += 1;
    current.types[type] = (current.types[type] ?? 0) + 1;
    if (Array.isArray(value) && value.length > 0) current.arrayNonEmpty += 1;
    accumulator[path] = current;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 4)) noteShape(accumulator, entry, `${path}[]`, depth + 1);
    return;
  }
  const record = objectRecord(value);
  if (record === null) return;
  for (const [key, entry] of Object.entries(record)) {
    const child = path === "" ? key : `${path}.${key}`;
    noteShape(accumulator, entry, child, depth + 1);
  }
}

async function bodyText(body, expectedLength) {
  if (body == null || typeof body[Symbol.asyncIterator] !== "function") throw new Error("R2 body unavailable");
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > MAX_OBJECT_BYTES) throw new Error("R2 object exceeds bound");
    chunks.push(Buffer.from(bytes));
  }
  if (total !== expectedLength) throw new Error("R2 object length mismatch");
  return Buffer.concat(chunks).toString("utf8");
}

const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID").toLowerCase();
const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 4,
});

const prefix = ["dna-open-lab", "v1", ownerPrefix(ownerId), "first-private-preview-backfill", ""].join("/");
let continuationToken;
const listed = [];
do {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
    MaxKeys: 1000,
    ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
  }));
  for (const object of page.Contents ?? []) {
    if (typeof object.Key !== "string" || !Number.isSafeInteger(object.Size) || Number(object.Size) < 1) continue;
    const match = /\/requests\/([0-9]{6})\.json$/u.exec(object.Key);
    if (match === null) continue;
    listed.push({ key: object.Key, size: Number(object.Size), ordinal: Number(match[1]) });
    if (listed.length > MAX_LISTED_OBJECTS) throw new Error("Evidence inventory exceeds temporary bound");
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken !== undefined);
listed.sort((left, right) => left.ordinal - right.ordinal);

const endpointShape = {};
const endpointDocuments = {};
const endpointResultRows = {};
const endpointCandidateIdentityPaths = {};
let finishedSampled = 0;
let nonFinishedSampled = 0;

for (const object of listed) {
  if (finishedSampled >= FINISHED_SAMPLE_LIMIT && nonFinishedSampled >= NON_FINISHED_LIMIT) break;
  const opened = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: object.key }));
  const text = await bodyText(opened.Body, object.size);
  const document = objectRecord(JSON.parse(text));
  if (document === null) continue;
  const endpoint = typeof document.endpoint === "string" ? document.endpoint : "unknown";
  const family = typeof document.family === "string" ? document.family : "unknown";
  if (family === "finished_races") {
    if (finishedSampled >= FINISHED_SAMPLE_LIMIT) continue;
    finishedSampled += 1;
  } else {
    if (nonFinishedSampled >= NON_FINISHED_LIMIT) continue;
    nonFinishedSampled += 1;
  }
  endpointDocuments[endpoint] = (endpointDocuments[endpoint] ?? 0) + 1;
  const response = objectRecord(document.response);
  const result = response?.result;
  const shape = endpointShape[endpoint] ?? {};
  noteShape(shape, result, "result");
  endpointShape[endpoint] = shape;
  endpointResultRows[endpoint] = (endpointResultRows[endpoint] ?? 0) + (Array.isArray(result) ? result.length : 1);
}

for (const [endpoint, shape] of Object.entries(endpointShape)) {
  endpointCandidateIdentityPaths[endpoint] = Object.keys(shape)
    .filter((path) => /(hid|core|entrant|participant|runner|result|finish|position|place|time|elapsed|distance|track|star|parent|offspring|child|splice|power|variance|odds)/iu.test(path))
    .sort();
  endpointShape[endpoint] = Object.fromEntries(Object.entries(shape).sort(([left], [right]) => left.localeCompare(right)));
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(
  `${OUTPUT_DIR}/evidence-shape-audit.json`,
  `${JSON.stringify({
    temporaryBranchOnly: true,
    doNotMergeIntoMain: true,
    generatedAt: new Date().toISOString(),
    listedEvidenceObjectCount: listed.length,
    finishedEvidenceDocumentsSampled: finishedSampled,
    nonFinishedEvidenceDocumentsSampled: nonFinishedSampled,
    endpointDocuments,
    endpointResultRows,
    endpointCandidateIdentityPaths,
    endpointShape,
    note: "Schema/path/type counts only. No raw scalar API values are emitted.",
  }, null, 2)}\n`,
  "utf8",
);
console.log(`Temporary schema-only audit complete: ${finishedSampled} finished + ${nonFinishedSampled} other evidence documents sampled.`);
