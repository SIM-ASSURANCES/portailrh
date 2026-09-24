import { getCategoriesConcerneesDemande, getResteARegler, getTotalRegle } from "backend";
import { prisma } from "backend";

import { ReglementForm } from "./ReglementForm";
import { ReglementRow } from "./ReglementRow";

/**
 * Section "Règlements" d'une demande ayant un montant validé (`montantValide
 * > 0` — totalement ou partiellement, Phase C) : montant validé / total
 * réglé / reste à régler (calculé sur `montantValide`, PAS le montant
 * demandé — cahier des charges section 4), liste des règlements
 * (brouillon/confirmé/annulé), et le formulaire d'ajout dès qu'il reste
 * quelque chose à régler — visible mais désactivé si l'utilisateur n'a pas
 * `treso.effectuer_reglement` (ex: le Responsable Finance depuis
 * "Séparation Responsable Finance / Assistant Finance", voir CLAUDE.md),
 * jamais absent : `resteARegler > 0` reste la seule condition d'AFFICHAGE
 * du formulaire (état métier), `canEffectuerReglement` ne contrôle plus
 * que son état activé/désactivé (permission). Server Component autonome :
 * requête lui-même règlements + totaux à partir du seul id de la demande.
 */
export async function ReglementsSection({
  demandeId,
  montantValide,
  canEffectuerReglement: canEffectuerReglementBrut,
  canAnnulerReglementConfirme,
}: {
  demandeId: string;
  montantValide: number;
  canEffectuerReglement: boolean;
  /** Tâche "Annulation d'un règlement après reçu réservée au Responsable"
   * (voir CLAUDE.md) — distincte de `canEffectuerReglement` : contrôle
   * UNIQUEMENT le bouton "Annuler" d'un règlement déjà confirmé, jamais
   * Modifier/Confirmer (restés sur `canEffectuerReglement`, inchangés). */
  canAnnulerReglementConfirme: boolean;
}) {
  const [reglements, totalRegle, resteARegler, categoriesConcernees, demandeGel] = await Promise.all([
    prisma.reglement.findMany({
      where: { demandeId },
      include: { auteur: true, allocations: { include: { categorie: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getTotalRegle(demandeId),
    getResteARegler(demandeId),
    // Allocation budgétaire explicite par règlement (voir CLAUDE.md) : la
    // MÊME liste de catégories concernées sert à la fois à construire les
    // champs de répartition de `ReglementForm` (création) et de chaque
    // `ReglementRow` en édition — jamais deux calculs divergents.
    getCategoriesConcerneesDemande(demandeId),
    prisma.demande.findUnique({ where: { id: demandeId }, select: { validationCompleteRejeteeParDG: true } }),
  ]);

  // Gel après rejet DG (voir CLAUDE.md "Le rejet DG gèle le règlement") :
  // création/modification/confirmation désactivées, avec message explicite
  // à l'endroit où l'Assistant Finance tenterait d'agir.
  const gele = demandeGel?.validationCompleteRejeteeParDG ?? false;
  const canEffectuerReglement = canEffectuerReglementBrut && !gele;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Règlements</h2>

      {gele ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          Rejetée par le DG — en attente de resoumission par le Responsable Finance. Aucun règlement ne peut être
          créé, modifié ou confirmé tant que la validation complète n&apos;a pas été approuvée.
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Montant validé
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {montantValide.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total réglé
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {totalRegle.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reste à régler
          </dt>
          <dd className={`text-sm font-semibold ${resteARegler > 0 ? "text-warning" : "text-success"}`}>
            {resteARegler.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
      </dl>

      {reglements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun règlement pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-3">
          {reglements.map((r) => (
            <ReglementRow
              key={r.id}
              canEffectuerReglement={canEffectuerReglement}
              canAnnulerReglementConfirme={canAnnulerReglementConfirme}
              categoriesConcernees={categoriesConcernees.map((c) => ({
                categorieId: c.categorieId,
                categorieLabel: c.categorieLabel,
                restant: c.restant,
              }))}
              reglement={{
                id: r.id,
                montant: Number(r.montant),
                mode: r.mode,
                estConfirme: r.estConfirme,
                estAnnule: r.estAnnule,
                motifAnnulation: r.motifAnnulation,
                auteurNom: r.auteur.fullName,
                createdAt: r.createdAt,
                allocations: r.allocations.map((a) => ({
                  categorieId: a.categorieId,
                  categorieLabel: a.categorie.label,
                  montant: Number(a.montant),
                })),
              }}
            />
          ))}
        </ul>
      )}

      {resteARegler > 0 ? (
        <ReglementForm
          demandeId={demandeId}
          resteARegler={resteARegler}
          categoriesConcernees={categoriesConcernees.map((c) => ({
            categorieId: c.categorieId,
            categorieLabel: c.categorieLabel,
            restant: c.restant,
          }))}
          disabled={!canEffectuerReglement}
        />
      ) : null}
    </div>
  );
}
