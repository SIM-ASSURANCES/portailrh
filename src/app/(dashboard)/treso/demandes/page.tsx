import Link from "next/link";

import { Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { MesDemandesTable } from "./MesDemandesTable";

export default async function MesDemandesPage() {
  const session = await getSession();

  const rawDemandes = session
    ? await prisma.demande.findMany({
        where: { createurId: session.user.id },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    description: d.description,
    montant: Number(d.montant),
    statut: d.statut,
    createdAt: d.createdAt,
  }));

  const canCreate = hasPermission(session, "treso.creer_demande");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
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
