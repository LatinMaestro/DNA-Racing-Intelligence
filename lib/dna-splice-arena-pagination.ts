export type DnaSpliceArenaPaginationSignal = Readonly<{
  hasMore: boolean;
  rowCount: number;
  pageSizeLimit: number;
}>;

function paginationError(message: string): never {
  throw new Error(`DNA Splice Arena pagination: ${message}`);
}

/**
 * DNA Open Lab currently under-reports `has_more` on full Arena pages. A full
 * page therefore remains non-terminal even when `has_more` is false. This
 * intentionally probes one additional page when the total listing count is an
 * exact multiple of the provider page size; an empty/short page then proves
 * terminal coverage.
 */
export function dnaSpliceArenaNeedsContinuation(
  input: DnaSpliceArenaPaginationSignal,
): boolean {
  if (typeof input.hasMore !== "boolean") {
    paginationError("hasMore must be boolean");
  }
  if (
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0 ||
    !Number.isSafeInteger(input.pageSizeLimit) ||
    input.pageSizeLimit < 1 ||
    input.rowCount > input.pageSizeLimit
  ) {
    paginationError("row count or page size limit is invalid");
  }
  return input.hasMore || input.rowCount === input.pageSizeLimit;
}

export function dnaSpliceArenaIsTerminal(
  input: DnaSpliceArenaPaginationSignal,
): boolean {
  return !dnaSpliceArenaNeedsContinuation(input);
}
