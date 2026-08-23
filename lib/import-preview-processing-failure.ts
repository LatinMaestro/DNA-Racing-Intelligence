export const importPreviewProcessingFailureReasons = [
  "preview_processor_failed",
  "preview_object_store_failed",
  "preview_object_integrity_failed",
  "preview_staging_begin_failed",
  "preview_staging_write_failed",
  "preview_staging_commit_failed",
  "preview_finalization_failed",
] as const;

export type ImportPreviewProcessingFailureReason =
  (typeof importPreviewProcessingFailureReasons)[number];

export class ImportPreviewProcessingFailure extends Error {
  readonly reason: ImportPreviewProcessingFailureReason;

  constructor(reason: ImportPreviewProcessingFailureReason) {
    super(`Private import preview failed: ${reason}`);
    this.name = "ImportPreviewProcessingFailure";
    this.reason = reason;
  }
}
