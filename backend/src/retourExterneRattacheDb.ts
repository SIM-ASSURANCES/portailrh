// Retour EXTERNE rattaché (lot G bis, 2026-10-19) : lecture du contexte d'un rattachement. Les règles sont dans
// `retourExterneRattache.ts` (pur). Lecture seule.

import { prisma } from "./prisma";
import { getAgregatsRegularisation } from "./regularisationArticleDb";
import { AGREGATS_VIDES, getEcartLigne } from "./regularisationArticle";
import type { ArticleRattachable, ContexteRattachement, DemandeRattachable } from "./retourExterneRattache";

/** Contexte d'un rattachement à (demande, article). `null` si la demande n'existe pas. */
export async function chargerContexteRattachement(
  demandeId: string,
  ligneDemandeId: string | null
): Promise<ContexteRattachement | null> {
  const demande = await prisma.demande.findUnique({
    where: { id: demandeId },
    select: { id: true, lignes: { select: { id: true } } },
  });
  if (!demande) return null;
  const demandeALignes = demande.lignes.length > 0;
  const ligneAppartientALaDemande = !!ligneDemandeId && demande.lignes.some((l) => l.id === ligneDemandeId);
  // Périmètre : l'article choisi ; sans article (dépense directe), les règlements sans article de la demande.
  const perimetreLigne = demandeALignes ? ligneDemandeId : null;
  const [banque, externes, agregats] = await Promise.all([
    prisma.reglement.aggregate({
      where: { demandeId, ligneDemandeId: perimetreLigne, mode: "BANQUE", estConfirme: true, estAnnule: false },
      _sum: { montant: true },
    }),
    prisma.retourExterne.aggregate({
      where: { demandeId, ligneDemandeId: perimetreLigne },
      _sum: { montantRetourne: true },
    }),
    getAgregatsRegularisation(demandeId),
  ]);
  const agregatsPerimetre = perimetreLigne ? (agregats.parArticle.get(perimetreLigne) ?? AGREGATS_VIDES) : agregats.nonRattache;
  return {
    demandeALignes,
    ligneDemandeId,
    ligneAppartientALaDemande,
    fondsBanque: Number(banque._sum.montant ?? 0),
    dejaRetourneExterne: Number(externes._sum.montantRetourne ?? 0),
    ecartPerimetre: getEcartLigne(agregatsPerimetre),
  };
}

/** Retrouve une demande par sa référence et liste les articles qui ont des fonds versés par banque. */
export async function chercherDemandeRattachable(reference: string): Promise<DemandeRattachable | null> {
  const demande = await prisma.demande.findFirst({
    where: { reference: { equals: reference.trim(), mode: "insensitive" } },
    select: { id: true, reference: true, lignes: { select: { id: true, libelle: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!demande) return null;
  const perimetres: { ligneId: string | null; libelle: string }[] =
    demande.lignes.length > 0 ? demande.lignes.map((l) => ({ ligneId: l.id, libelle: l.libelle })) : [{ ligneId: null, libelle: "Demande entière" }];
  const articles: ArticleRattachable[] = [];
  for (const p of perimetres) {
    const ctx = await chargerContexteRattachement(demande.id, p.ligneId);
    if (ctx && ctx.fondsBanque > 0) {
      articles.push({ ligneId: p.ligneId, libelle: p.libelle, fondsBanque: ctx.fondsBanque, dejaRetourne: ctx.dejaRetourneExterne, ecart: ctx.ecartPerimetre });
    }
  }
  return { demandeId: demande.id, reference: demande.reference, articles };
}
