import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";
import { syntheseContratCreanceCpt } from "./cptCreances";
import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import {
  evaluerPromesseCpt,
  relanceProposeeAvecPromessesCpt,
  validerPromesseCpt,
  validerRelanceCpt,
  type CanalRelanceCpt,
  type ErreursRelanceCpt,
  type SaisiePromesseCpt,
  type SaisieRelanceCpt,
  type StatutPromesseCpt,
} from "./cptRelances";

/**
 * Relances et promesses de paiement d'un client (lot GC-7d, Q10 option A, PROVISOIRE : rien n'est envoyé). Les écritures se font dans la
 * transaction de l'appelant avec leur ligne `CptAudit`. Le reste dû d'un client et l'encaissé prouvé viennent des mêmes sources que
 * le reste du module (`syntheseContratCreanceCpt`, rattachements `VALIDE`) : jamais un second calcul.
 */
export type RelancesClientDbCpt = Pick<PrismaClient, "cptClient" | "cptContrat" | "cptRelance" | "cptPromesse" | "cptRattachement" | "cptAudit">;

export type ResultatEcritureRelanceCpt = { ok: true; message: string } | { ok: false; message: string; erreurs?: ErreursRelanceCpt };

const ZERO = BigInt(0);
const jourDe = (d: Date) => d.toISOString().slice(0, 10);
const enDate = (jour: string) => new Date(`${jour}T00:00:00Z`);

/** Reste dû d'un client (centimes) et nombre d'échéances en retard, sur ses contrats non annulés. */
async function situationClient(db: RelancesClientDbCpt, clientId: string, aujourdhui: string): Promise<{ resteDu: bigint; nbEnRetard: number }> {
  const contrats = await db.cptContrat.findMany({
    where: { clientId, statut: { not: "ANNULE" } },
    select: { statut: true, declarePaye: true, echeances: { select: { rang: true, etat: true, datePrevue: true, montantDu: true, montantRegle: true } } },
  });
  let resteDu = ZERO;
  let nbEnRetard = 0;
  for (const c of contrats) {
    const s = syntheseContratCreanceCpt(
      { statut: c.statut, declarePaye: c.declarePaye, echeances: c.echeances.map((e) => ({ rang: e.rang, etat: e.etat, datePrevue: jourDe(e.datePrevue), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() })) },
      aujourdhui
    );
    resteDu += s.resteDu;
    nbEnRetard += s.nbEcheancesEnRetard;
  }
  return { resteDu, nbEnRetard };
}

export interface SaisieRelanceEtPromesseCpt extends SaisieRelanceCpt {
  /** Facultatif : une promesse de paiement obtenue lors de cette relance. */
  promesseMontant?: unknown;
  promesseDate?: unknown;
}

/** Enregistre une relance faite hors de l'application, et la promesse qu'elle a obtenue s'il y en a une. Audit dans la même transaction. */
export async function enregistrerRelanceCpt(
  db: RelancesClientDbCpt,
  entree: { clientId: string; saisie: SaisieRelanceEtPromesseCpt; userId: string; ip: string | null; aujourdhui: string }
): Promise<ResultatEcritureRelanceCpt> {
  const client = await db.cptClient.findUnique({ where: { id: entree.clientId }, select: { id: true, nom: true } });
  if (!client) return { ok: false, message: "Client introuvable." };
  const relance = validerRelanceCpt(entree.saisie, entree.aujourdhui);
  const avecPromesse = String(entree.saisie.promesseMontant ?? "").trim() !== "" || String(entree.saisie.promesseDate ?? "").trim() !== "";
  let erreurs: ErreursRelanceCpt = relance.ok ? {} : { ...relance.erreurs };
  let promesse: { montant: bigint; datePromise: string } | null = null;
  if (avecPromesse) {
    const { resteDu } = await situationClient(db, client.id, entree.aujourdhui);
    const p = validerPromesseCpt({ montant: entree.saisie.promesseMontant, datePromise: entree.saisie.promesseDate } satisfies SaisiePromesseCpt, entree.aujourdhui, resteDu);
    if (p.ok) promesse = p.valeur;
    else erreurs = { ...erreurs, ...Object.fromEntries(Object.entries(p.erreurs).map(([k, v]) => [k === "montant" ? "promesseMontant" : "promesseDate", v])) };
  }
  if (!relance.ok || Object.keys(erreurs).length > 0) return { ok: false, message: Object.values(erreurs)[0] ?? "Saisie invalide.", erreurs };

  const creee = await db.cptRelance.create({
    data: { clientId: client.id, canal: relance.valeur.canal, faiteLe: enDate(relance.valeur.faiteLe), commentaire: relance.valeur.commentaire, creeParId: entree.userId },
  });
  await ecrireAudit(db, { entite: "CptRelance", entiteId: creee.id, action: "relance", apres: { clientId: client.id, canal: creee.canal, faiteLe: relance.valeur.faiteLe, commentaire: relance.valeur.commentaire }, userId: entree.userId, ip: entree.ip });
  if (promesse) {
    const p = await db.cptPromesse.create({
      data: { clientId: client.id, relanceId: creee.id, montant: texteDepuisCentimes(promesse.montant), datePromise: enDate(promesse.datePromise), creeParId: entree.userId },
    });
    await ecrireAudit(db, { entite: "CptPromesse", entiteId: p.id, action: "promesse", apres: { clientId: client.id, montant: texteDepuisCentimes(promesse.montant), datePromise: promesse.datePromise }, userId: entree.userId, ip: entree.ip });
  }
  return { ok: true, message: promesse ? "Relance et promesse de paiement enregistrées." : "Relance enregistrée." };
}

