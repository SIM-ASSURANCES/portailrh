import Link from "next/link";

import { Badge } from "@/components/ui";
import type { SoldeOuvertureHistoriqueEntry } from "backend";

/**
 * Historique complet des définitions/corrections du solde d'ouverture
 * (voir CLAUDE.md "Pièce jointe obligatoire sur le solde d'ouverture") —
 * Server Component autonome, purement en lecture (même esprit que
 * `DemandeHistorique.tsx` pour une demande). Affiché même à une seule
 * entrée (la définition initiale) : jamais seulement la dernière valeur
 * comme avant cette tâche.
 */
export function SoldeOuvertureHistorique({ entries }: { entries: SoldeOuvertureHistoriqueEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  // Plus récent en premier — même convention que DemandeHistorique pour
  // la lecture d'un journal d'évènements.
  const entriesRecentesDabord = [...entries].reverse();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Historique</h2>
      <ul className="space-y-3">
        {entriesRecentesDabord.map((entry) => (
          <li key={entry.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={entry.type === "definition" ? "info" : "warning"}>
                {entry.type === "definition" ? "Définition initiale" : "Correction"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString("fr-FR")} — {entry.auteurNom}
              </span>
            </div>
            <p className="mt-2 tabular-nums text-foreground">
              {entry.ancienMontant != null ? (
                <>
                  {entry.ancienMontant.toLocaleString("fr-FR")} FCFA{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                </>
              ) : null}
              <span className="font-semibold">{entry.nouveauMontant.toLocaleString("fr-FR")} FCFA</span>
            </p>
            {entry.pieceJointe ? (
              <Link
                href={`/api/treso/pieces-jointes/${entry.pieceJointe.id}`}
                className="mt-1 inline-block text-xs font-medium text-info underline-offset-4 hover:underline"
              >
                Télécharger la pièce jointe
              </Link>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Aucune pièce jointe (antérieure à cette exigence).</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
