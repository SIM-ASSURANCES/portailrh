// Chargement de la régularisation PAR ARTICLE d'une demande (lot E, 2026-10-17) : une série de requêtes groupées, puis
// `agregerRegularisation` (pur). Lecture seule. N'importe pas `tresorerie.ts` (qui, lui, appelle ce module pour `getEcart`).

import { beneficiaireArticle } from "./beneficiaireArticles";
import { totalArticle, type StatutArticle } from "./etatArticles";
import { prisma } from "./prisma";
import { estFicheRegularisation } from "./regularisationDepenses";
import {
  agregerRegularisation,
  articleTermine,
  dateRegularisation,
  etatRegularisationArticle,
  getEcartLigne,
  AGREGATS_VIDES,
  type AgregatsRegularisation,
  type EtatRegularisationArticle,
  type RegularisationDemande,
} from "./regularisationArticle";

export interface ArticleRegularisation {
  ligneId: string;
  /** Libellé de la Finance. */
  libelle: string;
  /** Libellé vu du demandeur (version d'origine). */
  libelleDemandeur: string;
  beneficiaire: string;
  statut: StatutArticle;
  /** Total de l'article s'il est validé, sinon 0. */
  montantValide: number;
  agregats: AgregatsRegularisation;
  ecart: number;
  etat: EtatRegularisationArticle;
  termine: boolean;
  /** Date à laquelle l'article est devenu régularisé (solde nul), si connue. */
  regulariseAt: Date | null;
  /** Retours de caisse de l'article pas encore réceptionnés. */
  retoursEnAttente: number;
}

export interface RegularisationDemandeVue {
  articles: ArticleRegularisation[];
  /** Part non rattachée à un article (voir `agregerRegularisation`). */
  nonRattache: AgregatsRegularisation;
  /** Il existe des règlements ou des retours exceptionnels non rattachés sur une demande qui a des articles. */
  aDuNonRattache: boolean;
  total: AgregatsRegularisation;
  ecartTotal: number;
  /** Détail brut conservé pour les appelants qui en ont besoin (parcours, tests). */
  brut: RegularisationDemande;
}

/** Agrégats de régularisation (pur + une série de requêtes) d'une demande, sans le détail des articles. */
export async function getAgregatsRegularisation(demandeId: string): Promise<RegularisationDemande> {
  const [reglements, retours, remboursements, exceptionnelsValides, externes] = await Promise.all([
    prisma.reglement.findMany({
      where: { demandeId },
      select: { id: true, ligneDemandeId: true, montant: true, estConfirme: true, estAnnule: true },
    }),
    prisma.retourCaisse.findMany({
      where: { reglement: { demandeId } },
      select: {
        reglementId: true,
        estReceptionne: true,
        montantARetourner: true,
        creeParAssistant: true,
        dateRetour: true,
        versementBancaire: true,
        motifReouvertureExceptionnelle: true,
        signalementOrigineId: true,
        reglement: { select: { mode: true } },
        depenses: { select: { montant: true, justification: true, objet: true, motifNonJustifie: true } },
      },
    }),
    prisma.remboursementRetour.findMany({
      where: { statut: "VALIDE", retourCaisse: { reglement: { demandeId } } },
      select: { montant: true, retourCaisse: { select: { reglementId: true } } },
    }),
    prisma.retourExceptionnel.findMany({
      where: { demandeId, statut: "VALIDE" },
      select: { ligneDemandeId: true, montant: true },
    }),
    // Retours EXTERNES rattachés (lot G bis) : retour d'un fonds versé par banque, rendu à la caisse = retour reçu.
    prisma.retourExterne.findMany({
      where: { demandeId },
      select: { ligneDemandeId: true, montantRetourne: true },
    }),
  ]);
  const exceptionnels = [
    ...exceptionnelsValides,
    ...externes.map((e) => ({ ligneDemandeId: e.ligneDemandeId, montant: e.montantRetourne })),
  ];
  return agregerRegularisation({
    reglements: reglements.map((r) => ({ ...r, montant: Number(r.montant) })),
    retours: retours.map((r) => ({
      reglementId: r.reglementId,
      estReceptionne: r.estReceptionne,
      // Un retour « attendu » est un vrai retour déclaré : ni la fiche de détail des dépenses (montant à rendre calculé), ni la
      // fiche d'un fonds versé par banque (jamais réceptionnée, son retour passe par un retour externe).
      attendu: !estFicheRegularisation(r) && !(r.reglement.mode === "BANQUE" && !r.versementBancaire),
      montantARetourner: Number(r.montantARetourner),
      depenses: r.depenses.map((d) => ({ ...d, montant: Number(d.montant) })),
    })),
    remboursements: remboursements.map((rb) => ({ reglementId: rb.retourCaisse.reglementId, montant: Number(rb.montant) })),
    exceptionnels: exceptionnels.map((e) => ({ ligneDemandeId: e.ligneDemandeId, montant: Number(e.montant) })),
  });
}

