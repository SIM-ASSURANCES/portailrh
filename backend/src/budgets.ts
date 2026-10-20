// Budgets de la Trésorerie (lot J, 2026-10-19 ; lot J ter, 2026-10-20) : règles PURES, sans accès base — partagées par les actions serveur, les écrans
// (calcul en direct côté client, via `backend/client`), le parcours de l'article et le reporting. Une seule définition :
//   - un paramétrage a une date d'effet (début, fin facultative) et un seuil d'alerte ; il n'est utilisable qu'une fois VALIDÉ par
//     le DG. Une CATÉGORIE a un montant saisi par la Finance (seuil en pourcentage OU en montant restant). Le budget GLOBAL
//     (lot J ter) n'a AUCUN montant saisi : c'est le SOLDE DE CAISSE RÉEL (journal de caisse) ; la Finance ne règle que ses
//     seuils, en montant (FCFA) uniquement, il n'y a pas de total de référence pour un pourcentage ;
//   - un seuil = un mode (pourcentage restant OU montant restant) et deux niveaux, ORANGE puis ROUGE (ROUGE plus bas) ;
//   - le « reste après validation » est PRÉVISIONNEL : budget − réservé − montant validé à cet instant ; il n'écrit rien ;
//   - « réservé » = le plus grand de (consommé au règlement, engagé par les validations) : le budget se consomme au règlement
//     (règle inchangée), mais une validation engage l'argent avant qu'il sorte, sinon le reste ne bougerait qu'au règlement.
// Montants comparés en centimes entiers, jamais en égalité flottante.

// Les énumérations PorteeBudget, ModeSeuilBudget et StatutParametrageBudget viennent du schéma Prisma (types seulement, effacés
// à la compilation : ce module reste pur et sûr pour un Client Component).
import type { ModeSeuilBudget, PorteeBudget, StatutParametrageBudget } from "./generated/prisma/enums";

export type NiveauAlerteBudget = "AUCUN" | "ORANGE" | "ROUGE";

export interface SeuilBudget {
  mode: ModeSeuilBudget;
  /** Premier niveau : pourcentage (0–100) ou montant restant en dessous duquel l'alerte ORANGE se déclenche (inclus). */
  orange: number;
  /** Second niveau, strictement plus bas que l'orange : en dessous (inclus), la validation est bloquée sans accord du DG. */
  rouge: number;
}

/**
 * Seuil posé par la migration sur les budgets déjà existants : orange à 20 % restants, rouge à 0 % (budget épuisé ou
 * dépassé). Choisi pour ne RIEN bloquer au déploiement tant qu'un budget n'est pas épuisé ; la Finance peut le changer par un
 * nouveau paramétrage soumis au DG. La migration SQL reprend ces valeurs.
 */
export const SEUIL_BUDGET_PAR_DEFAUT: SeuilBudget = { mode: "POURCENTAGE", orange: 20, rouge: 0 };

/**
 * Seuils posés par la migration sur un paramétrage GLOBAL du lot J exprimé en pourcentage (le montant saisi est ignoré,
 * un pourcentage n'a pas de sens pour un solde de caisse) : orange à 100 000 FCFA de solde prévisionnel, rouge à 0 FCFA
 * (solde prévisionnel épuisé ou négatif). Choisi pour ne RIEN bloquer au déploiement tant que la caisse n'est pas à sec ;
 * la Finance peut le changer par un nouveau paramétrage soumis au DG. La migration SQL reprend ces valeurs.
 */
export const SEUIL_CAISSE_PAR_DEFAUT: SeuilBudget = { mode: "MONTANT", orange: 100_000, rouge: 0 };

/** Début d'effet des budgets repris par la migration : « depuis toujours » (la consommation passée reste comptée). */
export const DATE_DEBUT_BUDGET_REPRIS = "2000-01-01";

export interface ParametrageBudget {
  id: string;
  portee: PorteeBudget;
  /** Obligatoire pour la portée CATEGORIE, absente pour GLOBAL. */
  categorieId: string | null;
  /** Montant saisi (budget d'une catégorie). `null` pour le budget GLOBAL : c'est le solde de caisse réel, jamais saisi. */
  montant: number | null;
  /** AAAA-MM-JJ, inclus. */
  dateDebut: string;
  /** AAAA-MM-JJ, inclus ; `null` = sans fin. */
  dateFin: string | null;
  /** `null` = aucune alerte (les alertes ne s'appliquent qu'aux budgets ayant un seuil). */
  seuil: SeuilBudget | null;
  statut: StatutParametrageBudget;
  /** Date de décision du DG (départage deux paramétrages de même début). */
  decideAt?: string | null;
}

const centimes = (n: number): number => Math.round(n * 100);

