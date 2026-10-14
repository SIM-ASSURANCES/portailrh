import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { RetourExterneForm } from "./RetourExterneForm";

export default async function RetoursExternesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_retour_externe")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const [utilisateurs, retours] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.retourExterne.findMany({
      include: {
        collaborateur: { select: { fullName: true } },
        creePar: { select: { fullName: true } },
        demande: { select: { id: true, reference: true } },
        ligneDemande: { select: { libelle: true } },
        pieceJointe: { select: { id: true } },
        pieceJointeCheque: { select: { id: true } },
      },
      orderBy: { creeAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Retour externe"
        description="Argent revenu en caisse suite à un règlement fait hors système (ex : chèque), ou retour d'un fonds versé par banque (à rattacher à la demande et à l'article). Enregistrement immédiat et définitif."
      />
      <RetourExterneForm utilisateurs={utilisateurs} />
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-foreground">Historique des retours externes</h2>
        {retours.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun retour externe enregistré.</p>
        ) : (
          <ul className="space-y-3">
            {retours.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
                <p className="font-semibold text-foreground">
                  {r.collaborateur?.fullName ?? `${r.nomExterne} (externe)`} —{" "}
                  {Number(r.montantRetourne).toLocaleString("fr-FR")} FCFA retournés
                </p>
                <p className="text-xs text-muted-foreground">
                  Chèque initial déclaré : {Number(r.montantChequeInitial).toLocaleString("fr-FR")} FCFA · {r.motif}
                </p>
                {r.demande ? (
                  <p className="text-xs text-foreground" data-retour-externe-rattache>
                    Rattaché à la demande{" "}
                    <a className="font-semibold underline" href={`/treso/finance/demandes/${r.demande.id}`}>
                      {r.demande.reference}
                    </a>
                    {r.ligneDemande ? <> · article « {r.ligneDemande.libelle} »</> : null} — compte comme retour reçu.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Par {r.creePar.fullName} le {r.creeAt.toLocaleDateString("fr-FR")} ·{" "}
                  {r.pieceJointeCheque ? (
                    <>
                      <a className="underline" href={`/api/treso/pieces-jointes/${r.pieceJointeCheque.id}`}>
                        Justificatif du chèque initial
                      </a>
                      {" · "}
                    </>
                  ) : null}
                  <a className="underline" href={`/api/treso/pieces-jointes/${r.pieceJointe.id}`}>
                    Justificatif du retour
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
