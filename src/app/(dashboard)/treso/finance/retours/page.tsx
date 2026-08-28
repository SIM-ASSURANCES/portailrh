import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { RetoursEnAttenteTable } from "./RetoursEnAttenteTable";

/**
 * "Retours en attente" — tous les `RetourCaisse` non encore réceptionnés,
 * tous collaborateurs confondus, triés par ancienneté croissante (même
 * convention que `finance/demandes` : les plus anciens en premier).
 * Distincte de la garde générique de `finance/layout.tsx` (qui accepte
 * categoriser_demande OU valider_demande OU receptionner_retour) : cette
 * page exige précisément `treso.receptionner_retour`, jamais supposée
 * acquise du simple fait d'avoir passé le layout.
 */
export default async function RetoursEnAttentePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    redirect("/?error=acces_refuse_receptionner_retour");
  }

  const rawRetours = await prisma.retourCaisse.findMany({
    where: { estReceptionne: false },
    include: {
      declarant: true,
      reglement: { include: { demande: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const retours = rawRetours.map((r) => ({
    id: r.id,
    demandeReference: r.reglement.demande.reference,
    declarantNom: r.declarant.fullName,
    reglementMontant: Number(r.reglement.montant),
    reglementMode: r.reglement.mode,
    montantDepense: Number(r.montantDepense),
    montantARetourner: Number(r.montantARetourner),
    justification: r.justification,
    commentaire: r.commentaire,
    createdAt: r.createdAt,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Retours en attente"
        description="Retours de caisse déclarés par les collaborateurs, en attente de réception. Triés par ancienneté : les plus anciens en premier."
      />
      <RetoursEnAttenteTable retours={retours} />
    </div>
  );
}
