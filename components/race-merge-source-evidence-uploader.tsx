"use client";

import { useState } from "react";

import {
  beginRaceMergeOutcomeSourceUploadAction,
  type RaceMergeSourceUploadFailureCode,
} from "@/app/(private)/imports/actions";

const EXPECTED_FILE_COUNT = 8;
const MAXIMUM_FILE_BYTES = 100_000_000;
const MAXIMUM_TOTAL_BYTES = 600_000_000;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256(file: File): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
}

function serverFailureText(code: RaceMergeSourceUploadFailureCode): string {
  switch (code) {
    case "capacity_r2_analytics_transport_failed":
      return "the server could not reach Cloudflare R2 analytics";
    case "capacity_r2_analytics_http_rejected":
      return "Cloudflare rejected the R2 analytics capacity request";
    case "capacity_r2_analytics_response_invalid":
      return "Cloudflare returned an unusable R2 analytics capacity response";
    case "capacity_r2_operations_transport_failed":
      return "the server could not reach Cloudflare R2 operations analytics";
    case "capacity_r2_operations_http_rejected":
      return "Cloudflare rejected the R2 operations analytics request";
    case "capacity_r2_operations_response_invalid":
      return "Cloudflare returned an unusable R2 operations analytics response";
    case "capacity_r2_storage_transport_failed":
      return "the server could not reach Cloudflare R2 storage analytics";
    case "capacity_r2_storage_http_rejected":
      return "Cloudflare rejected the R2 storage analytics request";
    case "capacity_r2_storage_response_invalid":
      return "Cloudflare returned an unusable R2 storage analytics response";
    case "capacity_queue_metrics_transport_failed":
      return "the server could not reach Cloudflare Queue metrics";
    case "capacity_queue_metrics_http_rejected":
      return "Cloudflare rejected the Queue metrics capacity request";
    case "capacity_queue_metrics_response_invalid":
      return "Cloudflare returned an unusable Queue metrics response";
    case "capacity_neon_storage_failed":
      return "the Neon runtime storage measurement failed";
    case "capacity_evidence_invalid":
      return "the provider-capacity evidence was stale, incomplete, or invalid";
    case "capacity_limit_r2_storage_bytes":
      return "the guarded R2 storage ceiling would be exceeded";
    case "capacity_limit_r2_class_a_operations":
      return "the guarded R2 Class A operation ceiling would be exceeded";
    case "capacity_limit_r2_class_b_operations":
      return "the guarded R2 Class B operation ceiling would be exceeded";
    case "capacity_limit_neon_storage_bytes":
      return "the guarded Neon storage ceiling would be exceeded";
    case "capacity_limit_queue_backlog_messages":
      return "the guarded Queue backlog ceiling would be exceeded";
    case "owner_authentication_unavailable":
      return "owner authentication could not be verified";
    case "owner_access_denied":
      return "the signed-in identity is not the configured owner";
    case "reservation_inconsistent":
      return "the private upload reservation replay did not match";
    case "target_creation_failed":
      return "the private R2 upload target could not be created";
    case "unexpected_server_failure":
      return "an unexpected server-side upload preparation failure occurred";
  }
}

function retrySuffix(): string {
  return "Completed files remain replay-safe; retry the same eight files after the reported issue is fixed.";
}

