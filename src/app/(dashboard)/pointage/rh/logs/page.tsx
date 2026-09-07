import LogsList from "@/components/logs/LogsList";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = {
  title: "Logs Système - RH",
};

export default function RHLogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Logs Système" 
        description="Traçabilité des actions effectuées sur le portail."
      />
      <LogsList />
    </div>
  );
}
