import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getReinitialisationInfo } from "backend";

import { ReinitialisationForm } from "./ReinitialisationForm";

const RAPPEL_SYSTEM_START_DATE =
  "Pensez à régler SYSTEM_START_DATE sur la date de bascule en production avant la mise en production (.env en local ; docker-compose.raw.yml ou variable Dokploy en production) : le cron d'absences ignore tout ce qui est antérieur.";

/** Réinitialisation à usage unique avant mise en production — DG seul (`systeme.reinitialiser`). */
export default async function ReinitialisationPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "systeme.reinitialiser")) {
    redirect("/?error=acces_refuse_reinitialisation");
  }

  const info = await getReinitialisationInfo();

  if (info) {
    // Déjà exécutée : plus aucun bouton, uniquement le journal d'audit.
    const decompte = info.decompte as Record<string, number>;
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <PageHeader
          title="Réinitialisation effectuée"
          description="Cette opération est à usage unique et ne peut plus être relancée."
        />
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm">
          <p>
            Effectuée le <strong>{info.effectueeAt.toLocaleString("fr-FR")}</strong> par{" "}
            <strong>{info.effectueePar.fullName}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Empreinte de la sauvegarde : {info.sauvegardeSha256} — fichiers supprimés : {info.fichiersSupprimes}
            {info.fichiersEchecs > 0 ? ` (${info.fichiersEchecs} non supprimés, à nettoyer à la main)` : ""}.
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {Object.entries(decompte).map(([table, n]) => (
              <li key={table} className="flex justify-between border-b border-border py-0.5">
                <span>{table}</span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
          <p className="rounded-md bg-warning-bg px-3 py-2 text-warning">{RAPPEL_SYSTEM_START_DATE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Réinitialisation avant mise en production"
        description="Supprime définitivement les données de test de la Trésorerie et du Pointage RH / FeedbackApp. Usage unique."
      />
      <ReinitialisationForm />
    </div>
  );
}
