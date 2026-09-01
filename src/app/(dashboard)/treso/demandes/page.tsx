import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, PageHeader, ToastOnMount } from "@/components/ui";
import { getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { MesDemandesTable } from "./MesDemandesTable";

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
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();

  if (
    !session ||
    !(hasPermission(session, "treso.creer_demande") || hasPermission(session, "treso.declarer_retour"))
  ) {
    redirect("/?error=acces_refuse_demandes");
  }

  const rawDemandes = await prisma.demande.findMany({
    where: { createurId: session.user.id },
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
        description="Historique de vos demandes de dépense."
        actions={
          canCreate ? (
            <Link href="/treso/demandes/nouvelle">
              <Button>Nouvelle demande</Button>
            </Link>
          ) : undefined
        }
      />
      <MesDemandesTable demandes={demandes} />
    </div>
  );
}
