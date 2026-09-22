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

export type PreviewEnvironmentFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function previewEnvironmentSpecification(
  environment: Readonly<Record<string, string | undefined>>,
): PreviewEnvironmentEntry[];

export function syncPreviewEnvironment(
  options?: Readonly<{
    environment?: Readonly<Record<string, string | undefined>>;
    runner?: PreviewEnvironmentRunner;
    fetcher?: PreviewEnvironmentFetcher;
    validateOnly?: boolean;
  }>,
): Promise<
  Array<
    Readonly<{
      name: string;
      visibility?: PreviewEnvironmentVisibility;
      source?: "existing-production-binding";
    }>
  >
>;
