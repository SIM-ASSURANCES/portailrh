import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerServiceDuDemandeur, messageBlocageCreationDemande, prisma } from "backend";

import { DemandeForm } from "./DemandeForm";

export default async function NouvelleDemandePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_demande")) {
    redirect("/?error=acces_refuse_creer_demande");
  }
  const blocageService = messageBlocageCreationDemande(await chargerServiceDuDemandeur(prisma, session.user.id));
  // Champ « Bénéficiaire » : les autres comptes actifs du portail (« Moi-même » est proposé à part).
  const comptes = await prisma.user.findMany({
    where: { isActive: true, id: { not: session.user.id } },
    select: { id: true, fullName: true, service: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Nouvelle demande d'achat"
        description="Détaillez les articles et le motif de chacun, puis complétez l'en-tête de la demande."
      />
      {blocageService ? (
        <p role="alert" className="rounded-md bg-warning-bg px-4 py-3 text-sm text-warning">
          {blocageService}
        </p>
      ) : (
        <DemandeForm
          comptes={comptes.map((c) => ({ value: c.id, label: c.service ? `${c.fullName} — ${c.service.name}` : c.fullName }))}
        />
      )}
    </div>
  );
}
