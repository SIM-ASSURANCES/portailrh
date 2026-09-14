import Link from "next/link";

import { Badge } from "@/components/ui";
import type { AlimentationCaisseEntry } from "backend";

/**
 * Historique des alimentations de caisse (voir CLAUDE.md "Nouvelle
 * alimentation de caisse") — Server Component autonome, purement en
 * lecture, même esprit que `SoldeOuvertureHistorique.tsx` mais un cycle
 * indépendant (une alimentation est répétable, contrairement au solde
 * d'ouverture). Déjà trié du plus récent au plus ancien par
 * `getAlimentationsCaisseHistorique` — jamais retrié ici.
 */
export function AlimentationsCaisseHistorique({ entries }: { entries: AlimentationCaisseEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Historique des alimentations de caisse</h2>
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="info">Alimentation</Badge>
              <span className="text-xs text-muted-foreground">
                Opération du {new Date(entry.dateOperation).toLocaleDateString("fr-FR")} — saisie le{" "}
                {new Date(entry.enregistreLe).toLocaleString("fr-FR")} — {entry.auteurNom}
              </span>
            </div>
            <p className="mt-2 tabular-nums text-foreground">
              <span className="font-semibold">{entry.montant.toLocaleString("fr-FR")} FCFA</span>
            </p>
            <Link
              href={`/api/treso/pieces-jointes/${entry.pieceJointe.id}`}
              className="mt-1 inline-block text-xs font-medium text-info underline-offset-4 hover:underline"
            >
              Télécharger la pièce jointe
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
