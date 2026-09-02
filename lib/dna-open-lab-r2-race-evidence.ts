import { createHash } from "node:crypto";

import type {
  DnaFinishedRaceIdentityConflictQuarantine,
  DnaFinishedRaceIdentityConflictQuarantineReceipt,
  DnaFinishedRaceWindowPublication,
  DnaFinishedRaceWindowPublicationReceipt,
  DnaFinishedRaceWindowPublisher,
} from "./dna-open-lab-finished-race-backfill";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
} from "./dna-open-lab-v1-client";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_MAXIMUM_OBJECT_BYTES = 8 * 1024 * 1024;
const JSON_CONTENT_TYPE = "application/json";

export type DnaOpenLabR2RaceEvidenceStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
>;

export type DnaOpenLabR2RaceEvidenceConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabR2RaceEvidenceStoragePort;
  maximumObjectBytes?: number;
}>;

export type DnaOpenLabR2RaceEvidencePorts = Readonly<{
  raceDocumentClient: Pick<DnaOpenLabClient, "raceDocs">;
  publisher: DnaFinishedRaceWindowPublisher;
  identityConflictQuarantine: DnaFinishedRaceIdentityConflictQuarantine;
}>;

function evidenceError(message: string): never {
  throw new Error(`DNA Open Lab R2 race evidence: ${message}`);
}

function safeText(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    evidenceError(`${field} is invalid`);
  }
  return normalized;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    evidenceError(`${field} must be a positive safe integer`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      evidenceError("raw API evidence contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return evidenceError("raw API evidence contains a non-JSON value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

function raceIdentifier(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      evidenceError("race id must be a positive safe integer");
    }
    return String(value);
  }
  if (typeof value !== "string") {
    evidenceError("race id must be a string or positive safe integer");
  }
  return safeText(value, "race id");
}

