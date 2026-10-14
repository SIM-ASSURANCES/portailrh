import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { PERMISSION_REINITIALISER_POINTAGE, getEtatReinitialisationPointage } from "backend";

import { ReinitialisationPointageForm } from "./ReinitialisationPointageForm";

export const metadata = { title: "Réinitialisation du Pointage - Administration" };
export const dynamic = "force-dynamic";

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "Africa/Abidjan" }).format(d);

/** Purge du Pointage seul avant sa mise en service — gardée par `pointage.reinitialiser` (jamais le contournement estAdmin). */
export default async function ReinitialisationPointagePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSION_REINITIALISER_POINTAGE)) {
    redirect("/?error=acces_refuse_reinitialisation_pointage");
  }

  const { miseEnService, purges } = await getEtatReinitialisationPointage();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {miseEnService ? (
        <PageHeader
          title="Pointage en service"
          description="Le Pointage est en service : sa purge est définitivement refusée. Seul l'audit reste consultable."
        />
      ) : (
        <PageHeader
          title="Réinitialisation du Pointage"
          description="Supprime les données de test du Pointage seul, avant sa mise en service. Répétable jusqu'à la mise en service."
        />
      )}

      {miseEnService ? (
        <p data-etat="en-service" className="rounded-md bg-success-bg px-3 py-3 text-sm text-success">
          Mis en service le <strong>{formatDate(miseEnService.misEnServiceAt)}</strong> par <strong>{miseEnService.par.fullName}</strong>.
        </p>
      ) : (
        <ReinitialisationPointageForm />
      )}

      <section className="space-y-3" data-section="audit">
        <h2 className="text-lg font-semibold text-foreground">Audit des purges</h2>
        {purges.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune purge du Pointage n&apos;a encore été effectuée.</p>
        ) : (
          <ul className="space-y-3">
            {purges.map((p) => {
              const decompte = p.decompte as Record<string, number>;
              const total = Object.values(decompte).reduce((a, b) => a + b, 0);
              return (
                <li key={p.id} data-purge={p.id} className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
                  <p>
                    <strong>{formatDate(p.effectueeAt)}</strong> par <strong>{p.effectueePar.fullName}</strong> — {total} ligne(s) supprimée(s).
                  </p>
                  <p className="break-all text-xs text-muted-foreground">Empreinte de la sauvegarde : {p.sauvegardeSha256}</p>
                  <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    {Object.entries(decompte).map(([table, n]) => (
                      <li key={table} className="flex justify-between border-b border-border py-0.5">
                        <span>{table}</span>
                        <span className="tabular-nums">{n}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
