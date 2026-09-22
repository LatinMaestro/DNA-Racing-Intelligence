export type PreviewEnvironmentVisibility = "config" | "secret";

export type PreviewEnvironmentEntry = Readonly<{
  name: string;
  value: string;
  visibility: PreviewEnvironmentVisibility;
}>;

export type PreviewEnvironmentRunner = (
  command: string,
  arguments_: string[],
  options: Readonly<{
    input: string;
    encoding: "utf8";
    maxBuffer: number;
  }>,
) => Readonly<{
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: Error;
}>;

export function previewEnvironmentSpecification(
  environment: Readonly<Record<string, string | undefined>>,
): PreviewEnvironmentEntry[];

export function syncPreviewEnvironment(
  options?: Readonly<{
    environment?: Readonly<Record<string, string | undefined>>;
    runner?: PreviewEnvironmentRunner;
  }>,
): Array<
  Readonly<{
    name: string;
    visibility: PreviewEnvironmentVisibility;
  }>
>;
