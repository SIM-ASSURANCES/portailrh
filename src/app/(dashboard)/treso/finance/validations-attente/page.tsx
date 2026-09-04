import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ValidationsAttenteTable } from "./ValidationsAttenteTable";

/**
 * "Validations complètes en attente" — demandes ayant un montant validé
 * mais pas encore approuvées par le DG (`validationCompleteParDG = false`),
 * préalable obligatoire à la clôture depuis le "Verrou de clôture"
 * (Ticket 7, voir CLAUDE.md). Même définition exacte que
 * `getValidationsCompletesEnAttente` (`dashboardFinance.ts`), cible de
 * l'indicateur du dashboard Finance réservé au DG.
 *
 * **Corrige un manque identifié après coup** : la Server Action
 * d'approbation (`approuverValidationCompleteAction`) et son affichage sur
 * le détail d'une demande existaient déjà, mais aucun moyen de
 * DÉCOUVRIR quelles demandes attendent cette approbation — voir CLAUDE.md
 * "Découverte des validations complètes en attente (DG)".
 *
 * Réservée à `treso.approuver_validation_complete` précisément (DG dans le
 * seed actuel) — distincte de la garde générique du layout Finance partagé,
 * jamais supposée acquise du simple fait d'y avoir accès.
 */
export default async function ValidationsAttentePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    redirect("/?error=acces_refuse_validations_attente");
  }

  const demandes = await prisma.demande.findMany({
    where: { montantValide: { gt: 0 }, validationCompleteParDG: false },
    select: {
      id: true,
      reference: true,
      montantValide: true,
      statut: true,
      beneficiaireNom: true,
      beneficiaireUser: { select: { fullName: true } },
    },
  });

  // Date de la dernière validation (initiale ou complémentaire) — jamais
  // `validation_complete_dg` (l'approbation elle-même, un évènement
  // différent) ni `demande.updatedAt` (touché aussi par d'autres actions,
  // ex: un règlement, donc pas fiable pour cette colonne précise).
  const historique = await prisma.historiqueEntry.findMany({
    where: {
      entity: "Demande",
      entityId: { in: demandes.map((d) => d.id) },
      action: { in: ["validation", "validation_complementaire"] },
    },
    select: { entityId: true, createdAt: true },
  });
  const derniereValidationParDemande = new Map<string, Date>();
  for (const entry of historique) {
    const courante = derniereValidationParDemande.get(entry.entityId);
    if (!courante || entry.createdAt > courante) {
      derniereValidationParDemande.set(entry.entityId, entry.createdAt);
    }
  }

  const rows = demandes
    .map((d) => ({
      id: d.id,
      reference: d.reference,
      beneficiaire: getBeneficiaireNom({
        beneficiaireUser: d.beneficiaireUser,
        beneficiaireNom: d.beneficiaireNom,
      }),
      montantValide: Number(d.montantValide),
      statut: d.statut,
      derniereValidation: derniereValidationParDemande.get(d.id) ?? null,
    }))
    .sort((a, b) => {
      const aTime = a.derniereValidation?.getTime() ?? 0;
      const bTime = b.derniereValidation?.getTime() ?? 0;
      return aTime - bTime;
    });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Validations complètes en attente"
        description="Demandes ayant un montant validé, en attente de l'approbation du DG préalable à leur clôture. Triées par ancienneté : les plus anciennes en premier."
      />
      <ValidationsAttenteTable demandes={rows} />
    </div>
  );
}
