import { ImportWorkspacePanel } from "@/components/import-workspace";
import { buildImportWorkspace } from "@/domain/import-workflow";

export default function ImportsPage() {
  const workspace = buildImportWorkspace([], new Date(0));
  return <ImportWorkspacePanel workspace={workspace} />;
}
