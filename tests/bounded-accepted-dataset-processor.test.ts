import { describe, expect, it, vi } from "vitest";

import {
  createBoundedAcceptedDatasetProcessor,
  type AcceptedDatasetPreparationRepository,
} from "@/lib/bounded-accepted-dataset-processor";

const fingerprint = "a".repeat(64);

function harness(
  result: Awaited<
    ReturnType<AcceptedDatasetPreparationRepository["prepareAcceptedDataset"]>
  > = {
    preparedResultId: "prepared-1",
    sourceVersionCount: 9,
    quarantinedRecordCount: 2,
    aggregateRefreshRequired: true,
  },
) {
  const repository: AcceptedDatasetPreparationRepository = {
    prepareAcceptedDataset: vi.fn(async () => result),
  };
  return {
    repository,
    processor: createBoundedAcceptedDatasetProcessor({
      repository,
      maximumSourceVersions: 24,
      maximumQuarantinedRecords: 1_000_000,
    }),
  };
}

const input = {
  ownerId: " owner-1 ",
  updateSessionId: " session-1 ",
  dispatchId: " dispatch-1 ",
  previewFingerprintSha256: fingerprint,
};

describe("bounded accepted dataset processor", () => {
  it("prepares the current nine-file shape through one bounded repository call", async () => {
    const test = harness();

    await expect(test.processor.prepare(input)).resolves.toEqual({
      preparedResultId: "prepared-1",
      sourceVersionCount: 9,
      quarantinedRecordCount: 2,
      aggregateRefreshRequired: true,
    });
    expect(test.repository.prepareAcceptedDataset).toHaveBeenCalledOnce();
    expect(test.repository.prepareAcceptedDataset).toHaveBeenCalledWith({
      ownerId: "owner-1",
      updateSessionId: "session-1",
      dispatchId: "dispatch-1",
      previewFingerprintSha256: fingerprint,
      maximumSourceVersions: 24,
    });
  });

  it("accepts the 24-file boundary", async () => {
    const test = harness({
      preparedResultId: "prepared-24",
      sourceVersionCount: 24,
      quarantinedRecordCount: 0,
      aggregateRefreshRequired: true,
    });

    await expect(test.processor.prepare(input)).resolves.toEqual(
      expect.objectContaining({ sourceVersionCount: 24 }),
    );
  });

  it("rejects a 25th source version before activation", async () => {
    const test = harness({
      preparedResultId: "prepared-25",
      sourceVersionCount: 25,
      quarantinedRecordCount: 0,
      aggregateRefreshRequired: true,
    });

    await expect(test.processor.prepare(input)).rejects.toThrow(
      "sourceVersionCount exceeds",
    );
  });

  it("fails closed on malformed identities and fingerprints", async () => {
    const test = harness();

    await expect(
      test.processor.prepare({ ...input, dispatchId: "../unsafe" }),
    ).rejects.toThrow("dispatchId is invalid");
    await expect(
      test.processor.prepare({
        ...input,
        previewFingerprintSha256: "not-a-sha",
      }),
    ).rejects.toThrow("previewFingerprintSha256 is invalid");
    expect(test.repository.prepareAcceptedDataset).not.toHaveBeenCalled();
  });

  it("rejects malformed or unbounded repository evidence", async () => {
    for (const result of [
      {
        preparedResultId: "prepared-1",
        sourceVersionCount: 0,
        quarantinedRecordCount: 0,
        aggregateRefreshRequired: false,
      },
      {
        preparedResultId: "prepared-1",
        sourceVersionCount: 1,
        quarantinedRecordCount: 1_000_001,
        aggregateRefreshRequired: true,
      },
      {
        preparedResultId: "prepared-1",
        sourceVersionCount: 1,
        quarantinedRecordCount: 0,
        aggregateRefreshRequired: "true" as unknown as boolean,
      },
    ]) {
      await expect(harness(result).processor.prepare(input)).rejects.toThrow();
    }
  });

  it("requires positive construction bounds", () => {
    const repository: AcceptedDatasetPreparationRepository = {
      prepareAcceptedDataset: vi.fn(),
    };
    expect(() =>
      createBoundedAcceptedDatasetProcessor({
        repository,
        maximumSourceVersions: 0,
        maximumQuarantinedRecords: 1,
      }),
    ).toThrow("maximumSourceVersions");
    expect(() =>
      createBoundedAcceptedDatasetProcessor({
        repository,
        maximumSourceVersions: 24,
        maximumQuarantinedRecords: 0,
      }),
    ).toThrow("maximumQuarantinedRecords");
  });
});
