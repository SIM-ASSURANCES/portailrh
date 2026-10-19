// Budgets de la Trésorerie (lot J, 2026-10-19) : règles PURES, sans accès base — partagées par les actions serveur, les écrans
// (calcul en direct côté client, via `backend/client`), le parcours de l'article et le reporting. Une seule définition :
//   - un paramétrage (budget global ou d'une catégorie) a un montant, une date d'effet (début, fin facultative) et un seuil
//     d'alerte facultatif ; il n'est utilisable qu'une fois VALIDÉ par le DG ;
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

/** Début d'effet des budgets repris par la migration : « depuis toujours » (la consommation passée reste comptée). */
export const DATE_DEBUT_BUDGET_REPRIS = "2000-01-01";

export interface ParametrageBudget {
  id: string;
  portee: PorteeBudget;
  /** Obligatoire pour la portée CATEGORIE, absente pour GLOBAL. */
  categorieId: string | null;
  montant: number;
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
  montant: number;
  dateDebut: string;
  dateFin?: string | null;
  /** Absent/`null` = pas d'alerte pour ce budget. */
  seuil?: { mode: ModeSeuilBudget; orange: number; rouge: number } | null;
}

export type ResultatValidationParametrage =
  | { ok: true; valeur: { portee: PorteeBudget; categorieId: string | null; montant: number; dateDebut: string; dateFin: string | null; seuil: SeuilBudget | null } }
  | { ok: false; erreurs: Record<string, string> };

const MONTANT_MAX = 999_999_999_999.99;

/**
 * Valide la saisie d'un paramétrage. Refuse une saisie incohérente : portée/catégorie, montant ≤ 0, dates invalides, début
 * dans le passé (l'historique n'est jamais réécrit), fin avant le début, seuil dont le rouge n'est pas strictement plus bas
 * que l'orange, pourcentage hors 0–100, seuil en montant supérieur au budget.
 */
export function validerSaisieParametrage(saisie: SaisieParametrage, aujourdhui: string = jourCourantBudget()): ResultatValidationParametrage {
  const erreurs: Record<string, string> = {};

  if (saisie.portee !== "GLOBAL" && saisie.portee !== "CATEGORIE") erreurs.portee = "Portée du budget invalide.";
  const categorieId = saisie.categorieId ? String(saisie.categorieId) : null;
  if (saisie.portee === "CATEGORIE" && !categorieId) erreurs.categorieId = "Choisissez la catégorie concernée.";
  if (saisie.portee === "GLOBAL" && categorieId) erreurs.categorieId = "Le budget global ne porte pas sur une catégorie.";

  const montant = Number(saisie.montant);
  if (!Number.isFinite(montant) || montant <= 0) erreurs.montant = "Le budget doit être supérieur à 0.";
  else if (montant > MONTANT_MAX) erreurs.montant = "Le budget est trop élevé.";
  else if (Math.abs(centimes(montant) / 100 - montant) > 1e-9) erreurs.montant = "Le budget ne peut avoir que deux décimales.";

  if (!jourValide(saisie.dateDebut)) erreurs.dateDebut = "Date de début invalide.";
  else if (saisie.dateDebut < aujourdhui) erreurs.dateDebut = "La date de début ne peut pas être dans le passé : un nouveau budget prend effet à partir d'aujourd'hui.";

  const dateFin = saisie.dateFin ? String(saisie.dateFin) : null;
  if (dateFin !== null) {
    if (!jourValide(dateFin)) erreurs.dateFin = "Date de fin invalide.";
    else if (jourValide(saisie.dateDebut) && dateFin < saisie.dateDebut) erreurs.dateFin = "La date de fin ne peut pas précéder la date de début.";
  }

  let seuil: SeuilBudget | null = null;
  if (saisie.seuil) {
    const { mode } = saisie.seuil;
    const orange = Number(saisie.seuil.orange);
    const rouge = Number(saisie.seuil.rouge);
    if (mode !== "POURCENTAGE" && mode !== "MONTANT") erreurs.seuilMode = "Choisissez « pourcentage restant » ou « montant restant ».";
    else if (!Number.isFinite(orange) || !Number.isFinite(rouge)) erreurs.seuilOrange = "Les deux niveaux d'alerte doivent être renseignés.";
    else if (orange < 0 || rouge < 0) erreurs.seuilOrange = "Les niveaux d'alerte ne peuvent pas être négatifs.";
    else if (rouge >= orange) erreurs.seuilRouge = "Le niveau rouge doit être strictement plus bas que le niveau orange.";
    else if (mode === "POURCENTAGE" && orange > 100) erreurs.seuilOrange = "Un pourcentage ne peut pas dépasser 100.";
    else if (mode === "MONTANT" && Number.isFinite(montant) && montant > 0 && orange > montant) {
      erreurs.seuilOrange = "Le niveau orange ne peut pas dépasser le montant du budget.";
    } else {
      seuil = { mode, orange, rouge };
    }
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    valeur: { portee: saisie.portee, categorieId: saisie.portee === "CATEGORIE" ? categorieId : null, montant, dateDebut: saisie.dateDebut, dateFin, seuil },
  };
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
export interface PerimetreBudget {
  parametrageId: string;
  portee: PorteeBudget;
  categorieId: string | null;
  libelle: string;
  budget: number;
  /** max(consommé au règlement, engagé par les validations) depuis le début d'effet. */
  reserve: number;
  seuil: SeuilBudget | null;
  /** Détail de `reserve` (affichage, reporting) : consommé au règlement et engagé par les validations. */
  consomme?: number;
  engage?: number;
  /** Période du budget en vigueur (AAAA-MM-JJ). */
  dateDebut?: string;
  dateFin?: string | null;
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
}

export interface LignePrevision {
  portee: PorteeBudget;
  categorieId: string | null;
  libelle: string;
  parametrageId: string;
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
  const pct = p.budget > 0 ? Math.round((resteApres / p.budget) * 1000) / 10 : 0;
  return {
    portee: p.portee,
    categorieId: p.categorieId,
    libelle: p.libelle,
    parametrageId: p.parametrageId,
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

/** Phrase d'un périmètre : « Budget global : 1 200 000 FCFA restants après validation (24 %) ». */
export function phrasePerimetre(l: LignePrevision): string {
  const nom = l.portee === "GLOBAL" ? "Budget global" : `Budget « ${l.libelle} »`;
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

/** Lignes de texte de la photo pour le parcours de l'article (budget global puis catégorie). */
export function phrasesSnapshotBudget(s: SnapshotBudgetLigne): string[] {
  const phrase = (nom: string, p: PerimetreSnapshotBudget) =>
    `${nom} : ${p.resteApres < 0 ? `dépassé de ${fmt(Math.abs(p.resteApres))} FCFA` : `reste ${fmt(p.resteApres)} FCFA`} (${p.resteApres < 0 ? "budget de" : `${p.pctRestantApres.toLocaleString("fr-FR")} % de`} ${fmt(p.budget)} FCFA)${p.niveau === "AUCUN" ? "" : ` — ${libelleNiveauBudget(p.niveau).toLowerCase()}`}`;
  return [s.global ? phrase("Budget global", s.global) : null, s.categorie ? phrase(`Budget « ${s.categorie.libelle} »`, s.categorie) : null].filter((x): x is string => !!x);
}
