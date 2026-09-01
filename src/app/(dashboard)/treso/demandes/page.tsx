import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, PageHeader, ToastOnMount } from "@/components/ui";
import { getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { StatutDemande } from "@/generated/prisma/client";

import { MesDemandesTable } from "./MesDemandesTable";

const STATUTS_CONNUS = Object.keys(STATUT_DEMANDE_LABEL) as StatutDemande[];

/**
 * Parse `?statut=A,B` en liste de `StatutDemande` valides — whitelist
 * stricte (même principe que `parseReportingFilters`, `reporting.ts`) :
 * une valeur inconnue ou vide est ignorée plutôt que de faire planter la
 * requête Prisma (`in: [...]` sur un enum invalide lèverait une erreur).
 * Utilisé par "Mon tableau de bord" pour lier sa carte "Mes demandes en
 * attente de validation" à une vue pré-filtrée de cette liste.
 */
function parseStatutFilter(raw: string | undefined): StatutDemande[] {
  if (!raw) return [];
  return raw.split(",").filter((s): s is StatutDemande => STATUTS_CONNUS.includes(s as StatutDemande));
}

/**
 * Écran de l'espace Collaborateur (créer/suivre ses propres demandes,
 * déclarer un retour de caisse) — jamais uniquement masqué côté nav
 * (`canAccesDemandes`, voir nav.ts), toujours revérifié ici, même principe
 * de défense en profondeur que le reste du module (audit habilitations,
 * voir CLAUDE.md).
 */
export default async function MesDemandesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; statut?: string }>;
}) {
  const { error, statut } = await searchParams;
  const session = await getSession();

  if (
    !session ||
    !(hasPermission(session, "treso.creer_demande") || hasPermission(session, "treso.declarer_retour"))
  ) {
    redirect("/?error=acces_refuse_demandes");
  }

  const statutsFiltre = parseStatutFilter(statut);

  const rawDemandes = await prisma.demande.findMany({
    where: {
      createurId: session.user.id,
      ...(statutsFiltre.length > 0 ? { statut: { in: statutsFiltre } } : {}),
    },
    include: { beneficiaireUser: true },
    orderBy: { createdAt: "desc" },
  });

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    description: d.description,
    montant: Number(d.montant),
    devise: d.devise,
    statut: d.statut,
    createdAt: d.createdAt,
    typeDemande: d.typeDemande,
    natureDepenseDirecte: d.natureDepenseDirecte,
    beneficiaireNom: getBeneficiaireNom(d),
  }));

  const canCreate = hasPermission(session, "treso.creer_demande");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {error === "acces_refuse_demande" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas accès à cette demande : elle appartient à un autre collaborateur."
        />
      ) : null}
      <PageHeader
        title="Mes demandes"
        description={
          statutsFiltre.length > 0
            ? `Filtré : ${statutsFiltre.map((s) => STATUT_DEMANDE_LABEL[s]).join(", ")}.`
            : "Historique de vos demandes de dépense."
        }
        actions={
          canCreate ? (
            <Link href="/treso/demandes/nouvelle">
              <Button>Nouvelle demande</Button>
            </Link>
          ) : undefined
        }
      />
      {statutsFiltre.length > 0 ? (
        <Link
          href="/treso/demandes"
          className="inline-block text-sm font-medium text-info underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          Voir toutes mes demandes
        </Link>
      ) : null}
      <MesDemandesTable demandes={demandes} />
    </div>
  );
}
