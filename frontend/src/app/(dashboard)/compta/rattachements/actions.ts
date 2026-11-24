"use server";

// Server Actions de la rubrique « Rattachements » de Gestion Compta (lot GC-5d ; docs/PLAN_GESTION_COMPTA.md, GC-5).
//
// Chaque action REVÉRIFIE sa permission (jamais seulement le layout `/compta` ni le bouton masqué) et ne fait qu'appeler la couche base
// `cptRattachement.ts`, qui applique les règles du moteur pur : étape 1 (confirmation du commercial, reçu obligatoire), étape 2 (validation
// du RFCRH, jamais celui qui a confirmé), plafonds sous verrou, avancement recalculé. Un lot refusé en partie renvoie ce qui est passé ET
// la première raison des refus.
// Limite connue : la signature manuscrite des validations (D5) n'est pas encore branchée — elle passe par l'infrastructure de signature
// partagée, qui suppose l'enregistrement d'un nouveau code d'action ; à faire avant la mise en service.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  classerPasUnePrimeCpt,
  confirmerRattachementsCpt,
  enCentimesEcheancier,
  getTrustedClientIp,
  identifierManuellementCpt,
  lancerRapprochementCpt,
  MESSAGE_DEJA_MODIFIE_CPT,
  prisma,
  rejeterRattachementsCpt,
  validerRattachementsCpt,
  type ResultatBlocCpt,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";

export type ResultatRattachementCpt = { status: "success"; message: string } | { status: "error"; message: string };

type SessionCpt = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const DELAI_TRANSACTION_MS = 120_000;
const NON_AUTORISE: ResultatRattachementCpt = { status: "error", message: "Action non autorisée." };

/** La session si elle porte AU MOINS UNE des permissions demandées, sinon `null`. */
async function exigerUne(...permissions: string[]): Promise<SessionCpt | null> {
  const session = await getSession();
  if (!session || !permissions.some((p) => hasPermission(session, p))) return null;
  return session;
}

function idsValides(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string");
}

function rafraichir() {
  revalidatePath("/compta", "layout");
  publishDataChanged();
}

function resumeLot(verbe: string, resultats: ResultatBlocCpt[]): ResultatRattachementCpt {
  const traites = resultats.filter((r) => r.ok).reduce((s, r) => s + r.ids.length, 0);
  const refus = resultats.filter((r) => !r.ok);
  if (traites === 0) return { status: "error", message: refus[0]?.message ?? "Aucun rattachement traité." };
  const suite = refus.length > 0 ? ` — ${refus.length} refusé(s) : ${refus[0].message}` : "";
  return { status: "success", message: `${traites} rattachement(s) ${verbe}${suite}` };
}