/** Solde à régulariser de la demande entière, par la même formule que celle des articles (`getEcartLigne`). */
export async function getEcartDemande(demandeId: string): Promise<number> {
  return getEcartLigne((await getAgregatsRegularisation(demandeId)).total);
}

/** Régularisation de chaque article validé ou non de la demande, plus la part non rattachée et le total. */
export async function getRegularisationParArticle(demandeId: string): Promise<RegularisationDemandeVue> {
  const [demande, brut, datesReglements, datesRetours, datesDepenses, datesExceptionnels, datesExternes, enAttente] = await Promise.all([
    prisma.demande.findUnique({
      where: { id: demandeId },
      select: {
        beneficiaireType: true,
        beneficiaireUserId: true,
        beneficiaireNom: true,
        beneficiaireUser: { select: { fullName: true } },
        lignes: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            libelle: true,
            libelleOriginal: true,
            libelleDemandeur: true,
            quantite: true,
            prixUnitaire: true,
            statutValidation: true,
            beneficiaireType: true,
            beneficiaireUserId: true,
            beneficiaireNom: true,
            beneficiaireUser: { select: { fullName: true } },
          },
        },
      },
    }),
    getAgregatsRegularisation(demandeId),
    prisma.reglement.findMany({
      where: { demandeId, estConfirme: true, estAnnule: false, ligneDemandeId: { not: null } },
      select: { ligneDemandeId: true, confirmeAt: true },
    }),
    prisma.retourCaisse.findMany({
      where: { reglement: { demandeId, ligneDemandeId: { not: null } }, estReceptionne: true },
      select: { receptionneAt: true, reglement: { select: { ligneDemandeId: true } } },
    }),
    prisma.depenseLigne.findMany({
      where: { retourCaisse: { reglement: { demandeId, ligneDemandeId: { not: null } } } },
      select: { createdAt: true, retourCaisse: { select: { reglement: { select: { ligneDemandeId: true } } } } },
    }),
    prisma.retourExceptionnel.findMany({
      where: { demandeId, statut: "VALIDE", ligneDemandeId: { not: null } },
      select: { ligneDemandeId: true, valideAt: true },
    }),
    prisma.retourExterne.findMany({
      where: { demandeId, ligneDemandeId: { not: null } },
      select: { ligneDemandeId: true, creeAt: true },
    }),
    prisma.retourCaisse.findMany({
      // Lot G bis : la fiche de détail d'un fonds versé par banque n'est pas un retour à réceptionner.
      where: {
        reglement: { demandeId, ligneDemandeId: { not: null } },
        estReceptionne: false,
        NOT: { reglement: { mode: "BANQUE" }, versementBancaire: false },
      },
      select: { reglement: { select: { ligneDemandeId: true } } },
    }),
  ]);

  const datesParLigne = new Map<string, (Date | null)[]>();
  const noter = (ligneId: string | null | undefined, d: Date | null | undefined) => {
    if (!ligneId) return;
    datesParLigne.set(ligneId, [...(datesParLigne.get(ligneId) ?? []), d ?? null]);
  };
  datesReglements.forEach((r) => noter(r.ligneDemandeId, r.confirmeAt));
  datesRetours.forEach((r) => noter(r.reglement.ligneDemandeId, r.receptionneAt));
  datesDepenses.forEach((d) => noter(d.retourCaisse.reglement.ligneDemandeId, d.createdAt));
  datesExceptionnels.forEach((e) => noter(e.ligneDemandeId, e.valideAt));
  datesExternes.forEach((e) => noter(e.ligneDemandeId, e.creeAt));
  const retoursEnAttenteParLigne = new Map<string, number>();
  for (const r of enAttente) {
    const id = r.reglement.ligneDemandeId as string;
    retoursEnAttenteParLigne.set(id, (retoursEnAttenteParLigne.get(id) ?? 0) + 1);
  }

  const articles: ArticleRegularisation[] = [];
  if (demande) {
    for (const ligne of demande.lignes) {
      const agregats = brut.parArticle.get(ligne.id) ?? { ...AGREGATS_VIDES };
      const statut = ligne.statutValidation as StatutArticle;
      const total = totalArticle({ quantite: ligne.quantite, prixUnitaire: Number(ligne.prixUnitaire) });
      articles.push({
        ligneId: ligne.id,
        libelle: ligne.libelle,
        libelleDemandeur: ligne.libelleDemandeur ?? ligne.libelleOriginal ?? ligne.libelle,
        beneficiaire: beneficiaireArticle(ligne, demande).libelle,
        statut,
        montantValide: statut === "VALIDEE" ? total : 0,
        agregats,
        ecart: getEcartLigne(agregats),
        etat: etatRegularisationArticle({ valide: statut === "VALIDEE", agregats }),
        termine: articleTermine({ statut, agregats, montantValide: total }),
        regulariseAt: dateRegularisation({ agregats, dates: datesParLigne.get(ligne.id) ?? [] }),
        retoursEnAttente: retoursEnAttenteParLigne.get(ligne.id) ?? 0,
      });
    }
  }
  const [reglementsSansArticle, exceptionnelsSansArticle] = await Promise.all([
    prisma.reglement.count({ where: { demandeId, ligneDemandeId: null, estAnnule: false } }),
    prisma.retourExceptionnel.count({ where: { demandeId, ligneDemandeId: null, statut: "VALIDE" } }),
  ]);
  return {
    articles,
    nonRattache: brut.nonRattache,
    aDuNonRattache: articles.length > 0 && (reglementsSansArticle > 0 || exceptionnelsSansArticle > 0),
    total: brut.total,
    ecartTotal: getEcartLigne(brut.total),
    brut,
  };
}

