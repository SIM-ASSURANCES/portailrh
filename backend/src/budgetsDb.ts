// Budgets (lots J et J ter) — couche base : chargement des paramétrages et de ce qui est déjà réservé, contrôle à la validation (alerte
// orange, blocage rouge, confirmation du DG), paramétrage soumis/validé/refusé, demandes de confirmation de dépassement.
// Toutes les RÈGLES sont dans `budgets.ts` (pur) ; ici seulement la lecture et l'écriture.

import { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import {
  budgetEnVigueur,
  jourCourantBudget,
  MOTIF_DEPASSEMENT_MIN,
  perimetreCaisse,
  phrasesAlertes,
  previsionBudget,
  validerLotParametrages,
  verdictBudget,
  type AjoutBudget,
  type ContexteBudget,
  type DetailCaisse,
  type ParametrageBudget,
  type PerimetreBudget,
  type PrevisionBudget,
  type SaisieParametrage,
  type ValeurParametrage,
  type VerdictBudget,
} from "./budgets";
import { getMontantConsommeCategorie, getSoldeCaisse } from "./tresorerie";

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
    montant: p.montant == null ? null : Number(p.montant),
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

/** Consommé au règlement d'une CATÉGORIE depuis le début d'effet : règlements confirmés et non annulés (Caisse et Banque). */
async function consommeDepuis(_db: Db, categorieId: string, debut: string): Promise<number> {
  return getMontantConsommeCategorie(categorieId, debutDeJour(debut));
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

/**
 * Budget GLOBAL = solde de caisse (lot J ter). Le solde vient du journal de caisse (`getSoldeCaisse`, jamais modifié). Ce qui est
 * DÉJÀ validé et n'est pas encore sorti de la caisse s'y retranche :
 *   - `engageCaisseConnu` : règlements en mode CAISSE créés mais non confirmés (brouillons) — le mode est connu ;
 *   - `engageModeInconnu` : par demande ouverte (ni rejetée, ni clôturée, ni abandonnée), montants validés (articles validés,
 *     articles validés par le DG en attente de la Finance, montant validé d'une dépense directe) moins les règlements non annulés
 *     de la demande, toute nature et tout mode — il ne reste que l'argent validé SANS règlement. Le mode n'étant choisi qu'au
 *     règlement, on ne peut pas savoir à la validation quelle part sortira de la caisse : on la suppose en Caisse (hypothèse
 *     prudente — le reste affiché est une borne basse).
 * Un règlement Banque (brouillon ou confirmé) ne compte jamais ; un règlement Caisse confirmé est déjà dans le solde.
 */
export async function chargerDetailCaisse(db: Db = prisma): Promise<DetailCaisse> {
  const [solde, brouillonsCaisse, sansReglement] = await Promise.all([
    db === prisma ? getSoldeCaisse() : soldeCaisseDans(db),
    db.reglement.aggregate({ where: { mode: "CAISSE", estConfirme: false, estAnnule: false }, _sum: { montant: true } }),
    db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(GREATEST(0, v."valide" - COALESCE(r."regle", 0))), 0) AS total
      FROM (
        SELECT d."id" AS "demandeId", SUM(l."quantite" * l."prixUnitaire") AS "valide"
        FROM "Demande" d
        JOIN "LigneDemande" l ON l."demandeId" = d."id"
        WHERE d."statut" NOT IN ('REJETEE', 'CLOTUREE', 'ABANDONNEE')
          AND (l."statutValidation" = 'VALIDEE' OR (l."statutValidation" = 'EN_ATTENTE' AND l."decisionDG" = 'VALIDEE'))
        GROUP BY d."id"
        UNION ALL
        SELECT d."id", d."montantValide"
        FROM "Demande" d
        WHERE d."typeDemande" = 'DEPENSE_DIRECTE' AND d."statut" NOT IN ('REJETEE', 'CLOTUREE', 'ABANDONNEE') AND d."montantValide" > 0
      ) v
      LEFT JOIN (
        SELECT "demandeId", SUM("montant") AS "regle" FROM "Reglement" WHERE "estAnnule" = false GROUP BY "demandeId"
      ) r ON r."demandeId" = v."demandeId"`,
  ]);
  return { soldeCaisse: solde, engageCaisseConnu: num(brouillonsCaisse._sum.montant), engageModeInconnu: num(sansReglement[0]?.total) };
}

/** Même formule que `getSoldeCaisse()`, lue dans la transaction de l'appelant (mêmes écritures `JournalCaisse`). */
async function soldeCaisseDans(db: Db): Promise<number> {
  const [entrees, sorties] = await Promise.all([
    db.journalCaisse.aggregate({ where: { type: "ENTREE" }, _sum: { montant: true } }),
    db.journalCaisse.aggregate({ where: { type: "SORTIE" }, _sum: { montant: true } }),
  ]);
  return num(entrees._sum.montant) - num(sorties._sum.montant);
}

async function perimetre(db: Db, p: ParametrageBudget, libelle: string): Promise<PerimetreBudget> {
  const [consomme, engage] = await Promise.all([consommeDepuis(db, p.categorieId as string, p.dateDebut), engageDepuis(db, p.categorieId, p.dateDebut)]);
  return {
    parametrageId: p.id,
    portee: p.portee,
    categorieId: p.categorieId,
    libelle,
    budget: p.montant ?? 0,
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
  // Budget global = solde de caisse réel (lot J ter) : toujours présent, avec les seuils du paramétrage en vigueur (aucun seuil
  // validé = le solde s'affiche, aucune alerte).
  const [detailCaisse, pCategories] = await Promise.all([
    chargerDetailCaisse(db),
    Promise.all(enVigueur.map((p) => perimetre(db, p, libelles.get(p.categorieId as string) ?? "Catégorie"))),
  ]);
  return { global: perimetreCaisse(detailCaisse, global), categories: Object.fromEntries(pCategories.map((p) => [p.categorieId as string, p])) };
}

/** Budget restant d'une catégorie (budget en vigueur − consommé au règlement depuis son début), `null` si aucun budget en vigueur. Jamais plafonné à 0. */
export async function getBudgetRestantCategorie(categorieId: string, db: Db = prisma): Promise<number | null> {
  const parametrages = await chargerParametrages(db);
  const p = budgetEnVigueur(parametrages, "CATEGORIE", categorieId, jourCourantBudget());
  if (!p) return null;
  return (p.montant ?? 0) - (await consommeDepuis(db, categorieId, p.dateDebut));
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
  const consommes = await Promise.all(enVigueur.map((p) => consommeDepuis(db, p.categorieId as string, p.dateDebut)));
  return Object.fromEntries(
    enVigueur.map((p, i) => [
      p.categorieId as string,
      { parametrageId: p.id, budget: p.montant ?? 0, consomme: consommes[i], restant: (p.montant ?? 0) - consommes[i], seuil: p.seuil, dateDebut: p.dateDebut, dateFin: p.dateFin },
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

// ---------- Paramétrage : soumission par la Finance (seul ou en lot), décision du DG (seul ou en lot) ----------

export type ResultatParametrage = { ok: true; id: string } | { ok: false; message: string; erreurs?: Record<string, string> };

export type ResultatSoumissionLot =
  | { ok: true; ids: string[]; resume: string }
  | { ok: false; message: string; erreursParIndex?: Record<number, Record<string, string>> };

const fr = (j: string) => j.split("-").reverse().join("/");
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

function detailSeuil(v: Pick<ValeurParametrage, "seuil">): string {
  return v.seuil ? `seuil ${v.seuil.mode === "POURCENTAGE" ? `${v.seuil.orange} % / ${v.seuil.rouge} %` : `${fcfa(v.seuil.orange)} / ${fcfa(v.seuil.rouge)}`}` : "sans alerte";
}

function descriptionBudget(v: ValeurParametrage, libelleCategorie: string | null): string {
  return v.portee === "GLOBAL"
    ? `seuils du solde de caisse (budget global) : ${detailSeuil(v)}`
    : `budget de la catégorie « ${libelleCategorie ?? "?"} » : ${fcfa(v.montant ?? 0)}, ${detailSeuil(v)}`;
}

/**
 * La Finance soumet UN OU PLUSIEURS paramétrages d'un coup au DG (statut EN_ATTENTE : sans effet tant que le DG ne les a pas
 * validés). Tout ou rien : une saisie incohérente, un budget déjà en attente du DG ou une catégorie introuvable refuse toute la
 * sélection. Chaque paramétrage garde sa propre trace dans l'historique. Le budget global ne porte que des seuils (montant
 * FCFA) : le solde de caisse réel fait foi.
 */
export async function soumettreParametragesBudget(saisies: readonly SaisieParametrage[], userId: string, maintenant: Date = new Date()): Promise<ResultatSoumissionLot> {
  const r = validerLotParametrages(saisies, jourCourantBudget(maintenant));
  if (!r.ok) {
    const erreurs = Object.values(r.erreursParIndex);
    return { ok: false, message: r.message, erreursParIndex: erreurs.length > 0 ? r.erreursParIndex : undefined };
  }
  return prisma.$transaction(async (tx) => {
    // Verrou : deux soumissions simultanées ne peuvent pas toutes les deux passer le contrôle « déjà en attente ».
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('budget-parametrage'))`;

    // 1re passe : tout contrôler AVANT d'écrire quoi que ce soit — tout ou rien (rien n'est créé si une seule ligne est refusée).
    const libelles = new Map<string, string>();
    for (const v of r.valeurs) {
      if (v.categorieId) {
        const c = await tx.categorie.findUnique({ where: { id: v.categorieId }, select: { label: true } });
        if (!c) return { ok: false as const, message: "Catégorie introuvable." };
        libelles.set(v.categorieId, c.label);
      }
      const enAttente = await tx.budgetParametrage.count({ where: { portee: v.portee, categorieId: v.categorieId, statut: "EN_ATTENTE" } });
      if (enAttente > 0) {
        return {
          ok: false as const,
          message: `Un paramétrage est déjà en attente de validation du DG pour ${v.portee === "GLOBAL" ? "les seuils du solde de caisse" : `la catégorie « ${libelles.get(v.categorieId as string)} »`} : attendez sa décision avant d'en soumettre un autre.`,
        };
      }
    }

    // 2e passe : un paramétrage et une trace d'historique PAR élément.
    const ids: string[] = [];
    const morceaux: string[] = [];
    for (const v of r.valeurs) {
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
      const description = descriptionBudget(v, v.categorieId ? (libelles.get(v.categorieId) ?? null) : null);
      await tx.historiqueEntry.create({
        data: {
          entity: ENTITE_BUDGET,
          entityId: cree.id,
          action: ACTION_BUDGET.SOUMIS,
          detail: `Soumis au DG : ${description}, ${fr(v.dateDebut)}${v.dateFin ? ` → ${fr(v.dateFin)}` : " (sans fin)"}`,
          userId,
        },
      });
      ids.push(cree.id);
      morceaux.push(description);
    }
    return { ok: true as const, ids, resume: morceaux.join(" ; ") };
  });
}

/** Un seul paramétrage : cas particulier du lot (conservé pour les appelants qui soumettent un budget seul). */
export async function soumettreParametrageBudget(saisie: SaisieParametrage, userId: string, maintenant: Date = new Date()): Promise<ResultatParametrage> {
  const r = await soumettreParametragesBudget([saisie], userId, maintenant);
  if (!r.ok) return { ok: false, message: r.message, erreurs: r.erreursParIndex?.[0] };
  return { ok: true, id: r.ids[0] };
}

export interface DecisionParametrageLot {
  id: string;
  /** Motif propre à cet élément (refus) ; à défaut, le motif commun du lot. */
  motif?: string | null;
}

export type ResultatDecisionLot =
  | {
      ok: true;
      /** Éléments réellement décidés. */
      decides: { id: string; portee: "GLOBAL" | "CATEGORIE"; description: string; soumisParId: string | null; motif: string | null }[];
      /** Éléments laissés tels quels (déjà décidés, soumis par le décideur lui-même, introuvables) avec la raison. */
      ignores: { id: string; message: string }[];
    }
  | { ok: false; message: string };

/**
 * Le DG valide ou refuse UN OU PLUSIEURS paramétrages d'un coup. Motif obligatoire au refus (3 caractères minimum), propre à
 * chaque élément ou commun au lot. Chaque élément garde sa propre trace dans l'historique et son propre statut. Le DG ne décide
 * jamais ce qu'il a lui-même soumis : cet élément est ignoré (avec sa raison), les autres sont décidés. Un élément déjà décidé
 * (ou décidé entre-temps par un autre) est aussi ignoré : la décision est conditionnée au statut EN_ATTENTE lu.
 */
export async function deciderParametragesBudget(
  elements: readonly DecisionParametrageLot[],
  valider: boolean,
  motifCommun: string | null | undefined,
  userId: string,
  maintenant: Date = new Date()
): Promise<ResultatDecisionLot> {
  if (elements.length === 0) return ERREUR("Cochez au moins un paramétrage.");
  const ids = new Set<string>();
  for (const e of elements) {
    if (ids.has(e.id)) return ERREUR("Un même paramétrage figure deux fois dans la sélection.");
    ids.add(e.id);
  }
  const commun = (motifCommun ?? "").trim();
  const motifs = new Map<string, string>();
  if (!valider) {
    for (const e of elements) {
      const m = (e.motif ?? "").trim() || commun;
      if (m.length < 3) return ERREUR("Le motif du refus est obligatoire (3 caractères minimum), pour chaque élément ou en commun.");
      motifs.set(e.id, m);
    }
  }
  return prisma.$transaction(async (tx) => {
    const decides: Extract<ResultatDecisionLot, { ok: true }>["decides"] = [];
    const ignores: { id: string; message: string }[] = [];
    for (const e of elements) {
      const p = await tx.budgetParametrage.findUnique({ where: { id: e.id }, include: { categorie: { select: { label: true } } } });
      if (!p) {
        ignores.push({ id: e.id, message: "Paramétrage introuvable." });
        continue;
      }
      const nom = p.portee === "GLOBAL" ? "solde de caisse (seuils du budget global)" : `catégorie « ${p.categorie?.label ?? "?"} »`;
      if (p.soumisParId === userId) {
        ignores.push({ id: e.id, message: `${nom} : vous ne pouvez pas décider un paramétrage que vous avez vous-même soumis.` });
        continue;
      }
      const motif = valider ? null : (motifs.get(e.id) as string);
      const maj = await tx.budgetParametrage.updateMany({
        where: { id: e.id, statut: "EN_ATTENTE" },
        data: { statut: valider ? "VALIDE" : "REFUSE", decideParId: userId, decideAt: maintenant, motifRefus: motif },
      });
      if (maj.count !== 1) {
        ignores.push({ id: e.id, message: `${nom} : déjà décidé.` });
        continue;
      }
      const detail = descriptionBudget(
        { portee: p.portee, categorieId: p.categorieId, montant: p.montant == null ? null : Number(p.montant), dateDebut: "", dateFin: null, seuil: p.modeSeuil && p.seuilOrange != null && p.seuilRouge != null ? { mode: p.modeSeuil, orange: Number(p.seuilOrange), rouge: Number(p.seuilRouge) } : null },
        p.categorie?.label ?? null
      );
      await tx.historiqueEntry.create({
        data: {
          entity: ENTITE_BUDGET,
          entityId: e.id,
          action: valider ? ACTION_BUDGET.VALIDE : ACTION_BUDGET.REFUSE,
          detail: valider
            ? `Validé par le DG : ${detail} — effectif à partir du ${fr(p.dateDebut.toISOString().slice(0, 10))}`
            : `Refusé par le DG : ${detail} — motif : ${motif}`,
          userId,
        },
      });
      decides.push({ id: e.id, portee: p.portee, description: detail, soumisParId: p.soumisParId, motif });
    }
    if (decides.length === 0 && ignores.length > 0) return { ok: false as const, message: ignores.map((i) => i.message).join(" ") };
    return { ok: true as const, decides, ignores };
  });
}

/** Un seul paramétrage : cas particulier du lot. */
export async function deciderParametrageBudget(
  id: string,
  valider: boolean,
  motif: string | null | undefined,
  userId: string,
  maintenant: Date = new Date()
): Promise<{ ok: true; categorieId: string | null; portee: "GLOBAL" | "CATEGORIE"; soumisParId: string | null } | { ok: false; message: string }> {
  const r = await deciderParametragesBudget([{ id }], valider, motif, userId, maintenant);
  if (!r.ok) return { ok: false, message: r.message };
  const d = r.decides[0];
  const p = await prisma.budgetParametrage.findUnique({ where: { id }, select: { categorieId: true } });
  return { ok: true, categorieId: p?.categorieId ?? null, portee: d.portee, soumisParId: d.soumisParId };
}
