import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";

import { DemandeForm } from "./DemandeForm";

export default async function NouvelleDemandePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_demande")) {
    redirect("/?error=acces_refuse_creer_demande");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Nouvelle demande"
        description="Décrivez votre besoin : l'équipe Finance la catégorisera après validation."
      />
      <DemandeForm />
    </div>
  );
}
