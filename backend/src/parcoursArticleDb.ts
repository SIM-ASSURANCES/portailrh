// Chargement des parcours d'article d'une demande (lot D, 2026-10-16) : une série de requêtes groupées pour TOUS les
// articles de la demande, puis `parcoursArticle` (pur) pour chacun. Lecture seule.

import { beneficiaireArticle } from "./beneficiaireArticles";
import { lireSnapshotBudget, phrasesSnapshotBudget } from "./budgets";
import { phrasesCouvertureParArticle } from "./budgetsDb";
import { etatLigneCircuit, totalArticle } from "./etatArticles";
import { parcoursArticle, type ParcoursArticle } from "./parcoursArticle";
import { prisma } from "./prisma";
import { getRegularisationParArticle } from "./regularisationArticleDb";
import { libelleArticleClotureForcee, lireInstantaneClotureForcee } from "./clotureDemande";
import { getSoldesARegulariserParReglements } from "./tresorerie";
import { chargerEvenementsCircuit } from "./circuitEvenementsDb";

/** Parcours de chaque article de la demande, par identifiant d'article. Vide pour une demande sans article. */
export async function getParcoursArticles(
  demandeId: string,
  // Lot J : les restes de budget sont une information de gestion interne (Finance, DG) — jamais transmise au demandeur ni au
  // responsable de service, ni imprimée dans les documents : seuls les écrans Finance et DG la demandent.
  options: { avecBudget?: boolean } = {}
): Promise<Map<string, ParcoursArticle>> {
  const demande = await prisma.demande.findUnique({
    where: { id: demandeId },
    select: {
      modeEtapeDG: true,
      clotureForcee: true,
      clotureForceeArticles: true,
      beneficiaireType: true,
      beneficiaireUserId: true,
      beneficiaireNom: true,
      beneficiaireUser: { select: { fullName: true } },
      lignes: {
        orderBy: { createdAt: "asc" },
        include: {
          decidePar: { select: { fullName: true } },
          decideurFinance: { select: { fullName: true } },
          beneficiaireUser: { select: { fullName: true } },
        },
      },
    },
  });
  const resultat = new Map<string, ParcoursArticle>();
  const couvertures = options.avecBudget ? await phrasesCouvertureParArticle(prisma, [demandeId]) : new Map<string, string>();
  if (!demande || demande.lignes.length === 0) return resultat;

  const reglements = await prisma.reglement.findMany({
    where: { demandeId, ligneDemandeId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      ligneDemandeId: true,
      montant: true,
      mode: true,
      estConfirme: true,
      estAnnule: true,
      confirmeAt: true,
      motif: true,
      // Lot G bis : la fiche de détail des dépenses d'un fonds versé par banque n'est pas un retour de caisse à réceptionner.
      retours: {
        where: { NOT: { reglement: { mode: "BANQUE" }, versementBancaire: false } },
        select: { estReceptionne: true, montantARetourner: true, receptionneAt: true, createdAt: true },
      },
    },
  });
  // Lot G : tous les règlements confirmés, Caisse comme Banque, entrent dans la régularisation de l'article.
  const confirmes = reglements.filter((r) => r.estConfirme && !r.estAnnule);
  const [soldes, exceptionnels] = await Promise.all([
    getSoldesARegulariserParReglements(confirmes.map((r) => r.id)),
    // Seuls les retours exceptionnels SANS article (anciens, demande ambiguë) rendent l'attribution indéterminée.
    prisma.retourExceptionnel.count({ where: { demandeId, statut: "VALIDE", ligneDemandeId: null } }),
  ]);
  const externes = await prisma.retourExterne.findMany({
    where: { demandeId, ligneDemandeId: { not: null } },
    orderBy: { creeAt: "asc" },
    select: { ligneDemandeId: true, montantRetourne: true, creeAt: true },
  });
  const regul = await getRegularisationParArticle(demandeId);
  const regulParLigne = new Map(regul.articles.map((a) => [a.ligneId, a]));
  // Un retour exceptionnel post-clôture SANS article (ancien) est imputé sur les règlements par ancienneté : on ne peut
  // pas l'attribuer à un article dès que plusieurs articles ont un règlement confirmé. Rattaché à un article (lot E), il est précis.
  const articlesRegles = new Set(confirmes.map((r) => r.ligneDemandeId));
  const regularisationIndeterminee = exceptionnels > 0 && articlesRegles.size >= 2;

  // Lot K : réorientations (demande) et reprises (demande ou article), relues de l'historique.
  const evenementsCircuit = (await chargerEvenementsCircuit(prisma, [{ id: demandeId, ligneIds: demande.lignes.map((l) => l.id) }])).get(demandeId) ?? [];
  const instantaneForce = lireInstantaneClotureForcee(demande.clotureForceeArticles);
  for (const ligne of demande.lignes) {
    const benef = beneficiaireArticle(ligne, demande);
    const decideParNom = ligne.decidePar?.fullName ?? null;
    const finance = ligne.decideurFinance?.fullName ?? null;
    const regulLigne = regulParLigne.get(ligne.id);
    const parcours = parcoursArticle({
        statut: ligne.statutValidation,
        etat: etatLigneCircuit(
          { statut: ligne.statutValidation, soumiseAuDG: ligne.soumiseAuDG, decisionDG: ligne.decisionDG },
          demande.modeEtapeDG
        ),
        montant: totalArticle({ quantite: ligne.quantite, prixUnitaire: Number(ligne.prixUnitaire) }),
        beneficiaire: benef.libelle,
        decidePar: decideParNom,
        decideAt: ligne.decideAt,
        confirmeParFinance: finance && finance !== decideParNom ? finance : null,
        motifRejet: ligne.motifRejet,
        regularisationIndeterminee,
        retoursExternes: externes
          .filter((x) => x.ligneDemandeId === ligne.id)
          .map((x) => ({ montant: Number(x.montantRetourne), creeAt: x.creeAt })),
        regularisation: regulParLigne.has(ligne.id)
          ? { agregats: regulParLigne.get(ligne.id)!.agregats, regulariseAt: regulParLigne.get(ligne.id)!.regulariseAt }
          : undefined,
        reglements: reglements
          .filter((r) => r.ligneDemandeId === ligne.id)
          .map((r) => ({
            id: r.id,
            montant: Number(r.montant),
            mode: r.mode,
            estConfirme: r.estConfirme,
            estAnnule: r.estAnnule,
            confirmeAt: r.confirmeAt,
            motif: r.motif,
            solde: soldes.has(r.id) ? (soldes.get(r.id) as number) : null,
            retours: r.retours.map((x) => ({
              estReceptionne: x.estReceptionne,
              montantARetourner: Number(x.montantARetourner),
              date: x.estReceptionne ? (x.receptionneAt ?? x.createdAt) : x.createdAt,
            })),
          })),
      });
    const circuit = evenementsCircuit.filter((e) => e.ligneId === null || e.ligneId === ligne.id).map((e) => e.texte);
    if (circuit.length > 0) parcours.circuit = circuit;
    if (options.avecBudget) {
      const snap = lireSnapshotBudget(ligne.budgetApresValidation);
      if (snap) parcours.budget = { lignes: phrasesSnapshotBudget(snap), niveau: snap.niveau };
      const couverture = couvertures.get(ligne.id);
      if (couverture) parcours.budget = { lignes: parcours.budget?.lignes ?? [], niveau: parcours.budget?.niveau ?? "ROUGE", couvertureReglement: couverture };
    }
    // Lot C : demande clôturée de force — l'article encore non régularisé le dit, avec son solde restant.
    parcours.clotureSansRegularisation = libelleArticleClotureForcee(
      demande,
      instantaneForce,
      ligne.id,
      regulLigne?.termine ?? true,
      regulLigne?.ecart ?? 0
    );
    resultat.set(ligne.id, parcours);
  }
  return resultat;
}