/** Aujourd'hui (AAAA-MM-JJ, jour UTC = jour d'Abidjan). */
export function jourCourantBudget(maintenant: Date = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

const ESTJOUR = /^\d{4}-\d{2}-\d{2}$/;
function jourValide(s: unknown): s is string {
  if (typeof s !== "string" || !ESTJOUR.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---------- Validation d'un paramétrage soumis par la Finance ----------

export interface SaisieParametrage {
  portee: PorteeBudget;
  categorieId?: string | null;
  /** Budget d'une catégorie. Ignoré pour le budget GLOBAL (c'est le solde de caisse réel). */
  montant?: number | null;
  dateDebut: string;
  dateFin?: string | null;
  /** Catégorie : absent/`null` = pas d'alerte. GLOBAL : obligatoire, en MONTANT uniquement. */
  seuil?: { mode: ModeSeuilBudget; orange: number; rouge: number } | null;
}

export type ValeurParametrage = {
  portee: PorteeBudget;
  categorieId: string | null;
  /** `null` pour le budget GLOBAL. */
  montant: number | null;
  dateDebut: string;
  dateFin: string | null;
  seuil: SeuilBudget | null;
};

export type ResultatValidationParametrage = { ok: true; valeur: ValeurParametrage } | { ok: false; erreurs: Record<string, string> };

const MONTANT_MAX = 999_999_999_999.99;

/**
 * Valide la saisie d'un paramétrage. Refuse une saisie incohérente : portée/catégorie, montant ≤ 0 (catégorie), dates
 * invalides, début dans le passé (l'historique n'est jamais réécrit), fin avant le début, seuil dont le rouge n'est pas
 * strictement plus bas que l'orange, pourcentage hors 0–100, seuil en montant supérieur au budget.
 *
 * Budget GLOBAL (lot J ter) : aucun montant (le solde de caisse réel fait foi, tout montant reçu est ignoré), seuils
 * OBLIGATOIRES et en MONTANT uniquement (FCFA) : un pourcentage n'a pas de total de référence.
 */
export function validerSaisieParametrage(saisie: SaisieParametrage, aujourdhui: string = jourCourantBudget()): ResultatValidationParametrage {
  const erreurs: Record<string, string> = {};
  const global = saisie.portee === "GLOBAL";

  if (saisie.portee !== "GLOBAL" && saisie.portee !== "CATEGORIE") erreurs.portee = "Portée du budget invalide.";
  const categorieId = saisie.categorieId ? String(saisie.categorieId) : null;
  if (saisie.portee === "CATEGORIE" && !categorieId) erreurs.categorieId = "Choisissez la catégorie concernée.";
  if (global && categorieId) erreurs.categorieId = "Le budget global ne porte pas sur une catégorie.";

  const montant = Number(saisie.montant);
  if (!global) {
    if (!Number.isFinite(montant) || montant <= 0) erreurs.montant = "Le budget doit être supérieur à 0.";
    else if (montant > MONTANT_MAX) erreurs.montant = "Le budget est trop élevé.";
    else if (Math.abs(centimes(montant) / 100 - montant) > 1e-9) erreurs.montant = "Le budget ne peut avoir que deux décimales.";
  }

  if (!jourValide(saisie.dateDebut)) erreurs.dateDebut = "Date de début invalide.";
  else if (saisie.dateDebut < aujourdhui) erreurs.dateDebut = "La date de début ne peut pas être dans le passé : un nouveau budget prend effet à partir d'aujourd'hui.";

  const dateFin = saisie.dateFin ? String(saisie.dateFin) : null;
  if (dateFin !== null) {
    if (!jourValide(dateFin)) erreurs.dateFin = "Date de fin invalide.";
    else if (jourValide(saisie.dateDebut) && dateFin < saisie.dateDebut) erreurs.dateFin = "La date de fin ne peut pas précéder la date de début.";
  }

  let seuil: SeuilBudget | null = null;
  if (global && !saisie.seuil) erreurs.seuilMode = "Renseignez les seuils d'alerte du solde de caisse (orange puis rouge, en FCFA).";
  if (saisie.seuil) {
    const { mode } = saisie.seuil;
    const orange = Number(saisie.seuil.orange);
    const rouge = Number(saisie.seuil.rouge);
    if (mode !== "POURCENTAGE" && mode !== "MONTANT") erreurs.seuilMode = "Choisissez « pourcentage restant » ou « montant restant ».";
    else if (global && mode !== "MONTANT") erreurs.seuilMode = "Le solde de caisse se règle en montant (FCFA) : un pourcentage n'a pas de total de référence.";
    else if (!Number.isFinite(orange) || !Number.isFinite(rouge)) erreurs.seuilOrange = "Les deux niveaux d'alerte doivent être renseignés.";
    else if (orange < 0 || rouge < 0) erreurs.seuilOrange = "Les niveaux d'alerte ne peuvent pas être négatifs.";
    else if (rouge >= orange) erreurs.seuilRouge = "Le niveau rouge doit être strictement plus bas que le niveau orange.";
    else if (mode === "POURCENTAGE" && orange > 100) erreurs.seuilOrange = "Un pourcentage ne peut pas dépasser 100.";
    else if (!global && mode === "MONTANT" && Number.isFinite(montant) && montant > 0 && orange > montant) {
      erreurs.seuilOrange = "Le niveau orange ne peut pas dépasser le montant du budget.";
    } else {
      seuil = { mode, orange, rouge };
    }
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    valeur: { portee: saisie.portee, categorieId: global ? null : categorieId, montant: global ? null : montant, dateDebut: saisie.dateDebut, dateFin, seuil },
  };
}

export type ResultatValidationLot =
  | { ok: true; valeurs: ValeurParametrage[] }
  | { ok: false; message: string; erreursParIndex: Record<number, Record<string, string>> };

/**
 * Valide une SÉLECTION de paramétrages soumis d'un coup (lot J ter). Tout ou rien : une seule saisie incohérente refuse le lot
 * (les erreurs sont rendues par position, pour les afficher sur la bonne ligne). Un même budget ne peut apparaître qu'une fois
 * dans la sélection (une catégorie, ou le global).
 */
export function validerLotParametrages(saisies: readonly SaisieParametrage[], aujourdhui: string = jourCourantBudget()): ResultatValidationLot {
  if (saisies.length === 0) return { ok: false, message: "Cochez au moins un budget à soumettre.", erreursParIndex: {} };
  const erreursParIndex: Record<number, Record<string, string>> = {};
  const valeurs: ValeurParametrage[] = [];
  const vus = new Set<string>();
  saisies.forEach((saisie, i) => {
    const r = validerSaisieParametrage(saisie, aujourdhui);
    if (!r.ok) {
      erreursParIndex[i] = r.erreurs;
      return;
    }
    const cle = r.valeur.portee === "GLOBAL" ? "GLOBAL" : `CATEGORIE:${r.valeur.categorieId}`;
    if (vus.has(cle)) {
      erreursParIndex[i] = { categorieId: "Ce budget figure déjà dans la sélection." };
      return;
    }
    vus.add(cle);
    valeurs.push(r.valeur);
  });
  if (Object.keys(erreursParIndex).length > 0) {
    const premiere = Object.values(erreursParIndex)[0];
    return { ok: false, message: Object.values(premiere)[0], erreursParIndex };
  }
  return { ok: true, valeurs };
}

// ---------- Budget en vigueur à une date ----------

/**
 * Paramétrage en vigueur au `jour` pour une portée : parmi les paramétrages VALIDÉS dont la période contient le jour, celui
 * dont le début est le plus récent (un nouveau paramétrage REMPLACE l'ancien à sa date d'effet, sans le modifier ; en cas de
 * même début, la décision la plus récente l'emporte). Un paramétrage EN_ATTENTE ou REFUSÉ n'est jamais pris en compte.
 */
export function budgetEnVigueur(
  parametrages: readonly ParametrageBudget[],
  portee: PorteeBudget,
  categorieId: string | null,
  jour: string = jourCourantBudget()
): ParametrageBudget | null {
  let retenu: ParametrageBudget | null = null;
  for (const p of parametrages) {
    if (p.statut !== "VALIDE" || p.portee !== portee) continue;
    if (portee === "CATEGORIE" && p.categorieId !== categorieId) continue;
    if (p.dateDebut > jour) continue;
    if (p.dateFin !== null && p.dateFin < jour) continue;
    if (
      retenu === null ||
      p.dateDebut > retenu.dateDebut ||
      (p.dateDebut === retenu.dateDebut && (p.decideAt ?? "") > (retenu.decideAt ?? ""))
    ) {
      retenu = p;
    }
  }
  return retenu;
}

// ---------- Seuils ----------

/** Niveau d'alerte pour un reste donné. Sans seuil : AUCUN. Comparaison inclusive (reste ≤ seuil). */
export function niveauAlerte(reste: number, budget: number, seuil: SeuilBudget | null): NiveauAlerteBudget {
  if (!seuil) return "AUCUN";
  const resteC = centimes(reste);
  if (seuil.mode === "POURCENTAGE") {
    const budgetC = centimes(budget);
    if (budgetC <= 0) return "ROUGE";
    // reste / budget ≤ seuil / 100, sans division flottante
    if (resteC * 100 <= budgetC * seuil.rouge) return "ROUGE";
    if (resteC * 100 <= budgetC * seuil.orange) return "ORANGE";
    return "AUCUN";
  }
  if (resteC <= centimes(seuil.rouge)) return "ROUGE";
  if (resteC <= centimes(seuil.orange)) return "ORANGE";
  return "AUCUN";
}

const ORDRE_NIVEAU: Record<NiveauAlerteBudget, number> = { AUCUN: 0, ORANGE: 1, ROUGE: 2 };
export function niveauLePlusGrave(...niveaux: NiveauAlerteBudget[]): NiveauAlerteBudget {
  return niveaux.reduce<NiveauAlerteBudget>((m, n) => (ORDRE_NIVEAU[n] > ORDRE_NIVEAU[m] ? n : m), "AUCUN");
}

export function libelleNiveauBudget(n: NiveauAlerteBudget): string {
  return n === "ROUGE" ? "Alerte rouge" : n === "ORANGE" ? "Alerte orange" : "Dans la limite";
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

/** « 20 % restants » / « 2 000 000 FCFA restants » */
export function libelleNiveauSeuil(valeur: number, mode: ModeSeuilBudget): string {
  return mode === "POURCENTAGE" ? `${valeur.toLocaleString("fr-FR")} % restants` : `${fmt(valeur)} FCFA restants`;
}

export function libelleSeuil(seuil: SeuilBudget | null): string {
  if (!seuil) return "Aucune alerte";
  return `Orange à ${libelleNiveauSeuil(seuil.orange, seuil.mode)}, rouge à ${libelleNiveauSeuil(seuil.rouge, seuil.mode)}`;
}

// ---------- Prévisionnel à la validation ----------

/** Un périmètre budgétaire tel que chargé en base : le budget en vigueur et ce qui est déjà réservé dessus. */
/**
 * Ce que contient le « budget global » = solde de caisse (lot J ter). Le solde vient du journal de caisse réel
 * (`getSoldeCaisse`) ; les deux engagements sont ce qui est DÉJÀ validé et pas encore sorti de la caisse :
 *   - `engageCaisseConnu` : règlements en mode CAISSE créés (brouillons) mais pas encore confirmés — mode connu ;
 *   - `engageModeInconnu` : montants validés (articles, dépenses directes) qui n'ont encore AUCUN règlement — le mode
 *     (Caisse ou Banque) n'est choisi qu'au règlement, on ne peut donc PAS savoir à la validation quelle part sortira de la
 *     caisse : on suppose Caisse (hypothèse prudente, le reste affiché est une borne basse).
 * Un règlement BANQUE (brouillon ou confirmé) ne compte jamais ; un règlement CAISSE confirmé est déjà dans le solde.
 */
export interface DetailCaisse {
  soldeCaisse: number;
  engageCaisseConnu: number;
  engageModeInconnu: number;
}

export interface PerimetreBudget {
  /** Paramétrage en vigueur ; `null` pour le global quand aucun paramétrage de seuils n'est en vigueur (le solde s'affiche, sans alerte). */
  parametrageId: string | null;
  portee: PorteeBudget;
  categorieId: string | null;
  libelle: string;
  /** Catégorie : budget saisi. Global : le SOLDE DE CAISSE réel (jamais saisi). */
  budget: number;
  /** Catégorie : max(consommé au règlement, engagé par les validations) depuis le début d'effet. Global : engagé non sorti de la caisse. */
  reserve: number;
  seuil: SeuilBudget | null;
  /** Global seulement : composition du solde prévisionnel (affichage, reporting). */
  caisse?: DetailCaisse;
  /** Détail de `reserve` (affichage, reporting) : consommé au règlement et engagé par les validations. */
  consomme?: number;
  engage?: number;
  /** Période du budget en vigueur (AAAA-MM-JJ). */
  dateDebut?: string;
  dateFin?: string | null;
}

/** Libellé du périmètre global. */
export const LIBELLE_SOLDE_CAISSE = "Solde de caisse";

/**
 * Périmètre du budget GLOBAL = solde de caisse (lot J ter). Reste avant validation = solde réel − engagé non sorti de la
 * caisse ; la validation en cours s'y retranche (voir `previsionBudget`). Les seuils (montant uniquement) viennent du
 * paramétrage en vigueur ; sans paramétrage validé, le solde s'affiche mais aucune alerte ne se déclenche.
 */
export function perimetreCaisse(detail: DetailCaisse, parametrage: Pick<ParametrageBudget, "id" | "seuil" | "dateDebut" | "dateFin"> | null): PerimetreBudget {
  return {
    parametrageId: parametrage?.id ?? null,
    portee: "GLOBAL",
    categorieId: null,
    libelle: LIBELLE_SOLDE_CAISSE,
    budget: detail.soldeCaisse,
    reserve: (centimes(detail.engageCaisseConnu) + centimes(detail.engageModeInconnu)) / 100,
    // Un seuil en pourcentage n'a pas de sens ici : s'il en reste un (donnée héritée), il est ignoré.
    seuil: parametrage?.seuil && parametrage.seuil.mode === "MONTANT" ? parametrage.seuil : null,
    caisse: detail,
    dateDebut: parametrage?.dateDebut,
    dateFin: parametrage?.dateFin,
  };
}

export interface ContexteBudget {
  global: PerimetreBudget | null;
  /** Par identifiant de catégorie (seulement les catégories qui ont un budget en vigueur). */
  categories: Readonly<Record<string, PerimetreBudget>>;
}

/** Montant qu'une validation ajoute (article ou dépense directe) ; `categorieId` nul = article non catégorisé. */
export interface AjoutBudget {
  categorieId: string | null;
  montant: number;
  /** Lot J bis : article concerné (nul pour une dépense directe, qui n'a pas d'article) — sert à rattacher la couverture du règlement. */
  ligneId?: string | null;
}

export interface LignePrevision {
  portee: PorteeBudget;
  categorieId: string | null;
  libelle: string;
  parametrageId: string | null;
  /** Global seulement : solde de caisse, engagé connu / inconnu. */
  caisse?: DetailCaisse;
  budget: number;
  reserveAvant: number;
  /** Montant ajouté par CETTE validation sur ce périmètre. */
  ajout: number;
  resteAvant: number;
  /** Reste après la validation — jamais plafonné à 0 : négatif = dépassement. */
  resteApres: number;
  /** Pourcentage restant après la validation (arrondi à 0,1). */
  pctRestantApres: number;
  seuil: SeuilBudget | null;
  niveauAvant: NiveauAlerteBudget;
  /** Niveau après la validation ; AUCUN quand la validation n'ajoute rien à ce périmètre. */
  niveau: NiveauAlerteBudget;
}

export interface PrevisionBudget {
  global: LignePrevision | null;
  categories: LignePrevision[];
  /** Le plus grave des niveaux de tous les périmètres touchés. */
  niveau: NiveauAlerteBudget;
}

function lignePrevision(p: PerimetreBudget, ajout: number): LignePrevision {
  const resteAvant = (centimes(p.budget) - centimes(p.reserve)) / 100;
  const resteApres = (centimes(p.budget) - centimes(p.reserve) - centimes(ajout)) / 100;
  // Un pourcentage n'a pas de sens pour le solde de caisse (aucun total de référence) : toujours 0 pour le global.
  const pct = p.portee === "GLOBAL" ? 0 : p.budget > 0 ? Math.round((resteApres / p.budget) * 1000) / 10 : 0;
  return {
    portee: p.portee,
    categorieId: p.categorieId,
    libelle: p.libelle,
    parametrageId: p.parametrageId,
    ...(p.caisse ? { caisse: p.caisse } : {}),
    budget: p.budget,
    reserveAvant: p.reserve,
    ajout,
    resteAvant,
    resteApres,
    pctRestantApres: pct,
    seuil: p.seuil,
    niveauAvant: niveauAlerte(resteAvant, p.budget, p.seuil),
    // Une validation qui n'ajoute rien à ce périmètre ne le met pas en alerte.
    niveau: ajout > 0 ? niveauAlerte(resteApres, p.budget, p.seuil) : "AUCUN",
  };
}

/** Prévisionnel (aucune écriture) d'un ensemble de montants validés ensemble. */
export function previsionBudget(contexte: ContexteBudget, ajouts: readonly AjoutBudget[]): PrevisionBudget {
  const total = ajouts.reduce((s, a) => s + centimes(a.montant), 0) / 100;
  const global = contexte.global ? lignePrevision(contexte.global, total) : null;

  const parCategorie = new Map<string, number>();
  for (const a of ajouts) {
    if (!a.categorieId) continue;
    parCategorie.set(a.categorieId, (centimes(parCategorie.get(a.categorieId) ?? 0) + centimes(a.montant)) / 100);
  }
  const categories: LignePrevision[] = [];
  for (const [categorieId, ajout] of parCategorie) {
    const perimetre = contexte.categories[categorieId];
    if (perimetre) categories.push(lignePrevision(perimetre, ajout));
  }
  categories.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  return { global, categories, niveau: niveauLePlusGrave(global?.niveau ?? "AUCUN", ...categories.map((c) => c.niveau)) };
}

// ---------- Lot J bis : la confirmation du DG couvre aussi le règlement de l'article ----------

/**
 * Montant qu'une confirmation du DG couvre, par article (ou pour la dépense directe, `ligneId` nul) et par catégorie : exactement
 * ce que la validation ajoute à une catégorie arrivée au seuil rouge. Enregistré (JSON) sur le `BudgetDepassement` utilisé.
 */
export interface CouvertureDepassement {
  ligneId: string | null;
  categorieId: string;
  montant: number;
}

/** Couverture d'une validation : les ajouts des seules catégories qui atteignent le seuil rouge (les autres n'ont rien à couvrir). */
export function couvertureDepuisAjouts(prevision: PrevisionBudget, ajouts: readonly AjoutBudget[]): CouvertureDepassement[] {
  const rouges = new Set(prevision.categories.filter((c) => c.niveau === "ROUGE" && c.categorieId).map((c) => c.categorieId as string));
  const cumul = new Map<string, CouvertureDepassement>();
  for (const a of ajouts) {
    if (!a.categorieId || !rouges.has(a.categorieId) || !(a.montant > 0)) continue;
    const cle = `${a.ligneId ?? ""}|${a.categorieId}`;
    const existant = cumul.get(cle);
    cumul.set(cle, {
      ligneId: a.ligneId ?? null,
      categorieId: a.categorieId,
      montant: ((existant ? centimes(existant.montant) : 0) + centimes(a.montant)) / 100,
    });
  }
  return [...cumul.values()];
}

/** Relit la couverture enregistrée (JSON de la base) ; toute entrée mal formée est ignorée. */
export function lireCouverture(brut: unknown): CouvertureDepassement[] {
  if (!Array.isArray(brut)) return [];
  const resultat: CouvertureDepassement[] = [];
  for (const e of brut) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const montant = Number(o.montant);
    if (typeof o.categorieId !== "string" || !o.categorieId || !Number.isFinite(montant) || montant <= 0) continue;
    resultat.push({ ligneId: typeof o.ligneId === "string" && o.ligneId ? o.ligneId : null, categorieId: o.categorieId, montant });
  }
  return resultat;
}

/**
 * Lot K : un article validé avec dépassement confirmé est REPRIS (retour à la Finance). Sa part de la confirmation du DG devient
 * caduque : on la retire de la couverture ; les autres articles de la même confirmation gardent la leur. Revalider l'article exige
 * une NOUVELLE confirmation (une confirmation est à usage unique). Renvoie la couverture restante et le montant retiré.
 */
export function retirerCouvertureArticle(
  couvertures: readonly CouvertureDepassement[],
  ligneId: string
): { restante: CouvertureDepassement[]; retire: number } {
  const retire = couvertures.filter((c) => c.ligneId === ligneId).reduce((s, c) => s + centimes(c.montant), 0) / 100;
  return { restante: couvertures.filter((c) => c.ligneId !== ligneId), retire };
}

/** Total couvert pour un article (ou la dépense directe si `ligneId` est nul) dans une catégorie. */
export function totalCouvert(couvertures: readonly CouvertureDepassement[], ligneId: string | null, categorieId: string): number {
  return couvertures.filter((c) => c.ligneId === ligneId && c.categorieId === categorieId).reduce((s, c) => s + centimes(c.montant), 0) / 100;
}

/**
 * Part d'un règlement que la confirmation du DG couvre, et part qui doit encore passer le contrôle du budget de la catégorie.
 * `dejaRegle` : ce que les règlements déjà confirmés de l'article (non annulés) ont déjà consommé dans cette catégorie. Un règlement
 * au-delà du montant confirmé n'est donc jamais couvert pour l'excédent : celui-ci doit tenir dans le reste du budget.
 */
export function partieCouverteReglement(p: { montant: number; couvertureTotale: number; dejaRegle: number }): { couvert: number; aControler: number } {
  const disponible = Math.max(0, centimes(p.couvertureTotale) - centimes(p.dejaRegle));
  const couvert = Math.min(centimes(p.montant), disponible);
  return { couvert: couvert / 100, aControler: (centimes(p.montant) - couvert) / 100 };
}

// ---------- Verdict : alerte orange, blocage rouge, confirmation du DG ----------

export const MOTIF_DEPASSEMENT_MIN = 10;

export interface EntreeVerdictBudget {
  prevision: PrevisionBudget;
  /** L'acteur est le DG (`treso.decider_dg`) : seul à pouvoir confirmer un dépassement rouge. */
  acteurEstDG: boolean;
  /** Motif saisi par le DG dans le geste de validation (rouge). */
  motifConfirmation?: string | null;
  /** Une confirmation du DG déjà donnée pour cette demande et pas encore utilisée. */
  confirmationExistante: boolean;
}

export type VerdictBudget =
  | { autorise: true; niveau: NiveauAlerteBudget; alerteOrange: boolean; confirmationRequise: false; utiliseConfirmationExistante: boolean; motifConfirme: string | null }
  | { autorise: false; niveau: "ROUGE"; confirmationRequise: true; raison: string; motifInvalide: boolean };

/**
 * ORANGE : on valide, l'alerte est visible et notifiée. ROUGE : bloqué tant que le DG n'a pas confirmé le dépassement avec un
 * motif (≥ 10 caractères) ; si c'est le DG qui valide, il confirme lui-même dans le même geste ; une validation de la Finance
 * passe seulement s'il existe déjà une confirmation du DG pour cette demande. Seul le DG confirme.
 */
export function verdictBudget(e: EntreeVerdictBudget): VerdictBudget {
  const niveau = e.prevision.niveau;
  if (niveau !== "ROUGE") {
    return { autorise: true, niveau, alerteOrange: niveau === "ORANGE", confirmationRequise: false, utiliseConfirmationExistante: false, motifConfirme: null };
  }
  const motif = (e.motifConfirmation ?? "").trim();
  if (e.acteurEstDG) {
    if (motif.length >= MOTIF_DEPASSEMENT_MIN) {
      return { autorise: true, niveau: "ROUGE", alerteOrange: false, confirmationRequise: false, utiliseConfirmationExistante: false, motifConfirme: motif };
    }
    return {
      autorise: false,
      niveau: "ROUGE",
      confirmationRequise: true,
      motifInvalide: true,
      raison: `Seuil rouge atteint : confirmez le dépassement du budget avec un motif d'au moins ${MOTIF_DEPASSEMENT_MIN} caractères pour valider.`,
    };
  }
  if (e.confirmationExistante) {
    return { autorise: true, niveau: "ROUGE", alerteOrange: false, confirmationRequise: false, utiliseConfirmationExistante: true, motifConfirme: null };
  }
  return {
    autorise: false,
    niveau: "ROUGE",
    confirmationRequise: true,
    motifInvalide: false,
    raison: "Seuil rouge atteint : la validation est bloquée tant que le DG n'a pas confirmé le dépassement du budget. Demandez sa confirmation.",
  };
}

// ---------- Textes (écran, notifications, historique) ----------

/** Phrase d'un périmètre : « Budget « Transport » : 1 200 000 FCFA restants après cette validation (24 % …) ». */
export function phrasePerimetre(l: LignePrevision): string {
  if (l.portee === "GLOBAL") {
    return l.resteApres < 0
      ? `Solde de caisse prévisionnel NÉGATIF de ${fmt(Math.abs(l.resteApres))} FCFA après cette validation (solde actuel ${fmt(l.budget)} FCFA)`
      : `Solde de caisse prévisionnel : ${fmt(l.resteApres)} FCFA après cette validation (solde actuel ${fmt(l.budget)} FCFA)`;
  }
  const nom = `Budget « ${l.libelle} »`;
  const reste = l.resteApres < 0 ? `dépassé de ${fmt(Math.abs(l.resteApres))} FCFA` : `${fmt(l.resteApres)} FCFA restants`;
  return l.resteApres < 0
    ? `${nom} : ${reste} après cette validation (budget de ${fmt(l.budget)} FCFA)`
    : `${nom} : ${reste} après cette validation (${l.pctRestantApres.toLocaleString("fr-FR")} % du budget de ${fmt(l.budget)} FCFA)`;
}

/** Une ligne par périmètre en alerte (pour un message ou un historique). */
export function phrasesAlertes(p: PrevisionBudget): string[] {
  return [p.global, ...p.categories]
    .filter((l): l is LignePrevision => !!l && l.niveau !== "AUCUN")
    .map((l) => `${l.niveau === "ROUGE" ? "ROUGE" : "ORANGE"} — ${phrasePerimetre(l)}`);
}

/** Texte de l'état d'un paramétrage pour les listes. */
export function libelleStatutParametrage(s: StatutParametrageBudget): string {
  return s === "VALIDE" ? "Validé par le DG" : s === "REFUSE" ? "Refusé par le DG" : "En attente du DG";
}

/** Période lisible : « du 19/10/2026 » / « du 19/10/2026 au 31/12/2026 ». */
export function libellePeriodeBudget(dateDebut: string, dateFin: string | null): string {
  const fr = (d: string) => d.split("-").reverse().join("/");
  if (dateDebut === DATE_DEBUT_BUDGET_REPRIS && dateFin === null) return "depuis toujours (budget repris)";
  return dateFin ? `du ${fr(dateDebut)} au ${fr(dateFin)}` : `à partir du ${fr(dateDebut)}`;
}

/**
 * Ligne de paramétrage qu'une migration crée pour un budget de catégorie existant : validé d'office par le DG, sans date de
 * fin, avec le seuil par défaut. La migration SQL applique exactement ces valeurs.
 */
export function parametrageDepuisBudgetExistant(
  categorieId: string,
  budgetAlloue: number
): Pick<ParametrageBudget, "portee" | "categorieId" | "montant" | "dateDebut" | "dateFin" | "seuil" | "statut"> {
  return {
    portee: "CATEGORIE",
    categorieId,
    montant: budgetAlloue,
    dateDebut: DATE_DEBUT_BUDGET_REPRIS,
    dateFin: null,
    seuil: { ...SEUIL_BUDGET_PAR_DEFAUT },
    statut: "VALIDE",
  };
}

/**
 * Conversion (lot J ter) d'un paramétrage GLOBAL du lot J — montant saisi, seuil en pourcentage ou en montant — vers le budget
 * global = solde de caisse. Le montant saisi est IGNORÉ (`null`) ; un seuil en montant est conservé tel quel ; un seuil en
 * pourcentage (sans sens ici) est remplacé par `SEUIL_CAISSE_PAR_DEFAUT` ; un paramétrage sans seuil reste sans seuil (aucune
 * alerte globale tant que le DG n'a pas validé de seuils). Le statut, la période et la trace de décision sont conservés.
 * La migration SQL `20261024090000` applique exactement ces règles.
 */
export function convertirParametrageGlobalLotJ<T extends { montant: number | null; seuil: SeuilBudget | null }>(ancien: T): T {
  const seuil = ancien.seuil === null ? null : ancien.seuil.mode === "MONTANT" ? ancien.seuil : { ...SEUIL_CAISSE_PAR_DEFAUT };
  return { ...ancien, montant: null, seuil };
}

// ---------- Photo du budget après la validation d'un article ----------

export interface PerimetreSnapshotBudget {
  libelle: string;
  budget: number;
  resteApres: number;
  pctRestantApres: number;
  niveau: NiveauAlerteBudget;
}

/** Ce qui est conservé sur l'article à sa validation : reste du budget global et de sa catégorie après la décision. */
export interface SnapshotBudgetLigne {
  global: PerimetreSnapshotBudget | null;
  categorie: PerimetreSnapshotBudget | null;
  niveau: NiveauAlerteBudget;
}

const versSnapshot = (l: LignePrevision): PerimetreSnapshotBudget => ({
  libelle: l.libelle,
  budget: l.budget,
  resteApres: l.resteApres,
  pctRestantApres: l.pctRestantApres,
  niveau: l.niveau,
});

/** Photo pour un article de catégorie `categorieId` à partir du prévisionnel de la décision qui l'a validé ; `null` sans budget concerné. */
export function snapshotBudgetLigne(prevision: PrevisionBudget, categorieId: string | null): SnapshotBudgetLigne | null {
  const categorie = categorieId ? prevision.categories.find((c) => c.categorieId === categorieId) ?? null : null;
  if (!prevision.global && !categorie) return null;
  return {
    global: prevision.global ? versSnapshot(prevision.global) : null,
    categorie: categorie ? versSnapshot(categorie) : null,
    niveau: niveauLePlusGrave(prevision.global?.niveau ?? "AUCUN", categorie?.niveau ?? "AUCUN"),
  };
}

/** Relit la photo stockée (JSON) sans jamais lever : une forme inattendue vaut « pas de photo ». */
export function lireSnapshotBudget(valeur: unknown): SnapshotBudgetLigne | null {
  if (!valeur || typeof valeur !== "object") return null;
  const o = valeur as Record<string, unknown>;
  const perim = (x: unknown): PerimetreSnapshotBudget | null => {
    if (!x || typeof x !== "object") return null;
    const p = x as Record<string, unknown>;
    if (typeof p.libelle !== "string" || typeof p.budget !== "number" || typeof p.resteApres !== "number" || typeof p.pctRestantApres !== "number") return null;
    const niveau = p.niveau === "ORANGE" || p.niveau === "ROUGE" ? p.niveau : "AUCUN";
    return { libelle: p.libelle, budget: p.budget, resteApres: p.resteApres, pctRestantApres: p.pctRestantApres, niveau };
  };
  const global = perim(o.global);
  const categorie = perim(o.categorie);
  if (!global && !categorie) return null;
  return { global, categorie, niveau: o.niveau === "ORANGE" || o.niveau === "ROUGE" ? o.niveau : "AUCUN" };
}

/** Lignes de texte de la photo pour le parcours de l'article (solde de caisse prévisionnel, puis budget de la catégorie). */
export function phrasesSnapshotBudget(s: SnapshotBudgetLigne): string[] {
  const suffixe = (p: PerimetreSnapshotBudget) => (p.niveau === "AUCUN" ? "" : ` — ${libelleNiveauBudget(p.niveau).toLowerCase()}`);
  const caisse = (p: PerimetreSnapshotBudget) =>
    `${p.resteApres < 0 ? `Solde de caisse prévisionnel négatif de ${fmt(Math.abs(p.resteApres))} FCFA` : `Solde de caisse prévisionnel : ${fmt(p.resteApres)} FCFA`}${suffixe(p)}`;
  const categorie = (p: PerimetreSnapshotBudget) =>
    `Budget « ${p.libelle} » : ${p.resteApres < 0 ? `dépassé de ${fmt(Math.abs(p.resteApres))} FCFA` : `reste ${fmt(p.resteApres)} FCFA`} (${p.resteApres < 0 ? "budget de" : `${p.pctRestantApres.toLocaleString("fr-FR")} % de`} ${fmt(p.budget)} FCFA)${suffixe(p)}`;
  return [s.global ? caisse(s.global) : null, s.categorie ? categorie(s.categorie) : null].filter((x): x is string => !!x);
}
