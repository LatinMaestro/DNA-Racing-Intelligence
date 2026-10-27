import type { OwnerVaultCatalogueCore } from "@/lib/owner-vault-catalogue-service";

export function CoreSearchDatalist({
  cores,
  id,
}: Readonly<{
  cores: readonly OwnerVaultCatalogueCore[];
  id: string;
}>) {
  return (
    <datalist id={id}>
      {cores.flatMap((core) => {
        const idOption = (
          <option
            key={`${core.sourceCoreId}:id`}
            label={core.displayName}
            value={core.sourceCoreId}
          />
        );
        if (core.displayName === core.sourceCoreId) return [idOption];
        return [
          <option
            key={`${core.sourceCoreId}:name`}
            label={`Core ID ${core.sourceCoreId}`}
            value={core.displayName}
          />,
          idOption,
        ];
      })}
    </datalist>
  );
}