/** Encaissé prouvé du client : rattachements VALIDE sur ses contrats, dont la date de valeur est dans [depuis, jusqu'à] (jours AAAA-MM-JJ, inclus). */
async function prouveSurPeriode(db: RelancesClientDbCpt, clientId: string, depuis: string, jusqua: string): Promise<bigint> {
  const lignes = await db.cptRattachement.findMany({
    where: { statut: "VALIDE", echeance: { contrat: { clientId } }, encaissement: { dateValeur: { gte: enDate(depuis), lte: enDate(jusqua) } } },
    select: { montant: true },
  });
  return lignes.reduce((s, r) => s + (enCentimesEcheancier(r.montant.toString()) ?? ZERO), ZERO);
}

export interface PromesseSuiviCpt {
  id: string;
  montant: string;
  datePromise: Date;
  statut: StatutPromesseCpt;
  creeAt: Date;
  evalueAt: Date | null;
  montantProuve: string | null;
  /** Verdict de la règle, calculé à l'instant (jamais écrit) : seulement pour une promesse encore EN COURS. */
  verdictActuel: StatutPromesseCpt | null;
  prouveActuel: string | null;
}

/** Évalue les promesses EN COURS (d'un client, ou de tous) par la règle et écrit les statuts qui changent. Audit `evaluation_promesse` par promesse. */
export async function evaluerPromessesCpt(
  db: RelancesClientDbCpt,
  entree: { userId: string; ip: string | null; aujourdhui: string; clientId?: string }
): Promise<{ evaluees: number; tenues: number; nonTenues: number }> {
  const promesses = await db.cptPromesse.findMany({ where: { statut: "EN_COURS", ...(entree.clientId ? { clientId: entree.clientId } : {}) }, orderBy: { creeAt: "asc" }, take: 2000 });
  let tenues = 0;
  let nonTenues = 0;
  for (const p of promesses) {
    const prouve = await prouveSurPeriode(db, p.clientId, jourDe(p.creeAt), jourDe(p.datePromise));
    const verdict = evaluerPromesseCpt({ montant: enCentimesEcheancier(p.montant.toString()) ?? ZERO, datePromise: jourDe(p.datePromise), prouve }, entree.aujourdhui);
    if (verdict === "EN_COURS") continue;
    const r = await db.cptPromesse.updateMany({ where: { id: p.id, statut: "EN_COURS" }, data: { statut: verdict, evalueAt: new Date(), montantProuve: texteDepuisCentimes(prouve) } });
    if (r.count === 0) continue;
    await ecrireAudit(db, {
      entite: "CptPromesse",
      entiteId: p.id,
      action: "evaluation_promesse",
      avant: { statut: "EN_COURS" },
      apres: { statut: verdict, montantProuve: texteDepuisCentimes(prouve), regle: "encaissé prouvé à la date promise" },
      userId: entree.userId,
      ip: entree.ip,
    });
    if (verdict === "TENUE") tenues++;
    else nonTenues++;
  }
  return { evaluees: tenues + nonTenues, tenues, nonTenues };
}

export interface SuiviRelancesClientCpt {
  relances: { id: string; canal: CanalRelanceCpt; faiteLe: Date; commentaire: string | null; auteur: string; origine: string; creeAt: Date }[];
  promesses: PromesseSuiviCpt[];
  resteDu: string;
  nbEcheancesEnRetard: number;
  derniereRelance: Date | null;
  /** « Relance proposée » (jamais envoyée) : une échéance en retard et aucune promesse en cours. */
  relanceProposee: boolean;
}

/** Relances et promesses d'un client pour sa fiche (lecture seule). */
export async function lireSuiviRelancesClientCpt(db: RelancesClientDbCpt, clientId: string, aujourdhui: string): Promise<SuiviRelancesClientCpt> {
  const [relances, promesses, situation] = await Promise.all([
    db.cptRelance.findMany({ where: { clientId }, orderBy: [{ faiteLe: "desc" }, { creeAt: "desc" }], take: 100, include: { creePar: { select: { fullName: true } } } }),
    db.cptPromesse.findMany({ where: { clientId }, orderBy: [{ datePromise: "desc" }, { creeAt: "desc" }], take: 100 }),
    situationClient(db, clientId, aujourdhui),
  ]);
  const suivies: PromesseSuiviCpt[] = [];
  for (const p of promesses) {
    let verdictActuel: StatutPromesseCpt | null = null;
    let prouveActuel: string | null = null;
    if (p.statut === "EN_COURS") {
      const prouve = await prouveSurPeriode(db, clientId, jourDe(p.creeAt), jourDe(p.datePromise));
      verdictActuel = evaluerPromesseCpt({ montant: enCentimesEcheancier(p.montant.toString()) ?? ZERO, datePromise: jourDe(p.datePromise), prouve }, aujourdhui);
      prouveActuel = texteDepuisCentimes(prouve);
    }
    suivies.push({ id: p.id, montant: p.montant.toString(), datePromise: p.datePromise, statut: p.statut, creeAt: p.creeAt, evalueAt: p.evalueAt, montantProuve: p.montantProuve?.toString() ?? null, verdictActuel, prouveActuel });
  }
  const nbPromessesEnCours = promesses.filter((p) => p.statut === "EN_COURS").length;
  return {
    relances: relances.map((r) => ({ id: r.id, canal: r.canal, faiteLe: r.faiteLe, commentaire: r.commentaire, auteur: r.creePar.fullName, origine: r.origine, creeAt: r.creeAt })),
    promesses: suivies,
    resteDu: texteDepuisCentimes(situation.resteDu),
    nbEcheancesEnRetard: situation.nbEnRetard,
    derniereRelance: relances[0]?.faiteLe ?? null,
    relanceProposee: relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: situation.nbEnRetard, nbPromessesEnCours }),
  };
}

