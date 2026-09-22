import { prisma } from "backend";

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
  modification_description: "Description du besoin modifiée",
  validation: "Validation",
  validation_complementaire: "Validation complémentaire",
  rejet: "Rejet",
  rejet_reliquat: "Rejet du reliquat non validé",
  reglement: "Règlement",
  annulation_reglement: "Annulation de règlement",
  declaration_retour: "Retour de caisse déclaré",
  modification_retour: "Retour de caisse modifié",
  reception_retour: "Retour de caisse réceptionné",
  cloture_totale: "Clôture totale",
  cloture_partielle: "Clôture partielle",
  validation_complete_dg: "Validation complète approuvée par le DG",
  rejet_validation_complete: "Validation complète rejetée par le DG (examen)",
  annulation_validation_complete: "Approbation du DG annulée",
  // Tâche "Validation ligne par ligne" (voir CLAUDE.md) — entrées portées
  // par `entity: "LigneDemande"`, une par ligne décidée/modifiée.
  validation_ligne: "Ligne d'article validée",
  rejet_ligne: "Ligne d'article rejetée",
  modification_libelle_ligne: "Libellé d'une ligne d'article modifié",
  // Tâche "Catégorisation par ligne" (voir CLAUDE.md) — même entité
  // `LigneDemande` que ci-dessus.
  categorisation_ligne: "Catégorisation d'une ligne d'article",
};

function labelForAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Actions de gestion strictement internes à Finance (Catégorie/Objet
 * assignés, description corrigée) — voir CLAUDE.md "Masquer Catégorie/
 * Objet côté historique Collaborateur" : jamais montrées au Collaborateur
 * créateur, même indirectement via l'historique (révéleraient la
 * catégorie/l'objet, ou qu'une modification de description a eu lieu et
 * son ancien contenu, contredisant le choix de ne lui montrer que la
 * version originale). `modification_libelle_ligne` rejoint ce même
 * principe (Tâche "Validation ligne par ligne", voir CLAUDE.md) : révèle
 * l'ancien libellé d'une ligne, alors que le Collaborateur ne doit voir que
 * `libelleOriginal`. **`validation_ligne`/`rejet_ligne` restent
 * volontairement VISIBLES** au Collaborateur (contrairement au reste de
 * cette liste) : la Tâche 4 lui montre déjà, directement sur le tableau des
 * articles, le statut de décision de chaque ligne — les masquer ici
 * créerait une incohérence entre le tableau et l'historique, jamais
 * recherchée pour cette décision précise (à la différence de la
 * catégorisation/description, qui restent, elles, de la gestion interne).
 * `categorisation_ligne` (Tâche "Catégorisation par ligne") rejoint la
 * gestion interne pour la même raison exacte que `CATEGORISER` : la
 * Catégorie/l'Objet d'une ligne ne sont jamais montrés au Collaborateur,
 * même indirectement via l'historique. */
const ACTIONS_GESTION_INTERNE = new Set([
  "CATEGORISER",
  "modification_description",
  "modification_libelle_ligne",
  "categorisation_ligne",
]);

/**
 * Historique générique d'une Demande, basé sur `HistoriqueEntry`
 * (`entity: "Demande"`). Server Component autonome : ne prend que l'id de
 * la demande, effectue lui-même la requête — s'utilise depuis n'importe
 * quelle page qui affiche une demande, pas seulement l'écran Finance.
 *
 * **`masquerGestionInterne`** (défaut `false`) — exclut les entrées de
 * `ACTIONS_GESTION_INTERNE` : à passer `true` uniquement depuis l'écran
 * Collaborateur (`treso/demandes/[id]/page.tsx`), jamais depuis l'écran
 * Finance.
 *
 * Exemple :
 *   <DemandeHistorique demandeId={demande.id} />
 */
export async function DemandeHistorique({
  demandeId,
  masquerGestionInterne = false,
}: {
  demandeId: string;
  masquerGestionInterne?: boolean;
}) {
  // Tâche "Validation ligne par ligne" (voir CLAUDE.md) : les entrées
  // `validation_ligne`/`rejet_ligne`/`modification_libelle_ligne` portent
  // `entity: "LigneDemande"` et `entityId: <ligneId>`, jamais `entityId:
  // demandeId` — il faut donc d'abord connaître les lignes de CETTE
  // demande pour les inclure dans le même historique fusionné.
  const lignes = await prisma.ligneDemande.findMany({ where: { demandeId }, select: { id: true } });
  const ligneIds = lignes.map((ligne) => ligne.id);

  const entries = await prisma.historiqueEntry.findMany({
    where: {
      OR: [
        { entity: "Demande", entityId: demandeId },
        ...(ligneIds.length > 0 ? [{ entity: "LigneDemande", entityId: { in: ligneIds } }] : []),
      ],
      ...(masquerGestionInterne ? { action: { notIn: Array.from(ACTIONS_GESTION_INTERNE) } } : {}),
    },
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
