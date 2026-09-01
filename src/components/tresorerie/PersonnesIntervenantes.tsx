import { prisma } from "@/lib/prisma";

/**
 * "Personnes intervenantes" (section 10 du cahier des charges, clôture) —
 * qui est intervenu sur cette demande, en complément des montants déjà
 * affichés par `RegularisationSummary`. Server Component autonome (ne
 * prend que l'id de la demande) : ne réutilise aucun nouveau champ, tout
 * est dérivé des relations existantes et de `HistoriqueEntry`.
 *
 * - **Demandeur** : `Demande.createur`.
 * - **Validateur(s)** : `HistoriqueEntry` `validation`/`validation_complementaire`
 *   (Phase B) — plusieurs personnes possibles (validation initiale puis
 *   complémentaire par quelqu'un d'autre, aucune contrainte sur l'auteur).
 * - **Régleur(s)** : auteurs des `Reglement` confirmés et non annulés de
 *   la demande — pris directement sur `Reglement.auteur` (relation),
 *   jamais reconstruit depuis le texte de l'historique.
 * - **Clôturé par** : dernière `HistoriqueEntry` `cloture_totale`/
 *   `cloture_partielle` — bonus naturel dans ce contexte précis (on est
 *   déjà dans l'écran de clôture), en plus des trois rôles explicitement
 *   demandés.
 *
 * Chaque liste dédupliquée (un même utilisateur n'apparaît qu'une fois même
 * s'il est intervenu plusieurs fois à ce titre), dans l'ordre chronologique
 * de première apparition. "—" si aucune personne trouvée pour un rôle.
 */
export async function PersonnesIntervenantes({
  demandeId,
  demandeurNom,
}: {
  demandeId: string;
  demandeurNom: string;
}) {
  const [validations, reglements, clotures] = await Promise.all([
    prisma.historiqueEntry.findMany({
      where: { entity: "Demande", entityId: demandeId, action: { in: ["validation", "validation_complementaire"] } },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reglement.findMany({
      where: { demandeId, estConfirme: true, estAnnule: false },
      include: { auteur: true },
      orderBy: { confirmeAt: "asc" },
    }),
    prisma.historiqueEntry.findMany({
      where: { entity: "Demande", entityId: demandeId, action: { in: ["cloture_totale", "cloture_partielle"] } },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const validateursNoms = [...new Set(validations.map((v) => v.user.fullName))];
  const regleursNoms = [...new Set(reglements.map((r) => r.auteur.fullName))];
  const clotureParNom = clotures.at(-1)?.user.fullName;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Personnes intervenantes</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Demandeur</dt>
          <dd className="text-sm text-foreground">{demandeurNom}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Validateur(s)</dt>
          <dd className="text-sm text-foreground">
            {validateursNoms.length > 0 ? validateursNoms.join(", ") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Régleur(s)</dt>
          <dd className="text-sm text-foreground">{regleursNoms.length > 0 ? regleursNoms.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clôturé par</dt>
          <dd className="text-sm text-foreground">{clotureParNom ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