function raceIdentityHash(sourceRaceId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-race\u0000${sourceRaceId}`, "utf8")
    .digest("hex");
}

function hasAuthoritativeRaceIdentity(observation: unknown): boolean {
  if (
    typeof observation !== "object" ||
    observation === null ||
    Array.isArray(observation)
  ) {
    return false;
  }
  const rid = (observation as Readonly<Record<string, unknown>>).rid;
  return (
    (typeof rid === "number" && Number.isSafeInteger(rid) && rid >= 1) ||
    (typeof rid === "string" && rid.trim() !== "")
  );
}

function objectBody(
  value: unknown,
  maximumObjectBytes: number,
): Readonly<{
  bytes: Uint8Array;
  bodySha256: string;
}> {
  const canonical = canonicalJson(value);
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumObjectBytes) {
    evidenceError("evidence object exceeds its bounded byte capacity");
  }
  return Object.freeze({ bytes, bodySha256: sha256(canonical) });
}

function oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

function assertPrivateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    input.publicAccessDisabled !== true ||
    input.r2DevDisabled !== true ||
    input.customDomainCount !== 0
  ) {
    evidenceError("evidence bucket is not private");
  }
}

function metadataValue(
  metadata: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.trim() === "") {
    evidenceError(`evidence object metadata ${key} is unavailable`);
  }
  return value;
}

async function verifyStoredObject(input: {
  storage: DnaOpenLabR2RaceEvidenceStoragePort;
  bucketName: string;
  key: string;
  byteLength: number;
  bodySha256: string;
  expectedMetadata: Readonly<Record<string, string>>;
}): Promise<void> {
  const head = await input.storage.headObject({
    bucketName: input.bucketName,
    key: input.key,
  });
  if (head.status !== "ready") {
    evidenceError("evidence object is missing after publication");
  }
  if (
    head.contentType !== JSON_CONTENT_TYPE ||
    head.byteLength !== input.byteLength ||
    head.checksumSha256 !== input.bodySha256
  ) {
    evidenceError("evidence object integrity does not match publication");
  }
  for (const [key, value] of Object.entries(input.expectedMetadata)) {
    if (metadataValue(head.metadata, key) !== value) {
      evidenceError(
        `evidence object metadata ${key} does not match publication`,
      );
    }
  }
}

async function putVerifiedObject(input: {
  storage: DnaOpenLabR2RaceEvidenceStoragePort;
  bucketName: string;
  key: string;
  body: Uint8Array;
  bodySha256: string;
  metadata: Readonly<Record<string, string>>;
}): Promise<void> {
  await input.storage.putObjectIfAbsent({
    bucketName: input.bucketName,
    key: input.key,
    body: oneChunk(input.body),
    contentType: JSON_CONTENT_TYPE,
    byteLength: input.body.byteLength,
    checksumSha256: input.bodySha256,
    metadata: input.metadata,
  });
  await verifyStoredObject({
    storage: input.storage,
    bucketName: input.bucketName,
    key: input.key,
    byteLength: input.body.byteLength,
    bodySha256: input.bodySha256,
    expectedMetadata: input.metadata,
  });
}

function createBucketPrivacyGuard(input: {
  storage: DnaOpenLabR2RaceEvidenceStoragePort;
  bucketName: string;
}): () => Promise<void> {
  let verified: Promise<void> | null = null;
  return () => {
    verified ??= input.storage
      .readBucketPrivacy({ bucketName: input.bucketName })
      .then((privacy) => assertPrivateBucket(privacy));
    return verified;
  };
}

function raceDocumentObjectKey(input: {
  ownerPrefix: string;
  sourceRaceId: string;
  rawEvidenceSha256: string;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "races",
    "docs",
    raceIdentityHash(input.sourceRaceId),
    `${input.rawEvidenceSha256}.json`,
  ].join("/");
}

function finishedWindowObjectKey(input: {
  ownerPrefix: string;
  windowKey: string;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "races",
    "finished-windows",
    `${input.windowKey}.json`,
  ].join("/");
}

function unresolvedIdentityObjectKey(input: {
  ownerPrefix: string;
  evidenceLocatorSha256: string;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "races",
    "quarantine",
    "unresolved-identity",
    `${input.evidenceLocatorSha256}.json`,
  ].join("/");
}

export function createDnaOpenLabR2FinishedRaceIdentityConflictQuarantine(
  configuration: DnaOpenLabR2RaceEvidenceConfiguration,
): DnaFinishedRaceIdentityConflictQuarantine {
  const ownerId = safeText(configuration.ownerId, "ownerId");
  const bucketName = safeText(configuration.bucketName, "bucketName");
  const maximumObjectBytes = positiveSafeInteger(
    configuration.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES,
    "maximumObjectBytes",
  );
  const prefix = ownerPrefix(ownerId);
  const ensurePrivateBucket = createBucketPrivacyGuard({
    storage: configuration.storage,
    bucketName,
  });

  return async (
    input,
  ): Promise<DnaFinishedRaceIdentityConflictQuarantineReceipt> => {
    await ensurePrivateBucket();
    if (
      !Number.isSafeInteger(input.sourceObservationOrdinal) ||
      input.sourceObservationOrdinal < 1 ||
      !SHA_256_PATTERN.test(input.rawEvidenceSha256) ||
      hasAuthoritativeRaceIdentity(input.observation)
    ) {
      evidenceError("identity-conflict observation authority is invalid");
    }
    const startMilliseconds = Date.parse(input.window.startTime);
    const endMilliseconds = Date.parse(input.window.endTime);
    if (
      !Number.isFinite(startMilliseconds) ||
      !Number.isFinite(endMilliseconds) ||
      startMilliseconds > endMilliseconds
    ) {
      evidenceError("identity-conflict window is invalid");
    }
    const normalizedWindow = Object.freeze({
      startTime: new Date(startMilliseconds).toISOString(),
      endTime: new Date(endMilliseconds).toISOString(),
    });
    if (sha256(canonicalJson(input.observation)) !== input.rawEvidenceSha256) {
      evidenceError("identity-conflict raw checksum is invalid");
    }
    const evidenceLocatorSha256 = sha256(
      canonicalJson({
        endpoint: "races.finished",
        window: normalizedWindow,
        sourceObservationOrdinal: input.sourceObservationOrdinal,
        rawEvidenceSha256: input.rawEvidenceSha256,
      }),
    );
    const envelope = Object.freeze({
      schemaVersion: 1,
      authority: "unresolved_source_identity",
      canonicalPublishable: false,
      lastGoodPublishable: false,
      source: "dna_open_lab",
      sourceVersion: "v1",
      endpoint: "races.finished",
      evidenceLocatorSha256,
      rawEvidenceSha256: input.rawEvidenceSha256,
      window: normalizedWindow,
      sourceObservationOrdinal: input.sourceObservationOrdinal,
      observation: input.observation,
    });
    const body = objectBody(envelope, maximumObjectBytes);
    const objectKey = unresolvedIdentityObjectKey({
      ownerPrefix: prefix,
      evidenceLocatorSha256,
    });
    const metadata = Object.freeze({
      "dna-source": "dna_open_lab",
      "dna-version": "v1",
      "dna-endpoint": "races.finished",
      "dna-owner-sha256": prefix,
      "dna-authority": "unresolved_source_identity",
      "dna-evidence-locator-sha256": evidenceLocatorSha256,
      "dna-raw-sha256": input.rawEvidenceSha256,
      "dna-canonical-publishable": "false",
      "dna-last-good-publishable": "false",
    });
    await putVerifiedObject({
      storage: configuration.storage,
      bucketName,
      key: objectKey,
      body: body.bytes,
      bodySha256: body.bodySha256,
      metadata,
    });
    return Object.freeze({
      evidenceLocatorSha256,
      rawEvidenceSha256: input.rawEvidenceSha256,
      objectKey,
      bodySha256: body.bodySha256,
      byteLength: body.bytes.byteLength,
    });
  };
}

function assertHydratedEvidence(input: {
  evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>;
}): void {
  if (
    input.evidence.source !== "dna_open_lab" ||
    input.evidence.sourceVersion !== "v1" ||
    input.evidence.scope !== "races" ||
    input.evidence.endpoint !== "races.docs" ||
    !SHA_256_PATTERN.test(input.evidence.rawEvidenceSha256)
  ) {
    evidenceError("hydrated race evidence provenance is invalid");
  }
}

/**
 * Wraps DNA's bounded race-doc client so every full raw Race document is stored
 * immutably in private R2 before the response is exposed to the hydrator.
 */
export function createDnaOpenLabR2RaceDocumentClient(input: {
  client: Pick<DnaOpenLabClient, "raceDocs">;
  configuration: DnaOpenLabR2RaceEvidenceConfiguration;
}): Pick<DnaOpenLabClient, "raceDocs"> {
  const ownerId = safeText(input.configuration.ownerId, "ownerId");
  const bucketName = safeText(input.configuration.bucketName, "bucketName");
  const maximumObjectBytes = positiveSafeInteger(
    input.configuration.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES,
    "maximumObjectBytes",
  );
  const prefix = ownerPrefix(ownerId);
  const ensurePrivateBucket = createBucketPrivacyGuard({
    storage: input.configuration.storage,
    bucketName,
  });

  return Object.freeze({
    raceDocs: async (
      raceIds,
    ): Promise<DnaOpenLabResponse<readonly DnaRaceDocument[]>> => {
      await ensurePrivateBucket();
      const response = await input.client.raceDocs(raceIds);
      for (const document of response.result) {
        const sourceRaceId = raceIdentifier(document.rid);
        const rawEvidenceSha256 = dnaOpenLabRawEvidenceSha256(document);
        const body = objectBody(document, maximumObjectBytes);
        if (body.bodySha256 !== rawEvidenceSha256) {
          evidenceError(
            "canonical Race document checksum drifted from API evidence hash",
          );
        }
        const key = raceDocumentObjectKey({
          ownerPrefix: prefix,
          sourceRaceId,
          rawEvidenceSha256,
        });
        const metadata = Object.freeze({
          "dna-source": "dna_open_lab",
          "dna-version": "v1",
          "dna-endpoint": "races.docs",
          "dna-owner-sha256": prefix,
          "dna-race-id-sha256": raceIdentityHash(sourceRaceId),
          "dna-raw-sha256": rawEvidenceSha256,
        });
        await putVerifiedObject({
          storage: input.configuration.storage,
          bucketName,
          key,
          body: body.bytes,
          bodySha256: body.bodySha256,
          metadata,
        });
      }
      return response;
    },
  });
}

/**
 * Publishes one accepted finished-race window manifest only after every hydrated
 * full Race document referenced by the window is already present and verified
 * in private R2. The backfill checkpoint advances only after this receipt.
 */
export function createDnaOpenLabR2FinishedRaceWindowPublisher(
  configuration: DnaOpenLabR2RaceEvidenceConfiguration,
): DnaFinishedRaceWindowPublisher {
  const ownerId = safeText(configuration.ownerId, "ownerId");
  const bucketName = safeText(configuration.bucketName, "bucketName");
  const maximumObjectBytes = positiveSafeInteger(
    configuration.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES,
    "maximumObjectBytes",
  );
  const prefix = ownerPrefix(ownerId);
  const ensurePrivateBucket = createBucketPrivacyGuard({
    storage: configuration.storage,
    bucketName,
  });

  return async (
    publication: DnaFinishedRaceWindowPublication,
  ): Promise<DnaFinishedRaceWindowPublicationReceipt> => {
    await ensurePrivateBucket();
    if (
      !SHA_256_PATTERN.test(publication.windowKey) ||
      !SHA_256_PATTERN.test(publication.contentSha256)
    ) {
      evidenceError("finished-race publication hashes are invalid");
    }

    const discoveredIds = publication.discoveredRaces.map((race) => {
      const sourceRaceId =
        typeof race === "object" && race !== null && !Array.isArray(race)
          ? (race as Readonly<Record<string, unknown>>).rid
          : undefined;
      return raceIdentifier(sourceRaceId);
    });
    const hydratedIds = publication.hydratedDocuments.map((evidence) => {
      assertHydratedEvidence({ evidence });
      return raceIdentifier(evidence.canonical.sourceRaceId);
    });
    if (
      discoveredIds.length !== hydratedIds.length ||
      new Set(discoveredIds).size !== discoveredIds.length ||
      [...discoveredIds].sort().join("\u0000") !==
        [...hydratedIds].sort().join("\u0000")
    ) {
      evidenceError(
        "finished-race window cannot publish unresolved or mismatched identity",
      );
    }

    const raceDocumentObjects = [] as Array<
      Readonly<{
        sourceRaceId: string;
        rawEvidenceSha256: string;
        objectKey: string;
      }>
    >;
    for (const evidence of publication.hydratedDocuments) {
      assertHydratedEvidence({ evidence });
      const sourceRaceId = raceIdentifier(evidence.canonical.sourceRaceId);
      const objectKey = raceDocumentObjectKey({
        ownerPrefix: prefix,
        sourceRaceId,
        rawEvidenceSha256: evidence.rawEvidenceSha256,
      });
      const head = await configuration.storage.headObject({
        bucketName,
        key: objectKey,
      });
      if (head.status !== "ready") {
        evidenceError(`full Race document ${sourceRaceId} is not archived`);
      }
      if (
        head.contentType !== JSON_CONTENT_TYPE ||
        head.checksumSha256 !== evidence.rawEvidenceSha256 ||
        metadataValue(head.metadata, "dna-raw-sha256") !==
          evidence.rawEvidenceSha256 ||
        metadataValue(head.metadata, "dna-race-id-sha256") !==
          raceIdentityHash(sourceRaceId)
      ) {
        evidenceError(
          `full Race document ${sourceRaceId} archive is inconsistent`,
        );
      }
      raceDocumentObjects.push(
        Object.freeze({
          sourceRaceId,
          rawEvidenceSha256: evidence.rawEvidenceSha256,
          objectKey,
        }),
      );
    }

    const identityConflictQuarantineObjects =
      [] as Array<DnaFinishedRaceIdentityConflictQuarantineReceipt>;
    const seenQuarantineLocators = new Set<string>();
    for (const receipt of publication.identityConflictQuarantineReceipts) {
      const expectedObjectKey = unresolvedIdentityObjectKey({
        ownerPrefix: prefix,
        evidenceLocatorSha256: receipt.evidenceLocatorSha256,
      });
      if (
        !SHA_256_PATTERN.test(receipt.evidenceLocatorSha256) ||
        !SHA_256_PATTERN.test(receipt.rawEvidenceSha256) ||
        !SHA_256_PATTERN.test(receipt.bodySha256) ||
        !Number.isSafeInteger(receipt.byteLength) ||
        receipt.byteLength < 1 ||
        receipt.objectKey !== expectedObjectKey ||
        seenQuarantineLocators.has(receipt.evidenceLocatorSha256)
      ) {
        evidenceError("finished-race quarantine receipt is invalid");
      }
      const head = await configuration.storage.headObject({
        bucketName,
        key: receipt.objectKey,
      });
      if (
        head.status !== "ready" ||
        head.contentType !== JSON_CONTENT_TYPE ||
        head.byteLength !== receipt.byteLength ||
        head.checksumSha256 !== receipt.bodySha256 ||
        metadataValue(head.metadata, "dna-authority") !==
          "unresolved_source_identity" ||
        metadataValue(head.metadata, "dna-evidence-locator-sha256") !==
          receipt.evidenceLocatorSha256 ||
        metadataValue(head.metadata, "dna-raw-sha256") !==
          receipt.rawEvidenceSha256 ||
        metadataValue(head.metadata, "dna-canonical-publishable") !== "false" ||
        metadataValue(head.metadata, "dna-last-good-publishable") !== "false"
      ) {
        evidenceError("finished-race quarantine archive is inconsistent");
      }
      seenQuarantineLocators.add(receipt.evidenceLocatorSha256);
      identityConflictQuarantineObjects.push(receipt);
    }

    const manifest = Object.freeze({
      schemaVersion: 2,
      source: "dna_open_lab",
      sourceVersion: "v1",
      endpoint: "races.finished",
      windowKey: publication.windowKey,
      contentSha256: publication.contentSha256,
      window: publication.window,
      discoveredRaces: publication.discoveredRaces,
      raceDocumentObjects: Object.freeze(raceDocumentObjects),
      identityConflictQuarantineObjects: Object.freeze(
        identityConflictQuarantineObjects,
      ),
    });
    const body = objectBody(manifest, maximumObjectBytes);
    const objectKey = finishedWindowObjectKey({
      ownerPrefix: prefix,
      windowKey: publication.windowKey,
    });
    const metadata = Object.freeze({
      "dna-source": "dna_open_lab",
      "dna-version": "v1",
      "dna-endpoint": "races.finished",
      "dna-owner-sha256": prefix,
      "dna-window-key": publication.windowKey,
      "dna-content-sha256": publication.contentSha256,
      "dna-document-count": String(publication.hydratedDocuments.length),
      "dna-omitted-identity-count": String(
        identityConflictQuarantineObjects.length,
      ),
    });
    await putVerifiedObject({
      storage: configuration.storage,
      bucketName,
      key: objectKey,
      body: body.bytes,
      bodySha256: body.bodySha256,
      metadata,
    });

    return Object.freeze({
      windowKey: publication.windowKey,
      contentSha256: publication.contentSha256,
      documentCount: publication.hydratedDocuments.length,
      manifestObjectKey: objectKey,
      manifestBodySha256: body.bodySha256,
      manifestByteLength: body.bytes.byteLength,
    });
  };
}

export function createDnaOpenLabR2RaceEvidencePorts(input: {
  client: Pick<DnaOpenLabClient, "raceDocs">;
  configuration: DnaOpenLabR2RaceEvidenceConfiguration;
}): DnaOpenLabR2RaceEvidencePorts {
  return Object.freeze({
    raceDocumentClient: createDnaOpenLabR2RaceDocumentClient(input),
    publisher: createDnaOpenLabR2FinishedRaceWindowPublisher(
      input.configuration,
    ),
    identityConflictQuarantine:
      createDnaOpenLabR2FinishedRaceIdentityConflictQuarantine(
        input.configuration,
      ),
  });
}
