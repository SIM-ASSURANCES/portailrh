import { prisma } from "@/lib/prisma";

/**
 * Libellés lisibles pour les actions déjà connues. Volontairement non
 * exhaustif : toute action historisée sans entrée ici (règlement, retour de
 * caisse... à venir dans de prochains tickets) s'affiche simplement avec sa
 * valeur brute — ce composant n'a jamais besoin d'être modifié pour
 * accueillir un nouveau type d'évènement.
 */
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Création de la demande",
  CATEGORISER: "Catégorisation",
  validation: "Validation",
  validation_complementaire: "Validation complémentaire",
  rejet: "Rejet",
  reglement: "Règlement",
  annulation_reglement: "Annulation de règlement",
  declaration_retour: "Retour de caisse déclaré",
  modification_retour: "Retour de caisse modifié",
  reception_retour: "Retour de caisse réceptionné",
  cloture_totale: "Clôture totale",
  cloture_partielle: "Clôture partielle",
  validation_complete_dg: "Validation complète approuvée par le DG",
};

function labelForAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Historique générique d'une Demande, basé sur `HistoriqueEntry`
 * (`entity: "Demande"`). Server Component autonome : ne prend que l'id de
 * la demande, effectue lui-même la requête — s'utilise depuis n'importe
 * quelle page qui affiche une demande, pas seulement l'écran Finance.
 *
 * Exemple :
 *   <DemandeHistorique demandeId={demande.id} />
 */
export async function DemandeHistorique({ demandeId }: { demandeId: string }) {
  const entries = await prisma.historiqueEntry.findMany({
    where: { entity: "Demande", entityId: demandeId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Historique</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun évènement enregistré pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="font-medium text-foreground">{labelForAction(entry.action)}</p>
              <p className="text-xs text-muted-foreground">
                {entry.user.fullName} — {entry.createdAt.toLocaleString("fr-FR")}
              </p>
              {entry.detail ? <p className="mt-1 text-foreground">{entry.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
