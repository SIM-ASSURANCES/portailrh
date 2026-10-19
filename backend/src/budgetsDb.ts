// Budgets (lot J) — couche base : chargement des paramétrages et de ce qui est déjà réservé, contrôle à la validation (alerte
// orange, blocage rouge, confirmation du DG), paramétrage soumis/validé/refusé, demandes de confirmation de dépassement.
// Toutes les RÈGLES sont dans `budgets.ts` (pur) ; ici seulement la lecture et l'écriture.

import { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import {
  budgetEnVigueur,
  jourCourantBudget,
  MOTIF_DEPASSEMENT_MIN,
  phrasesAlertes,
  previsionBudget,
  validerSaisieParametrage,
  verdictBudget,
  type AjoutBudget,
  type ContexteBudget,
  type ParametrageBudget,
  type PerimetreBudget,
  type PrevisionBudget,
  type SaisieParametrage,
  type VerdictBudget,
} from "./budgets";
import { getMontantConsommeCategorie } from "./tresorerie";

type Db = Prisma.TransactionClient | typeof prisma;

export const ENTITE_BUDGET = "BudgetParametrage";
export const ACTION_BUDGET = {
  SOUMIS: "budget_soumis",
  VALIDE: "budget_valide",
  REFUSE: "budget_refuse",
} as const;
/** Actions d'historique posées sur la DEMANDE (gestion interne : jamais montrées au demandeur). */
export const ACTION_HISTORIQUE_BUDGET = {
  ALERTE: "alerte_budget",
  CONFIRMATION: "confirmation_depassement_budget",
  DEMANDE_CONFIRMATION: "demande_confirmation_depassement",
  UTILISE: "depassement_budget_utilise",
} as const;

const jour = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const debutDeJour = (j: string) => new Date(`${j}T00:00:00.000Z`);
const num = (v: Prisma.Decimal | number | string | null | undefined): number => (v == null ? 0 : Number(v));

// ---------- Lecture ----------

type LigneParametrage = Prisma.BudgetParametrageGetPayload<{ include: { categorie: { select: { label: true } } } }>;

export function versParametrage(p: LigneParametrage | Prisma.BudgetParametrageGetPayload<object>): ParametrageBudget {
  return {
    id: p.id,
    portee: p.portee,
    categorieId: p.categorieId,
    montant: Number(p.montant),
    dateDebut: p.dateDebut.toISOString().slice(0, 10),
    dateFin: jour(p.dateFin),
    seuil: p.modeSeuil && p.seuilOrange != null && p.seuilRouge != null ? { mode: p.modeSeuil, orange: Number(p.seuilOrange), rouge: Number(p.seuilRouge) } : null,
    statut: p.statut,
    decideAt: p.decideAt ? p.decideAt.toISOString() : null,
  };
}

/** Tous les paramétrages (tout statut). Volume modeste : un par catégorie et par période. */
export async function chargerParametrages(db: Db = prisma): Promise<ParametrageBudget[]> {
  return (await db.budgetParametrage.findMany()).map(versParametrage);
}

/** Consommé au règlement depuis le début d'effet : règlements confirmés et non annulés (Caisse ET Banque pour le global). */
async function consommeDepuis(db: Db, categorieId: string | null, debut: string): Promise<number> {
  if (categorieId) return getMontantConsommeCategorie(categorieId, debutDeJour(debut));
  const r = await db.reglement.aggregate({
    where: { estConfirme: true, estAnnule: false, confirmeAt: { gte: debutDeJour(debut) } },
    _sum: { montant: true },
  });
  return num(r._sum.montant);
}

/**
 * Engagé par les validations depuis le début d'effet : articles VALIDÉS (date de décision) ou validés par le DG et en attente
 * de la confirmation de la Finance (date de la décision du DG), plus le montant validé des dépenses directes (date de
 * création : la date de validation d'une dépense directe n'est pas enregistrée). Pour une catégorie, seulement les articles
 * et dépenses directes catégorisés dans celle-ci.
 */
async function engageDepuis(db: Db, categorieId: string | null, debut: string): Promise<number> {
  const debutDate = debutDeJour(debut);
  const filtreCategorie = categorieId ? Prisma.sql`AND l."categorieId" = ${categorieId}` : Prisma.empty;
  const lignes = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM(l."quantite" * l."prixUnitaire"), 0) AS total
    FROM "LigneDemande" l
    WHERE (
      (l."statutValidation" = 'VALIDEE' AND l."decideAt" >= ${debutDate})
      OR (l."statutValidation" = 'EN_ATTENTE' AND l."decisionDG" = 'VALIDEE' AND l."decisionDGAt" >= ${debutDate})
    ) ${filtreCategorie}`;
  const directes = await db.demande.aggregate({
    where: {
      typeDemande: "DEPENSE_DIRECTE",
      statut: { notIn: ["REJETEE", "ABANDONNEE"] },
      createdAt: { gte: debutDate },
      ...(categorieId ? { categorieId } : {}),
    },
    _sum: { montantValide: true },
  });
  return num(lignes[0]?.total) + num(directes._sum.montantValide);
}

async function perimetre(db: Db, p: ParametrageBudget, libelle: string): Promise<PerimetreBudget> {
  const [consomme, engage] = await Promise.all([consommeDepuis(db, p.categorieId, p.dateDebut), engageDepuis(db, p.categorieId, p.dateDebut)]);
  return {
    parametrageId: p.id,
    portee: p.portee,
    categorieId: p.categorieId,
    libelle,
    budget: p.montant,
    reserve: Math.max(consomme, engage),
    seuil: p.seuil,
    consomme,
    engage,
    dateDebut: p.dateDebut,
    dateFin: p.dateFin,
  };
}

/**
 * Budgets EN VIGUEUR aujourd'hui (global + catégories demandées, ou toutes celles qui en ont un) avec ce qui est réservé.
 * Un seul chargement partagé par les actions de validation, les écrans, le parcours et le reporting.
 */
export async function chargerContexteBudget(db: Db = prisma, maintenant: Date = new Date(), categorieIds?: readonly string[]): Promise<ContexteBudget> {
  const aujourdhui = jourCourantBudget(maintenant);
  const parametrages = await chargerParametrages(db);
  const global = budgetEnVigueur(parametrages, "GLOBAL", null, aujourdhui);
  const idsCategories = categorieIds
    ? Array.from(new Set(categorieIds))
    : Array.from(new Set(parametrages.filter((p) => p.portee === "CATEGORIE" && p.categorieId).map((p) => p.categorieId as string)));
  const enVigueur = idsCategories
    .map((id) => budgetEnVigueur(parametrages, "CATEGORIE", id, aujourdhui))
    .filter((p): p is ParametrageBudget => !!p);
  const libelles = new Map(
    (await db.categorie.findMany({ where: { id: { in: enVigueur.map((p) => p.categorieId as string) } }, select: { id: true, label: true } })).map((c) => [c.id, c.label])
  );
  const [pGlobal, pCategories] = await Promise.all([
    global ? perimetre(db, global, "Global") : Promise.resolve(null),
    Promise.all(enVigueur.map((p) => perimetre(db, p, libelles.get(p.categorieId as string) ?? "Catégorie"))),
  ]);
  return { global: pGlobal, categories: Object.fromEntries(pCategories.map((p) => [p.categorieId as string, p])) };
}

/** Budget restant d'une catégorie (budget en vigueur − consommé au règlement depuis son début), `null` si aucun budget en vigueur. Jamais plafonné à 0. */
export async function getBudgetRestantCategorie(categorieId: string, db: Db = prisma): Promise<number | null> {
  const parametrages = await chargerParametrages(db);
  const p = budgetEnVigueur(parametrages, "CATEGORIE", categorieId, jourCourantBudget());
  if (!p) return null;
  return p.montant - (await consommeDepuis(db, categorieId, p.dateDebut));
}

export interface BudgetCategorieEnVigueur {
  parametrageId: string;
  budget: number;
  /** Consommé au règlement depuis le début d'effet (règlements confirmés et non annulés). */
  consomme: number;
  /** `budget − consommé`, jamais plafonné à 0 (négatif = dépassement réel). */
  restant: number;
  seuil: ParametrageBudget["seuil"];
  dateDebut: string;
  dateFin: string | null;
}

/** Budgets de catégorie en vigueur, par identifiant de catégorie : source UNIQUE du contrôle de règlement, du dashboard, du reporting et de l'aperçu de catégorisation. */
export async function getBudgetsCategoriesEnVigueur(db: Db = prisma, maintenant: Date = new Date()): Promise<Record<string, BudgetCategorieEnVigueur>> {
  const aujourdhui = jourCourantBudget(maintenant);
  const parametrages = await chargerParametrages(db);
  const ids = Array.from(new Set(parametrages.filter((p) => p.portee === "CATEGORIE" && p.categorieId).map((p) => p.categorieId as string)));
  const enVigueur = ids.map((id) => budgetEnVigueur(parametrages, "CATEGORIE", id, aujourdhui)).filter((p): p is ParametrageBudget => !!p);
  const consommes = await Promise.all(enVigueur.map((p) => consommeDepuis(db, p.categorieId, p.dateDebut)));
  return Object.fromEntries(
    enVigueur.map((p, i) => [
      p.categorieId as string,
      { parametrageId: p.id, budget: p.montant, consomme: consommes[i], restant: p.montant - consommes[i], seuil: p.seuil, dateDebut: p.dateDebut, dateFin: p.dateFin },
    ])
  );
}

// ---------- Contrôle à la validation ----------

/** Montants que valident ces articles (ceux déjà validés par le DG sont déjà engagés : on ne les recompte pas à la confirmation de la Finance). */
export async function ajoutsPourArticles(db: Db, demandeId: string, ligneIds: readonly string[]): Promise<AjoutBudget[]> {
  const lignes = await db.ligneDemande.findMany({
    where: { demandeId, id: { in: [...ligneIds] }, statutValidation: "EN_ATTENTE" },
    select: { categorieId: true, quantite: true, prixUnitaire: true, decisionDG: true },
  });
  return lignes
    .filter((l) => l.decisionDG !== "VALIDEE")
    .map((l) => ({ categorieId: l.categorieId, montant: Math.round(l.quantite * Number(l.prixUnitaire) * 100) / 100 }));
}

export interface ParamControleBudget {
  demandeId: string;
  ajouts: readonly AjoutBudget[];
  acteurId: string;
  /** L'acteur porte `treso.decider_dg` : seul à confirmer un dépassement rouge. */
  acteurEstDG: boolean;
  /** Motif du DG (dépassement rouge), saisi dans le même geste que la validation. */
  motifConfirmation?: string | null;
  maintenant?: Date;
}

export type ResultatControleBudget =
  | { ok: true; prevision: PrevisionBudget; verdict: Extract<VerdictBudget, { autorise: true }>; alertes: string[] }
  | { ok: false; message: string; prevision: PrevisionBudget; verdict: Extract<VerdictBudget, { autorise: false }> };

/**
 * Contrôle budgétaire d'une validation, dans la transaction de l'appelant (verrou : deux validations simultanées voient le
 * même reste, l'une après l'autre). Calcule le prévisionnel, applique le verdict et trace : alerte orange/rouge dans
 * l'historique de la demande ; confirmation du DG (motif) créée dans le même geste, ou confirmation déjà donnée consommée.
 * Aucun budget en vigueur ou rien à valider : sans effet.
 */
export async function controlerBudgetValidation(db: Prisma.TransactionClient, p: ParamControleBudget): Promise<ResultatControleBudget> {
  const maintenant = p.maintenant ?? new Date();
  const ajouts = p.ajouts.filter((a) => a.montant > 0);
  const vide: PrevisionBudget = { global: null, categories: [], niveau: "AUCUN" };
  const ok = (prevision: PrevisionBudget, verdict: Extract<VerdictBudget, { autorise: true }>): ResultatControleBudget => ({ ok: true, prevision, verdict, alertes: phrasesAlertes(prevision) });
  const aucun: Extract<VerdictBudget, { autorise: true }> = { autorise: true, niveau: "AUCUN", alerteOrange: false, confirmationRequise: false, utiliseConfirmationExistante: false, motifConfirme: null };
  if (ajouts.length === 0) return ok(vide, aucun);

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('budget'))`;
  const contexte = await chargerContexteBudget(db, maintenant, ajouts.map((a) => a.categorieId).filter((c): c is string => !!c));
  const prevision = previsionBudget(contexte, ajouts);
  if (prevision.global === null && prevision.categories.length === 0) return ok(prevision, aucun);

  const confirmation = await db.budgetDepassement.findFirst({ where: { demandeId: p.demandeId, statut: "CONFIRME" }, orderBy: { confirmeAt: "asc" } });
  const verdict = verdictBudget({ prevision, acteurEstDG: p.acteurEstDG, motifConfirmation: p.motifConfirmation, confirmationExistante: !!confirmation });
  if (!verdict.autorise) {
    return { ok: false, message: `${verdict.raison} ${phrasesAlertes(prevision).join(" ; ")}`.trim(), prevision, verdict };
  }

  const resume = phrasesAlertes(prevision).join(" ; ");
  if (prevision.niveau !== "AUCUN") {
    await db.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: p.demandeId,
        action: ACTION_HISTORIQUE_BUDGET.ALERTE,
        detail: `Alerte budget à la validation — ${resume}`,
        userId: p.acteurId,
      },
    });
  }
  if (verdict.motifConfirme) {
    await db.budgetDepassement.create({
      data: {
        demandeId: p.demandeId,
        statut: "UTILISE",
        resume,
        demandeParId: p.acteurId,
        confirmeParId: p.acteurId,
        confirmeAt: maintenant,
        motif: verdict.motifConfirme,
        utiliseAt: maintenant,
      },
    });
    await db.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: p.demandeId,
        action: ACTION_HISTORIQUE_BUDGET.CONFIRMATION,
        detail: `Le DG confirme le dépassement du seuil rouge en validant — motif : ${verdict.motifConfirme} — ${resume}`,
        userId: p.acteurId,
      },
    });
  } else if (verdict.utiliseConfirmationExistante && confirmation) {
    const maj = await db.budgetDepassement.updateMany({ where: { id: confirmation.id, statut: "CONFIRME" }, data: { statut: "UTILISE", utiliseAt: maintenant } });
    if (maj.count !== 1) {
      return {
        ok: false,
        message: "La confirmation du DG a déjà été utilisée : redemandez-la.",
        prevision,
        verdict: { autorise: false, niveau: "ROUGE", confirmationRequise: true, motifInvalide: false, raison: "La confirmation du DG a déjà été utilisée : redemandez-la." },
      };
    }
    await db.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: p.demandeId,
        action: ACTION_HISTORIQUE_BUDGET.UTILISE,
        detail: `Validation avec dépassement du seuil rouge, confirmé par le DG (motif : ${confirmation.motif ?? "—"}) — ${resume}`,
        userId: p.acteurId,
      },
    });
  }
  return ok(prevision, verdict);
}

