import {
  beneficiaireArticle,
  getResteARegler,
  getTotalRegle,
  MESSAGE_REGLEMENTS_NON_RATTACHES,
  montantValideArticle,
  prisma,
  refusExecutionPropreReglement,
  resteAReglerArticle,
  reglementsNonRattaches,
  totalRegleArticle,
  type ArticleReglable,
} from "backend";

import { ReglementForm } from "./ReglementForm";
import { ReglementRow, type ReglementRowData } from "./ReglementRow";

/**
 * Section "Règlements" d'une demande ayant un montant validé : montants de la demande (validé / réglé / reste), puis —
 * lot D, « un règlement = un article » — un bloc PAR ARTICLE VALIDÉ (libellé, bénéficiaire, validé / réglé / reste, ses
 * règlements, son formulaire d'ajout) : on règle un article sans toucher aux autres, chacun avec SON bénéficiaire.
 * Une demande sans article (dépense directe) garde la liste et le formulaire de la demande entière.
 *
 * Boutons visibles mais désactivés, jamais absents : `canEffectuerReglement` (permission) et le conflit d'intérêts
 * PAR ARTICLE (`refusExecutionPropreReglement` : créateur et bénéficiaire de l'article seulement) ne contrôlent que
 * leur état. Règlements antérieurs non rattachés à un article (cas ambigu) : signalés, et tout nouveau règlement est
 * bloqué avec la phrase du serveur. Server Component autonome.
 */