/** Calcule les propositions du moteur. N'a aucun effet sur les primes : seule une validation du RFCRH rend une prime payée (RG-01). */
export async function lancerRapprochementCptAction(): Promise<ResultatRattachementCpt> {
  const session = await exigerUne("cpt.identifier_encaissement", "cpt.valider_rattachement", "cpt.importer_releves");
  if (!session) return NON_AUTORISE;
  const ip = getTrustedClientIp(await headers());
  const bilan = await prisma.$transaction((tx) => lancerRapprochementCpt(tx, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
  rafraichir();
  return {
    status: "success",
    message: `${bilan.propositionsCreees} proposition(s) créée(s) pour ${bilan.encaissementsExamines} encaissement(s) examiné(s) ; ${bilan.encaissementsSansProposition} sans proposition.`,
  };
}

/** Étape 1 : le commercial confirme avec le reçu (référence du reçu obligatoire). */
export async function confirmerRattachementsCptAction(ids: string[], recuReference: string, commentaire?: string): Promise<ResultatRattachementCpt> {
  const session = await exigerUne("cpt.confirmer_rattachement");
  if (!session) return NON_AUTORISE;
  if (!idsValides(ids) || typeof recuReference !== "string") return { status: "error", message: "Sélection invalide." };
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction((tx) => confirmerRattachementsCpt(tx, ids, { userId: session.user.id, ip, recuReference, commentaire: commentaire ?? null }), {
    timeout: DELAI_TRANSACTION_MS,
  });
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return resumeLot("confirmé(s)", r.resultats);
}

/** Étape 2 : le RFCRH valide (jamais le compte qui a confirmé). */
export async function validerRattachementsCptAction(ids: string[]): Promise<ResultatRattachementCpt> {
  const session = await exigerUne("cpt.valider_rattachement");
  if (!session) return NON_AUTORISE;
  if (!idsValides(ids)) return { status: "error", message: "Sélection invalide." };
  const ip = getTrustedClientIp(await headers());
  try {
    const r = await prisma.$transaction((tx) => validerRattachementsCpt(tx, ids, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
    if (!r.ok) return { status: "error", message: r.message };
    rafraichir();
    return resumeLot("validé(s)", r.resultats);
  } catch (erreur) {
    // Quelqu'un d'autre a agi entre la lecture et l'écriture : tout est annulé, on le dit.
    if (erreur instanceof Error && erreur.message === MESSAGE_DEJA_MODIFIE_CPT) return { status: "error", message: erreur.message };
    throw erreur;
  }
}

/** Rejet par le RFCRH, avec motif : le dossier revient au commercial. */
export async function rejeterRattachementsCptAction(ids: string[], motif: string): Promise<ResultatRattachementCpt> {
  const session = await exigerUne("cpt.valider_rattachement");
  if (!session) return NON_AUTORISE;
  if (!idsValides(ids) || typeof motif !== "string") return { status: "error", message: "Sélection invalide." };
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction((tx) => rejeterRattachementsCpt(tx, ids, { userId: session.user.id, ip, motif }), { timeout: DELAI_TRANSACTION_MS });
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return resumeLot("rejeté(s)", r.resultats);
}

export interface SaisieIdentificationCpt {
  encaissementId: string;
  numPolice: string;
  /** Rang de l'échéance visée ; vide = la plus ancienne encore ouverte. */
  rang?: string;
  /** Montant en FCFA (texte saisi). */
  montant: string;
  justification: string;
  recuReference: string;
}

/**
 * Identification manuelle par le commercial : toujours « à confirmer », confirmée dans le même geste avec le reçu. Le RFCRH ne porte pas
 * la permission de confirmer : il ne peut donc pas identifier à la main (le dossier attend le commercial).
 */
export async function identifierManuellementCptAction(saisie: SaisieIdentificationCpt): Promise<ResultatRattachementCpt> {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.identifier_encaissement") || !hasPermission(session, "cpt.confirmer_rattachement")) return NON_AUTORISE;
  if (!saisie || typeof saisie.encaissementId !== "string" || typeof saisie.numPolice !== "string" || typeof saisie.montant !== "string") {
    return { status: "error", message: "Demande invalide." };
  }
  const montant = enCentimesEcheancier(saisie.montant);
  if (montant === null || montant <= BigInt(0)) return { status: "error", message: "Montant invalide." };

  const contrat = await prisma.cptContrat.findFirst({
    where: { numPolice: { equals: saisie.numPolice.trim(), mode: "insensitive" } },
    select: { numPolice: true, echeances: { where: { etat: "OUVERTE" }, orderBy: { rang: "asc" }, select: { id: true, rang: true } } },
  });
  if (!contrat) return { status: "error", message: "Aucun contrat ne porte ce numéro de police." };
  const rang = (saisie.rang ?? "").trim();
  const echeance = rang ? contrat.echeances.find((e) => String(e.rang) === rang) : contrat.echeances[0];
  if (!echeance) return { status: "error", message: rang ? `L'échéance ${rang} de ce contrat n'est pas ouverte.` : "Ce contrat n'a plus d'échéance ouverte." };

  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction(
    (tx) =>
      identifierManuellementCpt(tx, {
        userId: session.user.id,
        ip,
        encaissementId: saisie.encaissementId,
        parts: [{ echeanceId: echeance.id, montant }],
        justification: saisie.justification,
        recuReference: saisie.recuReference,
      }),
    { timeout: DELAI_TRANSACTION_MS },
  );
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return { status: "success", message: `Encaissement identifié sur la police ${contrat.numPolice} (échéance ${echeance.rang}) : en attente de validation du RFCRH.` };
}

/** Classe tout ou partie d'un encaissement « pas une prime » (motif écrit obligatoire, RG-03). */
export async function classerPasUnePrimeCptAction(encaissementId: string, montant: string, motif: string): Promise<ResultatRattachementCpt> {
  const session = await exigerUne("cpt.classer_pas_une_prime");
  if (!session) return NON_AUTORISE;
  if (typeof encaissementId !== "string" || typeof montant !== "string" || typeof motif !== "string") return { status: "error", message: "Demande invalide." };
  const centimes = enCentimesEcheancier(montant);
  if (centimes === null || centimes <= BigInt(0)) return { status: "error", message: "Montant invalide." };
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction((tx) => classerPasUnePrimeCpt(tx, { userId: session.user.id, ip, encaissementId, montant: centimes, motif }), {
    timeout: DELAI_TRANSACTION_MS,
  });
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return { status: "success", message: "Montant classé « pas une prime »." };
}