// ---------- Confirmation d'un dépassement : demande de la Finance, confirmation du DG ----------

const ERREUR = (message: string) => ({ ok: false as const, message });

/** La Finance demande au DG de confirmer le dépassement (prévisionnel de la sélection en cours). Une seule demande ouverte par demande. */
export async function demanderConfirmationDepassement(
  demandeId: string,
  ajouts: readonly AjoutBudget[],
  userId: string
): Promise<{ ok: true; resume: string; reference: string } | { ok: false; message: string }> {
  return prisma.$transaction(async (tx) => {
    const demande = await tx.demande.findUnique({ where: { id: demandeId }, select: { reference: true } });
    if (!demande) return ERREUR("Demande introuvable.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('budget'))`;
    const ouvertes = await tx.budgetDepassement.count({ where: { demandeId, statut: { in: ["DEMANDE", "CONFIRME"] } } });
    if (ouvertes > 0) return ERREUR("Une confirmation du DG est déjà demandée ou donnée pour cette demande.");
    const contexte = await chargerContexteBudget(tx, new Date(), ajouts.map((a) => a.categorieId).filter((c): c is string => !!c));
    const prevision = previsionBudget(contexte, ajouts.filter((a) => a.montant > 0));
    if (prevision.niveau !== "ROUGE") return ERREUR("Cette validation n'atteint pas le seuil rouge : aucune confirmation du DG n'est nécessaire.");
    const resume = phrasesAlertes(prevision).join(" ; ");
    await tx.budgetDepassement.create({ data: { demandeId, statut: "DEMANDE", resume, demandeParId: userId } });
    await tx.historiqueEntry.create({
      data: { entity: "Demande", entityId: demandeId, action: ACTION_HISTORIQUE_BUDGET.DEMANDE_CONFIRMATION, detail: `Confirmation du DG demandée (seuil rouge) — ${resume}`, userId },
    });
    return { ok: true as const, resume, reference: demande.reference };
  });
}

/** Le DG confirme le dépassement demandé, avec un motif obligatoire (≥ 10 caractères). Seul le DG (revérifié par l'appelant). */
export async function confirmerDepassementBudget(
  id: string,
  motif: string,
  userId: string
): Promise<{ ok: true; demandeId: string; reference: string; demandeParId: string } | { ok: false; message: string }> {
  const m = (motif ?? "").trim();
  if (m.length < MOTIF_DEPASSEMENT_MIN) return ERREUR(`Le motif de la confirmation est obligatoire (${MOTIF_DEPASSEMENT_MIN} caractères minimum).`);
  return prisma.$transaction(async (tx) => {
    const d = await tx.budgetDepassement.findUnique({ where: { id }, include: { demande: { select: { reference: true } } } });
    if (!d) return ERREUR("Demande de confirmation introuvable.");
    const maj = await tx.budgetDepassement.updateMany({ where: { id, statut: "DEMANDE" }, data: { statut: "CONFIRME", confirmeParId: userId, confirmeAt: new Date(), motif: m } });
    if (maj.count !== 1) return ERREUR("Cette demande de confirmation a déjà été traitée.");
    await tx.historiqueEntry.create({
      data: { entity: "Demande", entityId: d.demandeId, action: ACTION_HISTORIQUE_BUDGET.CONFIRMATION, detail: `Le DG confirme le dépassement du seuil rouge — motif : ${m} — ${d.resume}`, userId },
    });
    return { ok: true as const, demandeId: d.demandeId, reference: d.demande.reference, demandeParId: d.demandeParId };
  });
}

// ---------- Paramétrage : soumission par la Finance, décision du DG ----------

export type ResultatParametrage = { ok: true; id: string } | { ok: false; message: string; erreurs?: Record<string, string> };

const fr = (j: string) => j.split("-").reverse().join("/");
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/** La Finance soumet un paramétrage au DG (statut EN_ATTENTE : sans effet tant que le DG ne l'a pas validé). */
export async function soumettreParametrageBudget(saisie: SaisieParametrage, userId: string, maintenant: Date = new Date()): Promise<ResultatParametrage> {
  const r = validerSaisieParametrage(saisie, jourCourantBudget(maintenant));
  if (!r.ok) return { ok: false, message: Object.values(r.erreurs)[0], erreurs: r.erreurs };
  const v = r.valeur;
  return prisma.$transaction(async (tx) => {
    let libelle = "global";
    if (v.categorieId) {
      const c = await tx.categorie.findUnique({ where: { id: v.categorieId }, select: { label: true } });
      if (!c) return { ok: false as const, message: "Catégorie introuvable." };
      libelle = `de la catégorie « ${c.label} »`;
    }
    const enAttente = await tx.budgetParametrage.count({ where: { portee: v.portee, categorieId: v.categorieId, statut: "EN_ATTENTE" } });
    if (enAttente > 0) {
      return { ok: false as const, message: "Un paramétrage est déjà en attente de validation du DG pour ce budget : attendez sa décision avant d'en soumettre un autre." };
    }
    const cree = await tx.budgetParametrage.create({
      data: {
        portee: v.portee,
        categorieId: v.categorieId,
        montant: v.montant,
        dateDebut: debutDeJour(v.dateDebut),
        dateFin: v.dateFin ? debutDeJour(v.dateFin) : null,
        modeSeuil: v.seuil?.mode ?? null,
        seuilOrange: v.seuil?.orange ?? null,
        seuilRouge: v.seuil?.rouge ?? null,
        soumisParId: userId,
        soumisAt: maintenant,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: ENTITE_BUDGET,
        entityId: cree.id,
        action: ACTION_BUDGET.SOUMIS,
        detail:
          `Budget ${libelle} soumis au DG : ${fcfa(v.montant)}, ${fr(v.dateDebut)}${v.dateFin ? ` → ${fr(v.dateFin)}` : " (sans fin)"}` +
          (v.seuil ? `, seuil ${v.seuil.mode === "POURCENTAGE" ? `${v.seuil.orange} % / ${v.seuil.rouge} %` : `${fcfa(v.seuil.orange)} / ${fcfa(v.seuil.rouge)}`}` : ", sans alerte"),
        userId,
      },
    });
    return { ok: true as const, id: cree.id };
  });
}

/** Le DG valide ou refuse (motif obligatoire au refus). Jamais le compte qui a soumis. Le paramétrage n'est jamais modifié, seulement décidé. */
export async function deciderParametrageBudget(
  id: string,
  valider: boolean,
  motif: string | null | undefined,
  userId: string,
  maintenant: Date = new Date()
): Promise<{ ok: true; categorieId: string | null; portee: "GLOBAL" | "CATEGORIE"; soumisParId: string | null } | { ok: false; message: string }> {
  const m = (motif ?? "").trim();
  if (!valider && m.length < 3) return ERREUR("Le motif du refus est obligatoire (3 caractères minimum).");
  return prisma.$transaction(async (tx) => {
    const p = await tx.budgetParametrage.findUnique({ where: { id }, include: { categorie: { select: { label: true } } } });
    if (!p) return ERREUR("Paramétrage introuvable.");
    if (p.soumisParId === userId) return ERREUR("Vous ne pouvez pas décider un paramétrage que vous avez vous-même soumis.");
    const maj = await tx.budgetParametrage.updateMany({
      where: { id, statut: "EN_ATTENTE" },
      data: { statut: valider ? "VALIDE" : "REFUSE", decideParId: userId, decideAt: maintenant, motifRefus: valider ? null : m },
    });
    if (maj.count !== 1) return ERREUR("Ce paramétrage a déjà été décidé.");
    const nom = p.categorie ? `de la catégorie « ${p.categorie.label} »` : "global";
    await tx.historiqueEntry.create({
      data: {
        entity: ENTITE_BUDGET,
        entityId: id,
        action: valider ? ACTION_BUDGET.VALIDE : ACTION_BUDGET.REFUSE,
        detail: valider
          ? `Budget ${nom} de ${fcfa(Number(p.montant))} validé par le DG — effectif à partir du ${fr(p.dateDebut.toISOString().slice(0, 10))}`
          : `Budget ${nom} de ${fcfa(Number(p.montant))} refusé par le DG — motif : ${m}`,
        userId,
      },
    });
    return { ok: true as const, categorieId: p.categorieId, portee: p.portee, soumisParId: p.soumisParId };
  });
}
