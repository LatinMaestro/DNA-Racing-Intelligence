import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function capturedValues(source: string, expression: RegExp): Set<string> {
  return new Set(
    [...source.matchAll(expression)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}

describe("hosted import environment contract", () => {
  const example = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  const importActions = readFileSync(
    new URL("../app/(private)/imports/actions.ts", import.meta.url),
    "utf8",
  );
  const documentedKeys = capturedValues(example, /^([A-Z][A-Z0-9_]*)=/gm);
  const actionKeys = capturedValues(
    importActions,
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
  );

  it("documents every hosted import action variable", () => {
    expect(
      [...actionKeys].filter((key) => !documentedKeys.has(key)).sort(),
    ).toEqual([]);
  });

  it("documents the runtime identity and provider stop-before-limit boundary", () => {
    const requiredKeys = [
      "DATABASE_URL",
      "DNA_DATABASE_OWNER_ID",
      "DNA_DATABASE_RUNTIME_ROLE",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "DNA_R2_BUCKET_NAME",
      "DNA_R2_ACCESS_KEY_ID",
      "DNA_R2_SECRET_ACCESS_KEY",
      "DNA_IMPORT_QUEUE_ID",
      "DNA_IMPORT_QUEUE_NAME",
      "DNA_IMPORT_DEAD_LETTER_QUEUE_NAME",
      "DNA_IMPORT_LIMIT_R2_STORAGE_BYTES",
      "DNA_IMPORT_LIMIT_R2_CLASS_A_OPERATIONS",
      "DNA_IMPORT_LIMIT_R2_CLASS_B_OPERATIONS",
      "DNA_IMPORT_LIMIT_NEON_STORAGE_BYTES",
      "DNA_IMPORT_LIMIT_QUEUE_BACKLOG_MESSAGES",
      "DNA_IMPORT_MINIMUM_HEADROOM_BASIS_POINTS",
      "DNA_IMPORT_MAXIMUM_MEASUREMENT_AGE_MILLISECONDS",
    ];

    expect(
      requiredKeys.filter((key) => !documentedKeys.has(key)).sort(),
    ).toEqual([]);
  });

  it("does not advertise the retired generic R2 aliases", () => {
    expect(documentedKeys.has("R2_ACCOUNT_ID")).toBe(false);
    expect(documentedKeys.has("R2_ACCESS_KEY_ID")).toBe(false);
    expect(documentedKeys.has("R2_SECRET_ACCESS_KEY")).toBe(false);
    expect(documentedKeys.has("R2_PRIVATE_BUCKET")).toBe(false);
  });
});
