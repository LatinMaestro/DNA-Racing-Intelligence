import { ProLeagueWorkspace } from "@/components/pro-league-workspace";
import { auditProLeagueRoster } from "@/domain/pro-league-roster";

export const dynamic = "force-dynamic";

export default function ProLeaguePage() {
  return <ProLeagueWorkspace audit={auditProLeagueRoster([])} />;
}