export function RaceMergeSourceEvidenceUploader() {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [status, setStatus] = useState(
    "Select the eight owner-supplied Race Merge CSVs.",
  );
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (busy) return;
    if (files.length !== EXPECTED_FILE_COUNT) {
      setStatus(
        "Exactly eight Race Merge CSVs are required for this source set.",
      );
      return;
    }
    const ordered = [...files].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const totalBytes = ordered.reduce((total, file) => total + file.size, 0);
    if (
      ordered.some(
        (file) =>
          !file.name.toLowerCase().endsWith(".csv") ||
          file.size < 1 ||
          file.size > MAXIMUM_FILE_BYTES,
      ) ||
      totalBytes > MAXIMUM_TOTAL_BYTES
    ) {
      setStatus("The selected source set is outside its bounded CSV limits.");
      return;
    }

    setBusy(true);
    try {
      for (const [index, file] of ordered.entries()) {
        const ordinal = index + 1;
        setStatus(
          `Verifying source file ${ordinal} of ${EXPECTED_FILE_COUNT}…`,
        );

        let digest: string;
        try {
          digest = await sha256(file);
        } catch {
          setStatus(
            `Stopped at source file ${ordinal}: the browser could not calculate the local SHA-256 [local_sha256_failed]. ${retrySuffix()}`,
          );
          return;
        }

        let reservation: Awaited<
          ReturnType<typeof beginRaceMergeOutcomeSourceUploadAction>
        >;
        try {
          reservation = await beginRaceMergeOutcomeSourceUploadAction({
            ordinal,
            originalFileName: file.name,
            byteLength: file.size,
            sha256: digest,
          });
        } catch {
          setStatus(
            `Stopped before source file ${ordinal} reservation: the browser could not complete the private server action [server_action_transport_failed]. ${retrySuffix()}`,
          );
          return;
        }

        if (reservation.status === "failed") {
          setStatus(
            `Stopped before source file ${ordinal} reservation: ${serverFailureText(reservation.errorCode)} [${reservation.errorCode}]. ${retrySuffix()}`,
          );
          return;
        }
        if (reservation.status === "identity_not_connected") {
          setStatus(
            `Stopped before source file ${ordinal} reservation: owner identity is not connected [owner_identity_not_connected]. ${retrySuffix()}`,
          );
          return;
        }
        if (reservation.status === "not_configured") {
          setStatus(
            `Stopped before source file ${ordinal} reservation: private upload intake is not configured [upload_intake_not_configured]. ${retrySuffix()}`,
          );
          return;
        }
        if (reservation.targets.length !== 1) {
          setStatus(
            `Stopped before source file ${ordinal} upload: the private reservation returned an unexpected target count [upload_target_count_invalid]. ${retrySuffix()}`,
          );
          return;
        }

        const target = reservation.targets[0];
        if (target === undefined) {
          setStatus(
            `Stopped before source file ${ordinal} upload: the private upload target disappeared [upload_target_missing]. ${retrySuffix()}`,
          );
          return;
        }

        setStatus(
          `Uploading source file ${ordinal} of ${EXPECTED_FILE_COUNT}…`,
        );
        let response: Response;
        try {
          response = await fetch(target.targetToken, {
            method: target.method,
            headers: { "Content-Type": "text/csv" },
            body: file,
          });
        } catch {
          setStatus(
            `Stopped while uploading source file ${ordinal}: the browser could not reach the private R2 upload target [r2_put_network_failed]. ${retrySuffix()}`,
          );
          return;
        }
        if (!response.ok) {
          setStatus(
            `Stopped while uploading source file ${ordinal}: private R2 rejected the upload with HTTP ${response.status} [r2_put_http_rejected]. ${retrySuffix()}`,
          );
          return;
        }
      }

      setStatus(
        "All eight source files are stored privately. Legacy import completion was deliberately not invoked.",
      );
    } catch {
      setStatus(
        `Source upload stopped because of an unexpected browser failure [unexpected_client_failure]. ${retrySuffix()}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="race-merge-source-evidence"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <h2 className="text-lg font-semibold" id="race-merge-source-evidence">
        Race Merge outcome evidence
      </h2>
      <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
        Stores the current eight historical Race Merge CSVs directly in the
        private R2 quarantine. Each file is capacity-checked separately. This
        evidence-only path does not complete the legacy import or enqueue its
        historical processor.
      </p>
      <input
        accept=".csv,text/csv"
        className="mt-5 block text-sm"
        disabled={busy}
        multiple
        onChange={(event) => {
          setFiles(Array.from(event.currentTarget.files ?? []));
          setStatus("Source files selected; no upload has started.");
        }}
        type="file"
      />
      <button
        className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy || files.length !== EXPECTED_FILE_COUNT}
        onClick={() => void upload()}
        type="button"
      >
        {busy ? "Uploading…" : "Upload historical outcome evidence"}
      </button>
      <p aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">
        {status}
      </p>
    </section>
  );
}