export interface ResumeArticle {
  ligneId: string;
  libelle: string;
  libelleDemandeur: string;
  beneficiaire: string;
  montantValide: number;
  statut: StatutArticle;
}

/** Libellé, bénéficiaire et montant validé d'un article, pour le nommer partout où l'on parle de ses dépenses ou retours. */
export async function getResumeArticle(ligneId: string): Promise<ResumeArticle | null> {
  const ligne = await prisma.ligneDemande.findUnique({
    where: { id: ligneId },
    select: {
      id: true,
      libelle: true,
      libelleOriginal: true,
      libelleDemandeur: true,
      quantite: true,
      prixUnitaire: true,
      statutValidation: true,
      beneficiaireType: true,
      beneficiaireUserId: true,
      beneficiaireNom: true,
      beneficiaireUser: { select: { fullName: true } },
      demande: {
        select: { beneficiaireType: true, beneficiaireUserId: true, beneficiaireNom: true, beneficiaireUser: { select: { fullName: true } } },
      },
    },
  });
  if (!ligne) return null;
  const statut = ligne.statutValidation as StatutArticle;
  return {
    ligneId: ligne.id,
    libelle: ligne.libelle,
    libelleDemandeur: ligne.libelleDemandeur ?? ligne.libelleOriginal ?? ligne.libelle,
    beneficiaire: beneficiaireArticle(ligne, ligne.demande).libelle,
    montantValide: statut === "VALIDEE" ? totalArticle({ quantite: ligne.quantite, prixUnitaire: Number(ligne.prixUnitaire) }) : 0,
    statut,
  };
}