export async function ReglementsSection({
  demandeId,
  montantValide,
  canEffectuerReglement: canEffectuerReglementBrut,
  canAnnulerReglementConfirme: canAnnulerReglementConfirmeBrut,
  userId = null,
}: {
  demandeId: string;
  montantValide: number;
  canEffectuerReglement: boolean;
  /** Distincte de `canEffectuerReglement` : contrôle UNIQUEMENT le bouton "Annuler" d'un règlement confirmé. */
  canAnnulerReglementConfirme: boolean;
  /** Compte connecté : sert à griser, article par article, ce dont il est le demandeur ou le bénéficiaire. */
  userId?: string | null;
}) {
  const [demande, totalRegle, resteARegler] = await Promise.all([
    prisma.demande.findUniqueOrThrow({
      where: { id: demandeId },
      include: {
        beneficiaireUser: { select: { fullName: true } },
        lignes: { orderBy: { createdAt: "asc" }, include: { beneficiaireUser: { select: { fullName: true } } } },
        reglements: { orderBy: { createdAt: "asc" }, include: { auteur: true, allocations: { include: { categorie: true } } } },
      },
    }),
    getTotalRegle(demandeId),
    getResteARegler(demandeId),
  ]);

  // Gel après rejet DG (voir CLAUDE.md "Le rejet DG gèle le règlement") : création/modification/confirmation
  // désactivées, avec message explicite à l'endroit où l'Assistant Finance tenterait d'agir.
  const gele = demande.validationCompleteRejeteeParDG;
  const peutAgir = canEffectuerReglementBrut && !gele;

  const enLigne = (r: (typeof demande.reglements)[number]): ReglementRowData => ({
    id: r.id,
    montant: Number(r.montant),
    mode: r.mode,
    estConfirme: r.estConfirme,
    estAnnule: r.estAnnule,
    motifAnnulation: r.motifAnnulation,
    auteurNom: r.auteur.fullName,
    createdAt: r.createdAt,
    allocations: r.allocations.map((a) => ({ categorieId: a.categorieId, categorieLabel: a.categorie.label, montant: Number(a.montant) })),
  });
  const refus = (ligne: (typeof demande.lignes)[number] | null) =>
    userId ? refusExecutionPropreReglement(demande, ligne, userId) : null;

  const articles: ArticleReglable[] = demande.lignes.map((l) => ({
    id: l.id,
    libelle: l.libelle,
    quantite: l.quantite,
    prixUnitaire: Number(l.prixUnitaire),
    statutValidation: l.statutValidation,
    categorieId: l.categorieId,
  }));
  const nonRattaches = demande.lignes.length > 0 ? reglementsNonRattaches(demande.reglements) : [];
  const articlesAReglerListe = demande.lignes.filter((l) => l.statutValidation === "VALIDEE");

  // Une demande sans article : une seule liste, un seul formulaire (comportement d'avant le lot D).
  const sansArticle = demande.lignes.length === 0;
  const raisonSansArticle = refus(null);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Règlements</h2>

      {gele ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          Rejetée par le DG — en attente de resoumission par Finance. Aucun règlement ne peut être
          créé, modifié ou confirmé tant que la validation complète n&apos;a pas été approuvée.
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Montant validé</dt>
          <dd className="text-sm font-semibold text-foreground">{montantValide.toLocaleString("fr-FR")} FCFA</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total réglé</dt>
          <dd className="text-sm font-semibold text-foreground">{totalRegle.toLocaleString("fr-FR")} FCFA</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reste à régler</dt>
          <dd className={`text-sm font-semibold ${resteARegler > 0 ? "text-warning" : "text-success"}`}>
            {resteARegler.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
      </dl>

      {nonRattaches.length > 0 ? (
        <div className="space-y-3 rounded-md border border-warning bg-warning-bg p-4" data-reglements-non-rattaches>
          <p className="text-sm font-medium text-warning">{MESSAGE_REGLEMENTS_NON_RATTACHES}</p>
          <ul className="space-y-3">
            {nonRattaches.map((r) => (
              <ReglementRow
                key={r.id}
                canEffectuerReglement={false}
                canAnnulerReglementConfirme={canAnnulerReglementConfirmeBrut && !refus(null)}
                reglement={enLigne(demande.reglements.find((x) => x.id === r.id)!)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {sansArticle ? (
        <>
          {demande.reglements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun règlement pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-3">
              {demande.reglements.map((r) => (
                <ReglementRow
                  key={r.id}
                  canEffectuerReglement={peutAgir && !raisonSansArticle}
                  canAnnulerReglementConfirme={canAnnulerReglementConfirmeBrut && !raisonSansArticle}
                  reglement={enLigne(r)}
                />
              ))}
            </ul>
          )}
          {resteARegler > 0 ? (
            <ReglementForm
              demandeId={demandeId}
              resteARegler={resteARegler}
              disabled={!peutAgir || !!raisonSansArticle}
              raisonIndisponible={raisonSansArticle}
            />
          ) : null}
        </>
      ) : (
        <div className="space-y-4">
          {articlesAReglerListe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article validé à régler pour l&apos;instant.</p>
          ) : null}
          {articlesAReglerListe.map((ligne) => {
            const article = articles.find((a) => a.id === ligne.id)!;
            const regles = demande.reglements.filter((r) => r.ligneDemandeId === ligne.id);
            const valide = montantValideArticle(article);
            const regle = totalRegleArticle(demande.reglements, ligne.id);
            const reste = resteAReglerArticle(article, demande.reglements);
            const benef = beneficiaireArticle(ligne, demande);
            const raison = refus(ligne);
            const bloqueNonRattaches = nonRattaches.length > 0;
            return (
              <section
                key={ligne.id}
                className="space-y-3 rounded-md border border-border p-4"
                data-article-reglement={ligne.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{ligne.libelle}</h3>
                    <p className="text-xs text-muted-foreground">Bénéficiaire : {benef.libelle}</p>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Validé {valide.toLocaleString("fr-FR")} · réglé {regle.toLocaleString("fr-FR")} ·{" "}
                    <span className={reste > 0 ? "font-semibold text-warning" : "font-semibold text-success"}>
                      reste {reste.toLocaleString("fr-FR")} FCFA
                    </span>
                  </p>
                </div>

                {raison ? (
                  <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning" data-conflit-interet>
                    {raison}
                  </p>
                ) : null}

                {regles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun règlement pour cet article.</p>
                ) : (
                  <ul className="space-y-3">
                    {regles.map((r) => (
                      <ReglementRow
                        key={r.id}
                        canEffectuerReglement={peutAgir && !raison && !bloqueNonRattaches}
                        canAnnulerReglementConfirme={canAnnulerReglementConfirmeBrut && !raison}
                        reglement={enLigne(r)}
                      />
                    ))}
                  </ul>
                )}

                {reste > 0 ? (
                  <ReglementForm
                    demandeId={demandeId}
                    ligneDemandeId={ligne.id}
                    libelleArticle={ligne.libelle}
                    resteARegler={reste}
                    disabled={!peutAgir || !!raison || bloqueNonRattaches}
                    raisonIndisponible={raison ?? (bloqueNonRattaches ? MESSAGE_REGLEMENTS_NON_RATTACHES : null)}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
