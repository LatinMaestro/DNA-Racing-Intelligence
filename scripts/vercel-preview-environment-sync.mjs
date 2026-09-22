import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAXIMUM_VALUE_LENGTH = 4096;
const INHERITED_PRODUCTION_KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

function requiredValue(environment, name) {
  const value = environment[name] ?? "";
  if (
    value === "" ||
    value !== value.trim() ||
    value.length > MAXIMUM_VALUE_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is missing, padded, or invalid`);
  }
  return value;
}

export function previewEnvironmentSpecification(environment) {
  const runtimeRole = requiredValue(environment, "DNA_DATABASE_RUNTIME_ROLE");
  if (runtimeRole !== "dna_app_runtime") {
    throw new Error(
      "DNA_DATABASE_RUNTIME_ROLE is not the commissioned runtime role",
    );
  }

  const authorizedOwnerId = requiredValue(
    environment,
    "AUTHORIZED_CLERK_USER_ID",
  );
  if (!/^user_[A-Za-z0-9_-]+$/u.test(authorizedOwnerId)) {
    throw new Error("AUTHORIZED_CLERK_USER_ID is not a Clerk user ID");
  }

  const databaseUrlValue = requiredValue(environment, "DATABASE_URL");
  const databaseUrl = new URL(databaseUrlValue);
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL is not PostgreSQL");
  }
  if (decodeURIComponent(databaseUrl.username) !== runtimeRole) {
    throw new Error("DATABASE_URL does not authenticate as the runtime role");
  }
  if (databaseUrl.password === "") {
    throw new Error("DATABASE_URL has no runtime credential");
  }
  if (
    !databaseUrl.hostname.includes("-pooler.") ||
    !databaseUrl.hostname.endsWith(".neon.tech")
  ) {
    throw new Error("DATABASE_URL is not a pooled Neon connection");
  }
  if (databaseUrl.searchParams.get("sslmode") !== "require") {
    throw new Error("DATABASE_URL must require TLS");
  }

  const databaseOwnerId = requiredValue(environment, "DNA_DATABASE_OWNER_ID");
  const previewAccess = requiredValue(environment, "ENABLE_PHASE0_REVIEW");
  if (previewAccess !== "1") {
    throw new Error(
      "ENABLE_PHASE0_REVIEW must explicitly enable Preview access",
    );
  }

  return [
    {
      name: "AUTHORIZED_CLERK_USER_ID",
      value: authorizedOwnerId,
      visibility: "secret",
    },
    {
      name: "DATABASE_URL",
      value: databaseUrlValue,
      visibility: "secret",
    },
    {
      name: "DNA_DATABASE_OWNER_ID",
      value: databaseOwnerId,
      visibility: "secret",
    },
    {
      name: "DNA_DATABASE_RUNTIME_ROLE",
      value: runtimeRole,
      visibility: "config",
    },
    {
      name: "ENABLE_PHASE0_REVIEW",
      value: previewAccess,
      visibility: "config",
    },
  ];
}

function redact(text, sensitiveValues) {
  let result = text;
  for (const value of sensitiveValues) {
    result = result.replaceAll(value, "[REDACTED]");
  }
  return result;
}

function metadataUrl(environment, suffix = "") {
  const projectId = encodeURIComponent(
    requiredValue(environment, "VERCEL_PROJECT_ID"),
  );
  const organizationId = encodeURIComponent(
    requiredValue(environment, "VERCEL_ORG_ID"),
  );
  return `https://api.vercel.com/v9/projects/${projectId}/env${suffix}?teamId=${organizationId}`;
}

async function readJsonResponse(response, action) {
  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function hasTarget(entry, target) {
  return Array.isArray(entry.target) && entry.target.includes(target);
}

function selectInheritedEntry(entries, key) {
  const matches = entries.filter(
    (entry) =>
      entry &&
      entry.key === key &&
      entry.gitBranch == null &&
      hasTarget(entry, "production"),
  );
  if (matches.length !== 1) {
    throw new Error(
      `${key} does not have exactly one unbranched Production binding`,
    );
  }
  const [entry] = matches;
  if (typeof entry.id !== "string" || entry.id === "") {
    throw new Error(`${key} has no environment-variable identity`);
  }
  return entry;
}

async function fetchEnvironmentMetadata(environment, fetcher) {
  const token = requiredValue(environment, "VERCEL_TOKEN");
  const response = await fetcher(metadataUrl(environment), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await readJsonResponse(
    response,
    "Vercel environment metadata lookup",
  );
  if (!Array.isArray(payload.envs)) {
    throw new Error("Vercel environment metadata response has no envs list");
  }
  return payload.envs;
}

async function extendInheritedBindings(environment, fetcher, entries) {
  const token = requiredValue(environment, "VERCEL_TOKEN");
  for (const key of INHERITED_PRODUCTION_KEYS) {
    const entry = selectInheritedEntry(entries, key);
    if (hasTarget(entry, "preview")) {
      continue;
    }
    const targets = [...new Set([...entry.target, "preview"])];
    const response = await fetcher(
      metadataUrl(environment, `/${encodeURIComponent(entry.id)}`),
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: targets }),
      },
    );
    await readJsonResponse(
      response,
      `Vercel Preview scope extension for ${key}`,
    );
  }
}

export async function syncPreviewEnvironment({
  environment = process.env,
  runner = spawnSync,
  fetcher = fetch,
  validateOnly = false,
} = {}) {
  const specification = previewEnvironmentSpecification(environment);
  const token = requiredValue(environment, "VERCEL_TOKEN");
  const sensitiveValues = [token, ...specification.map(({ value }) => value)];

  try {
    let entries = await fetchEnvironmentMetadata(environment, fetcher);
    if (!validateOnly) {
      await extendInheritedBindings(environment, fetcher, entries);

      for (const entry of specification) {
        const result = runner(
          "vercel",
          [
            "env",
            "add",
            entry.name,
            "preview",
            "--force",
            "--visibility",
            entry.visibility,
            `--token=${token}`,
          ],
          {
            input: entry.value,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
          },
        );

        if (result.error || result.status !== 0) {
          const detail = [result.error?.message, result.stderr, result.stdout]
            .filter(Boolean)
            .join("\n");
          throw new Error(
            `Could not synchronize ${entry.name} to Preview${detail === "" ? "" : `: ${detail}`}`,
          );
        }
      }
      entries = await fetchEnvironmentMetadata(environment, fetcher);
    }

    for (const key of [
      ...INHERITED_PRODUCTION_KEYS,
      ...specification.map(({ name }) => name),
    ]) {
      const matches = entries.filter(
        (entry) =>
          entry &&
          entry.key === key &&
          entry.gitBranch == null &&
          hasTarget(entry, "preview"),
      );
      if (matches.length !== 1) {
        throw new Error(
          `${key} does not have exactly one unbranched Preview binding`,
        );
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(redact(detail, sensitiveValues));
  }

  return [
    ...INHERITED_PRODUCTION_KEYS.map((name) => ({
      name,
      source: "existing-production-binding",
    })),
    ...specification.map(({ name, visibility }) => ({ name, visibility })),
  ];
}

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const specification = await syncPreviewEnvironment({ validateOnly });
  const action = validateOnly ? "Validated" : "Synchronized";
  process.stdout.write(
    `${action} ${specification.length} bounded Preview environment variables without printing values or provider identifiers.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
