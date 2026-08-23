import type {
  DatasetEvidenceManifestRegistrationReceipt,
  DatasetEvidenceManifestRegistrationService,
} from "./dataset-evidence-manifest-registration-service";
import type {
  PrivateDatasetEvidenceObjectRecoveryReceipt,
  StoredPrivateDatasetEvidenceObject,
} from "./private-dataset-evidence-object-writer";

export type DatasetEvidenceCommitCoordinatorResult<Committed> = Readonly<{
  committed: Committed;
  manifests: readonly DatasetEvidenceManifestRegistrationReceipt[];
}>;

export type DatasetEvidenceCommitCoordinator = Readonly<{
  commitAndRegister: <Committed>(input: {
    stored: readonly StoredPrivateDatasetEvidenceObject[];
    commit: () => Committed | Promise<Committed>;
  }) => Promise<DatasetEvidenceCommitCoordinatorResult<Committed>>;
}>;

export function createDatasetEvidenceCommitCoordinator(input: {
  registrationService: DatasetEvidenceManifestRegistrationService;
  recovery: Readonly<{
    cleanup: (
      stored: readonly StoredPrivateDatasetEvidenceObject[],
    ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>;
  }>;
}): DatasetEvidenceCommitCoordinator {
  return Object.freeze({
    async commitAndRegister<Committed>(commitInput: {
      stored: readonly StoredPrivateDatasetEvidenceObject[];
      commit: () => Committed | Promise<Committed>;
    }): Promise<DatasetEvidenceCommitCoordinatorResult<Committed>> {
      const stored = [...commitInput.stored];
      const newlyCreated = stored.filter(
        ({ storageStatus }) => storageStatus === "created",
      );
      let committed: Committed;

      try {
        input.registrationService.validate(stored);
        committed = await commitInput.commit();
      } catch (commitError) {
        if (newlyCreated.length === 0) throw commitError;
        try {
          await input.recovery.cleanup(newlyCreated);
        } catch (recoveryError) {
          throw new AggregateError(
            [commitError, recoveryError],
            "Dataset evidence commit failed and pre-commit recovery was incomplete.",
          );
        }
        throw commitError;
      }

      const manifests = await input.registrationService.register(stored);
      return { committed, manifests };
    },
  });
}
