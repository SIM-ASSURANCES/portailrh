import type { PrismaClient } from "./generated/prisma/client";
import { enCentimesEcheancier } from "./cptEcheancier";
import { etatAffichePromesseCpt, prouvePourPromesseCpt, type PaiementProuveCpt, type StatutPromesseCpt } from "./cptRelances";

/**
 * État AFFICHÉ des promesses de paiement (règle C-21, `cptRelances.ts`) : LECTURE SEULE. Tous les écrans et calculs qui montrent ou utilisent l'état
 * d'une promesse (fiche client, état des créances, prévision) passent par ici : le statut enregistré en base n'est que la trace d'une évaluation
 * faite par une personne, jamais l'état qu'on affiche.
 */
export type PromessesDbCpt = Pick<PrismaClient, "cptPromesse" | "cptRattachement">;

const ZERO = BigInt(0);
const jourDe = (d: Date) => d.toISOString().slice(0, 10);
const enDate = (jour: string) => new Date(`${jour}T00:00:00Z`);

export interface PromesseACalculerCpt {
  id: string;
  clientId: string;
  montant: { toString(): string };
  datePromise: Date;
  creeAt: Date;
}

export interface EtatPromesseCpt {
  etat: StatutPromesseCpt;
  /** Encaissé prouvé sur la fenêtre [création, date promise] (centimes). */
  prouve: bigint;
}

/** État affiché de chaque promesse à la date `aujourdhui` : une requête pour tous les paiements prouvés des clients concernés. */
export async function etatsAffichesPromessesCpt(db: PromessesDbCpt, promesses: readonly PromesseACalculerCpt[], aujourdhui: string): Promise<Map<string, EtatPromesseCpt>> {
  const resultat = new Map<string, EtatPromesseCpt>();
  if (promesses.length === 0) return resultat;
  const clients = [...new Set(promesses.map((p) => p.clientId))];
  const debut = promesses.map((p) => jourDe(p.creeAt)).sort()[0];
  const fin = promesses.map((p) => jourDe(p.datePromise)).sort().pop() as string;
  const lignes = await db.cptRattachement.findMany({
    where: { statut: "VALIDE", echeance: { contrat: { clientId: { in: clients } } }, encaissement: { dateValeur: { gte: enDate(debut), lte: enDate(fin) } } },
    select: { montant: true, echeance: { select: { contrat: { select: { clientId: true } } } }, encaissement: { select: { dateValeur: true } } },
  });
  const parClient = new Map<string, PaiementProuveCpt[]>();
  for (const l of lignes) {
    const c = l.echeance.contrat.clientId;
    const liste = parClient.get(c) ?? [];
    liste.push({ jour: jourDe(l.encaissement.dateValeur), montant: enCentimesEcheancier(l.montant.toString()) ?? ZERO });
    parClient.set(c, liste);
  }
  for (const p of promesses) {
    const prouve = prouvePourPromesseCpt(parClient.get(p.clientId) ?? [], { creeLe: jourDe(p.creeAt), datePromise: jourDe(p.datePromise) });
    resultat.set(p.id, { prouve, etat: etatAffichePromesseCpt({ montant: enCentimesEcheancier(p.montant.toString()) ?? ZERO, datePromise: jourDe(p.datePromise), prouve }, aujourdhui) });
  }
  return resultat;
}

/**
 * Promesses EN COURS à l'affichage parmi celles dont la date promise n'est pas passée (une promesse dont la date est dépassée est tenue ou non
 * tenue, jamais en cours) : `clientIds` et/ou une plage de dates promises la restreignent.
 */
export async function promessesEnCoursAffichees(
  db: PromessesDbCpt,
  aujourdhui: string,
  filtre: { clientIds?: readonly string[]; du?: string; au?: string } = {}
): Promise<(PromesseACalculerCpt & EtatPromesseCpt)[]> {
  const du = filtre.du && filtre.du > aujourdhui ? filtre.du : aujourdhui;
  const promesses = await db.cptPromesse.findMany({
    where: { datePromise: { gte: enDate(du), ...(filtre.au ? { lte: enDate(filtre.au) } : {}) }, ...(filtre.clientIds ? { clientId: { in: [...filtre.clientIds] } } : {}) },
    select: { id: true, clientId: true, montant: true, datePromise: true, creeAt: true },
  });
  const etats = await etatsAffichesPromessesCpt(db, promesses, aujourdhui);
  return promesses.map((p) => ({ ...p, ...(etats.get(p.id) as EtatPromesseCpt) })).filter((p) => p.etat === "EN_COURS");
}
