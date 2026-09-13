import { PageHeader } from "@/components/ui";
import { DEMANDES_EN_ATTENTE_VALIDATION_WHERE, getBeneficiaireNom } from "backend";
import { prisma } from "backend";

import { DemandesACategoriserTable } from "./DemandesACategoriserTable";

/**
 * "Demandes en attente de validation" — cible de l'indicateur #1 de la
 * zone "À traiter" du dashboard Finance (Phase G, cahier des charges
 * section 12). Utilise `DEMANDES_EN_ATTENTE_VALIDATION_WHERE`
 * (`tresorerie.ts`), jamais un filtre dupliqué ici — pour que ce chiffre
 * du dashboard et cette liste désignent toujours exactement le même
 * ensemble de lignes (même principe que `RETOUR_EN_ATTENTE_WHERE`).
 * Inclut `EN_ATTENTE_VALIDATION` (rien validé) ET `PARTIELLEMENT_VALIDEE`
 * (un reliquat non validé subsiste), à l'EXCLUSION d'un reliquat déjà
 * explicitement rejeté (`reliquatRejete: true`, voir "Rejet du reliquat
 * non validé") : cette demande n'a plus aucune action de validation
 * possible dessus, elle ne doit donc plus apparaître ici (bug corrigé).
 */
export default async function FinanceDemandesPage() {
  const rawDemandes = await prisma.demande.findMany({
    where: DEMANDES_EN_ATTENTE_VALIDATION_WHERE,
    include: { createur: true, beneficiaireUser: true },
    orderBy: { createdAt: "asc" },
  });

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    createurNom: d.createur.fullName,
    beneficiaireNom: getBeneficiaireNom(d),
    montant: Number(d.montant),
    description: d.description,
    createdAt: d.createdAt,
    statut: d.statut,
    typeDemande: d.typeDemande,
    natureDepenseDirecte: d.natureDepenseDirecte,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes en attente de validation"
        description="Demandes non validées ou partiellement validées, triées par ancienneté : les plus anciennes en premier."
      />
      <DemandesACategoriserTable demandes={demandes} />
    </div>
  );
}
