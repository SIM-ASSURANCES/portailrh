import LogsList from "@/components/logs/LogsList";
import { PageHeader } from "@/components/ui/PageHeader";
import { redirect } from "next/navigation";
import { getSession, isAdmin } from "@/lib/auth";

export const metadata = {
  title: "Logs Système - RH",
};

export default async function RHLogsPage() {
  const session = await getSession();
  
  // Seul l'administrateur peut consulter les logs système
  if (!session || !isAdmin(session)) {
    redirect("/pointage/rh?error=acces_refuse");
  }

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
