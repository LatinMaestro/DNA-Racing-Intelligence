import { readFile } from "node:fs/promises";

function required(name) {
  const value = process.env[name];
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 16_384
  ) {
    throw new Error("DNA status context is unavailable");
  }
  return value;
}

function sha40(value) {
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("DNA status SHA is invalid");
  }
  return value;
}

function sha64(value) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("DNA status digest is invalid");
  }
  return value;
}

function count(value) {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("DNA status count is invalid");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("DNA status count is invalid");
  }
  return number;
}

function timestamp(value) {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() > Date.now()
  ) {
    throw new Error("DNA status timestamp is invalid");
  }
  return value;
}

async function loadJson(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DNA status receipt is invalid");
  }
  return value;
}

const mode = required("DNA_STATUS_MODE");
const repository = required("GITHUB_REPOSITORY");
const token = required("GITHUB_TOKEN");
const commentId = required("DNA_STATUS_COMMENT_ID");
const runId = required("GITHUB_RUN_ID");

if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
  !/^[1-9]\d*$/u.test(commentId) ||
  !/^[1-9]\d*$/u.test(runId)
) {
  throw new Error("DNA status target is invalid");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const runUrl = "https://github.com/" + repository + "/actions/runs/" + runId;

async function mainSha() {
  const response = await fetch(
    "https://api.github.com/repos/" + repository + "/commits/main",
    { headers, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("DNA status current main is unavailable");
  }
  const body = await response.json();
  return sha40(body?.sha ?? "");
}

async function update(lines) {
  const response = await fetch(
    "https://api.github.com/repos/" +
      repository +
      "/issues/comments/" +
      commentId,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body: lines.join("\n") }),
    },
  );
  if (!response.ok) {
    throw new Error("DNA status update failed with HTTP " + response.status);
  }
}

if (mode === "ci") {
  const head = sha40(required("DNA_STATUS_HEAD_SHA"));
  if ((await mainSha()) !== head) {
    console.log("Skipped stale main CI status update.");
    process.exit(0);
  }
  const conclusion = required("DNA_STATUS_CONCLUSION");
  if (!/^[a-z_]{1,40}$/u.test(conclusion)) {
    throw new Error("DNA status conclusion is invalid");
  }
  await update([
    "<!-- dna-ci-status -->",
    "### DNA CI status",
    "Current main: " + head,
    "CI: **" + conclusion + "**",
    "Run: " + runUrl,
    "Observed: " + new Date().toISOString(),
  ]);
  process.exit(0);
}

const head = sha40(required("GITHUB_SHA"));
if ((await mainSha()) !== head) {
  throw new Error("DNA status head is no longer current main");
}

if (mode === "readiness") {
  const receipt = await loadJson(required("DNA_STATUS_RECEIPT_PATH"));
  if (
    receipt.status !== "ready_for_continuation" ||
    receipt.exactCodeHeadSha !== head ||
    receipt.previewOnly !== true ||
    receipt.providerRequestPerformed !== false ||
    receipt.persistentWritePerformed !== false ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false
  ) {
    throw new Error("DNA readiness status receipt is invalid");
  }

  const machine = {
    status: "ready_for_continuation",
    exactCodeHeadSha: head,
    unresolvedRaceCount: count(String(receipt.unresolvedRaceCount)),
    unresolvedRaceSetSha256: sha64(receipt.unresolvedRaceSetSha256),
    recoveredChunkCount: count(String(receipt.recoveredChunkCount)),
    recoveredRaceCount: count(String(receipt.recoveredRaceCount)),
    nextChunkOrdinal: count(String(receipt.nextChunkOrdinal)),
    checkpointUpdatedAt: timestamp(receipt.checkpointUpdatedAt),
    readinessCapacityObservedAt: timestamp(receipt.capacityObservedAt),
    durableBoundarySha256: sha64(receipt.durableBoundarySha256),
  };
  if (
    machine.nextChunkOrdinal !== machine.recoveredChunkCount + 1 ||
    machine.recoveredRaceCount >= machine.unresolvedRaceCount
  ) {
    throw new Error("DNA readiness status boundary is invalid");
  }

  await update([
    "<!-- dna-population-status -->",
    "### DNA entrant population status",
    "State: **ready for autonomous continuation**",
    "Durable entrant rows: **" +
      machine.recoveredRaceCount.toLocaleString("en-US") +
      "** / " +
      machine.unresolvedRaceCount.toLocaleString("en-US"),
    "Run: " + runUrl,
    "Main: " + head,
    "Sanitized dispatch authority: " + JSON.stringify(machine),
  ]);
  process.exit(0);
}

