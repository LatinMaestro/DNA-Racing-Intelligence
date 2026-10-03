"use client";

import { useState } from "react";

import { beginRaceMergeOutcomeSourceUploadAction } from "@/app/(private)/imports/actions";

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

export function RaceMergeSourceEvidenceUploader() {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [status, setStatus] = useState(
    "Select the eight owner-supplied Race Merge CSVs.",
  );
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (busy) return;
    if (files.length !== EXPECTED_FILE_COUNT) {
      setStatus("Exactly eight Race Merge CSVs are required for this source set.");
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
        setStatus(`Verifying source file ${index + 1} of ${EXPECTED_FILE_COUNT}…`);
        const digest = await sha256(file);
        const reservation = await beginRaceMergeOutcomeSourceUploadAction({
          ordinal: index + 1,
          originalFileName: file.name,
          byteLength: file.size,
          sha256: digest,
        });
        if (reservation.status !== "ready" || reservation.targets.length !== 1) {
          throw new Error("Private source reservation is unavailable.");
        }
        const target = reservation.targets[0];
        setStatus(`Uploading source file ${index + 1} of ${EXPECTED_FILE_COUNT}…`);
        const response = await fetch(target.targetToken, {
          method: target.method,
          headers: { "Content-Type": "text/csv" },
          body: file,
        });
        if (!response.ok) {
          throw new Error("Private source upload failed.");
        }
      }
      setStatus(
        "All eight source files are stored privately. Legacy import completion was deliberately not invoked.",
      );
    } catch {
      setStatus(
        "Source upload stopped safely. Completed files remain replay-safe; retry the same eight files.",
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
