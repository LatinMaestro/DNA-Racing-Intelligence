import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAXIMUM_VALUE_LENGTH = 4096;

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

  const publishableKey = requiredValue(
    environment,
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  );
  if (!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/u.test(publishableKey)) {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY has an invalid shape");
  }

  const clerkSecretKey = requiredValue(environment, "CLERK_SECRET_KEY");
  if (!/^sk_(?:test|live)_[A-Za-z0-9_-]+$/u.test(clerkSecretKey)) {
    throw new Error("CLERK_SECRET_KEY has an invalid shape");
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
      name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      value: publishableKey,
      visibility: "config",
    },
    {
      name: "CLERK_SECRET_KEY",
      value: clerkSecretKey,
      visibility: "secret",
    },
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

export function syncPreviewEnvironment({
  environment = process.env,
  runner = spawnSync,
} = {}) {
  const specification = previewEnvironmentSpecification(environment);
  const token = requiredValue(environment, "VERCEL_TOKEN");
  const sensitiveValues = [token, ...specification.map(({ value }) => value)];

  for (const entry of specification) {
    const result = runner(
      "vercel",
      [
        "env",
        "add",
        entry.name,
        "preview",
        "--force",
        "--yes",
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
      const detail = redact(
        [result.error?.message, result.stderr, result.stdout]
          .filter(Boolean)
          .join("\n"),
        sensitiveValues,
      );
      throw new Error(
        `Could not synchronize ${entry.name} to Preview${detail === "" ? "" : `: ${detail}`}`,
      );
    }
  }

  return specification.map(({ name, visibility }) => ({ name, visibility }));
}

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const specification = validateOnly
    ? previewEnvironmentSpecification(process.env).map(
        ({ name, visibility }) => ({ name, visibility }),
      )
    : syncPreviewEnvironment();

  const action = validateOnly ? "Validated" : "Synchronized";
  process.stdout.write(
    `${action} ${specification.length} bounded Preview environment variables without printing values.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