if (mode === "autonomous-running") {
  const recovered = count(required("DNA_STATUS_RECOVERED_RACE_COUNT"));
  const unresolved = count(required("DNA_STATUS_UNRESOLVED_RACE_COUNT"));
  await update([
    "<!-- dna-population-status -->",
    "### DNA entrant population status",
    "State: **autonomous session running**",
    "Starting durable entrant rows: **" +
      recovered.toLocaleString("en-US") +
      "** / " +
      unresolved.toLocaleString("en-US"),
    "Run: " + runUrl,
    "Main: " + head,
    "Observed: " + new Date().toISOString(),
  ]);
  process.exit(0);
}

if (mode === "autonomous-result") {
  const receipt = await loadJson(required("DNA_STATUS_RECEIPT_PATH"));
  const boundary = receipt.boundary;
  if (
    boundary === null ||
    typeof boundary !== "object" ||
    Array.isArray(boundary) ||
    boundary.exactCodeHeadSha !== head ||
    receipt.previewOnly !== true ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false
  ) {
    throw new Error("DNA autonomous status receipt is invalid");
  }

  const machine = {
    status: receipt.status,
    exactCodeHeadSha: head,
    completedCohortCount: Number(receipt.completedCohortCount),
    unresolvedRaceCount: count(String(boundary.unresolvedRaceCount)),
    unresolvedRaceSetSha256: sha64(boundary.unresolvedRaceSetSha256),
    recoveredChunkCount: count(String(boundary.recoveredChunkCount)),
    recoveredRaceCount: count(String(boundary.recoveredRaceCount)),
    nextChunkOrdinal: count(String(boundary.nextChunkOrdinal)),
    checkpointUpdatedAt: timestamp(boundary.checkpointUpdatedAt),
    readinessCapacityObservedAt: timestamp(boundary.capacityObservedAt),
    durableBoundarySha256: sha64(boundary.durableBoundarySha256),
  };
  if (
    !Number.isSafeInteger(machine.completedCohortCount) ||
    machine.completedCohortCount < 0 ||
    machine.nextChunkOrdinal !== machine.recoveredChunkCount + 1
  ) {
    throw new Error("DNA autonomous status boundary is invalid");
  }

  const state =
    receipt.status === "authority_complete"
      ? "authority complete"
      : "advanced; next autonomous session queued";
  await update([
    "<!-- dna-population-status -->",
    "### DNA entrant population status",
    "State: **" + state + "**",
    "Durable entrant rows: **" +
      machine.recoveredRaceCount.toLocaleString("en-US") +
      "** / " +
      machine.unresolvedRaceCount.toLocaleString("en-US"),
    "Cohorts committed this session: **" + machine.completedCohortCount + "**",
    "Run: " + runUrl,
    "Main: " + head,
    "Sanitized durable boundary: " + JSON.stringify(machine),
  ]);
  process.exit(0);
}

if (mode === "autonomous-failure") {
  const failure = await loadJson(required("DNA_STATUS_RECEIPT_PATH"));
  const stage = String(failure.stage ?? "");
  const diagnostic = String(failure.diagnostic ?? "");
  if (
    !/^[a-z0-9_-]{1,160}$/u.test(stage) ||
    !/^[a-z0-9_-]{1,160}$/u.test(diagnostic)
  ) {
    throw new Error("DNA failure status is invalid");
  }

  const recovered = count(required("DNA_STATUS_RECOVERED_RACE_COUNT"));
  const unresolved = count(required("DNA_STATUS_UNRESOLVED_RACE_COUNT"));
  await update([
    "<!-- dna-population-status -->",
    "### DNA entrant population status",
    "State: **autonomous session failed closed**",
    "Last accepted starting boundary: **" +
      recovered.toLocaleString("en-US") +
      "** / " +
      unresolved.toLocaleString("en-US"),
    "Sanitized failure: " + stage + " / " + diagnostic,
    "Run: " + runUrl,
    "Main: " + head,
    "No completion beyond the starting boundary is claimed until read-only " +
      "recovery reopens durable state.",
  ]);
  process.exit(0);
}

throw new Error("DNA status mode is unsupported");
