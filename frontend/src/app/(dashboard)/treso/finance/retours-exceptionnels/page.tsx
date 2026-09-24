import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

/**
 * Retours exceptionnels post-clôture EN ATTENTE DE VALIDATION (voir CLAUDE.md
 * "Retour de caisse exceptionnel post-clôture") — cible de l'indicateur du
 * dashboard Finance. La décision se prend sur la demande elle-même (Responsable
 * Finance uniquement) : cette liste ne fait que l'y mener.
 */
export default async function RetoursExceptionnelsPage() {
  const session = await getSession();
  if (
    !session ||
    !(
      hasPermission(session, "treso.valider_demande") ||
      hasPermission(session, "treso.receptionner_retour") ||
      hasPermission(session, "treso.effectuer_reglement")
    )
  ) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const retours = await prisma.retourExceptionnel.findMany({
    where: { statut: "EN_ATTENTE_VALIDATION" },
    include: { demande: { select: { id: true, reference: true } }, saisiPar: true },
    orderBy: { saisiAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Retours exceptionnels en attente de validation"
        description="Retours de caisse saisis sur des demandes déjà clôturées, à valider par le Responsable Finance."
      />
      {retours.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun retour exceptionnel en attente.</p>
      ) : (
        <ul className="space-y-3">
          {retours.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="text-sm">
                <p className="font-semibold text-foreground">
                  {r.demande.reference} — {Number(r.montant).toLocaleString("fr-FR")} FCFA
                </p>
                <p className="text-xs text-muted-foreground">
                  Saisi par {r.saisiPar.fullName} le {r.saisiAt.toLocaleDateString("fr-FR")} — {r.motif}
                </p>
              </div>
              <Link href={`/treso/finance/demandes/${r.demande.id}`}>
                <Button variant="secondary">Voir la demande</Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
