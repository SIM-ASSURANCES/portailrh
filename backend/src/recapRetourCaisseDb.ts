// Récapitulatif général du retour de caisse (lot G.4, 2026-10-14) : par article et pour toute la demande, ce que le
// collaborateur a reçu (Caisse + Banque), ce qui a été retourné ou est en attente de réception, les dépenses (justifiées,
// sans pièce formelle, reste non détaillé), le solde et l'état. Lecture seule, mêmes agrégats que la régularisation
// (`getRegularisationParArticle`) : un seul calcul. Ne renvoie jamais d'information de gestion interne (ni motif Finance,
// ni catégorie) ; le libellé d'un article est la version du demandeur.

import { prisma } from "./prisma";
import {
  getEcartLigne,
  LIBELLE_ETAT_REGULARISATION,
  type AgregatsRegularisation,
  type EtatRegularisationArticle,
} from "./regularisationArticle";
import { getRegularisationParArticle } from "./regularisationArticleDb";

export interface RecapFonds {
  caisse: number;
  banque: number;
}

export interface RecapRetours {
  /** Nombre de retours déclarés (réceptionnés ou non). */
  declares: number;
  /** Montant rendu et réceptionné (net des remboursements, hors retours exceptionnels) = `retoursRecus` de l'agrégat. */
  recus: number;
  /** Montant déclaré mais pas encore réceptionné. */
  enAttente: number;
  /** Part de `recus` rendue à la caisse par la Finance pour un fonds versé par banque (retour externe rattaché, lot G bis). */
  parLaFinance: number;
}

export interface RecapArticle {
  ligneId: string | null;
  libelle: string;
  beneficiaire: string | null;
  montantValide: number | null;
  fonds: RecapFonds;
  retours: RecapRetours;
  agregats: AgregatsRegularisation;
  solde: number;
  etat: EtatRegularisationArticle;
  libelleEtat: string;
}

export interface RecapRetourCaisse {
  /** Articles validés ayant reçu des fonds (ou en attente de règlement), dans l'ordre de la demande. */
  articles: RecapArticle[];
  /** Total de la demande. */
  total: Omit<RecapArticle, "ligneId" | "libelle" | "beneficiaire" | "montantValide">;
  /** Rien n'a encore été réglé : le récapitulatif n'a pas d'objet. */
  aucunFonds: boolean;
}

const centimes = (n: number) => Math.round(n * 100);
const somme = (xs: number[]) => xs.reduce((s, x) => s + centimes(x), 0) / 100;

/** Pur : état du total de la demande (mêmes seuils que l'état d'un article). */
export function etatTotalRecap(a: AgregatsRegularisation): EtatRegularisationArticle {
  if (centimes(a.fondsRemis) === 0) return "ATTENTE_REGLEMENT";
  const e = centimes(getEcartLigne(a));
  return e === 0 ? "REGULARISE" : e < 0 ? "ANOMALIE" : "A_REGULARISER";
}

export async function getRecapRetourCaisse(demandeId: string): Promise<RecapRetourCaisse> {
  const [regul, reglements, retours, externes] = await Promise.all([
    getRegularisationParArticle(demandeId),
    prisma.reglement.findMany({
      where: { demandeId, estConfirme: true, estAnnule: false },
      select: { ligneDemandeId: true, mode: true, montant: true },
    }),
    prisma.retourCaisse.findMany({
      // Lot G bis : la fiche de détail des dépenses d'un fonds versé par banque n'est pas un retour à réceptionner.
      where: { reglement: { demandeId }, NOT: { reglement: { mode: "BANQUE" }, versementBancaire: false } },
      select: { estReceptionne: true, montantARetourner: true, reglement: { select: { ligneDemandeId: true } } },
    }),
    prisma.retourExterne.findMany({ where: { demandeId }, select: { ligneDemandeId: true, montantRetourne: true } }),
  ]);

  const fondsDe = (ligneId: string | null | undefined): RecapFonds => {
    const lots = reglements.filter((r) => ligneId === undefined || r.ligneDemandeId === ligneId);
    return {
      caisse: somme(lots.filter((r) => r.mode === "CAISSE").map((r) => Number(r.montant))),
      banque: somme(lots.filter((r) => r.mode === "BANQUE").map((r) => Number(r.montant))),
    };
  };
  const retoursDe = (ligneId: string | null | undefined, recus: number): RecapRetours => {
    const lots = retours.filter((r) => ligneId === undefined || r.reglement.ligneDemandeId === ligneId);
    return {
      declares: lots.length,
      recus,
      enAttente: somme(lots.filter((r) => !r.estReceptionne).map((r) => Number(r.montantARetourner))),
      parLaFinance: somme(
        externes.filter((x) => ligneId === undefined || x.ligneDemandeId === ligneId).map((x) => Number(x.montantRetourne))
      ),
    };
  };

  const articles: RecapArticle[] = regul.articles
    .filter((a) => a.statut === "VALIDEE")
    .map((a) => ({
      ligneId: a.ligneId,
      libelle: a.libelleDemandeur,
      beneficiaire: a.beneficiaire,
      montantValide: a.montantValide,
      fonds: fondsDe(a.ligneId),
      retours: retoursDe(a.ligneId, a.agregats.retoursRecus),
      agregats: a.agregats,
      solde: a.ecart,
      etat: a.etat,
      libelleEtat: LIBELLE_ETAT_REGULARISATION[a.etat],
    }));

  const etatTotal = etatTotalRecap(regul.total);
  return {
    articles,
    total: {
      fonds: fondsDe(undefined),
      retours: retoursDe(undefined, regul.total.retoursRecus),
      agregats: regul.total,
      solde: regul.ecartTotal,
      etat: etatTotal,
      libelleEtat: LIBELLE_ETAT_REGULARISATION[etatTotal],
    },
    aucunFonds: centimes(regul.total.fondsRemis) === 0 && regul.nonRattache.fondsRemis === 0,
  };
}
