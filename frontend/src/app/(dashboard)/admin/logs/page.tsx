import LogsList from "@/components/logs/LogsList";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLogsAction } from "@/app/(dashboard)/logs/actions";

export const metadata = {
  title: "Logs Système - Administration",
};

export default async function AdminLogsPage() {
  const { logs, totalCount } = await getLogsAction(0, 50);

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Logs Système" 
        description="Traçabilité complète des actions effectuées sur le portail."
      />
      <LogsList initialLogs={logs} initialTotalCount={totalCount} />
    </div>
  );
}
