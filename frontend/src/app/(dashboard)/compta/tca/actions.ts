"use server";

// Server Actions de la rubrique « Taxe sur les contrats d'assurance » de Gestion Compta (lots GC-8c et GC-8d).
//
// Chaque action REVÉRIFIE sa permission (jamais seulement le layout `/compta` ni le bouton masqué) puis appelle la couche base
// `cptTaxeDb.ts`, qui applique le moteur pur `cptTaxe.ts`. Tout est tracé dans `CptAudit` (auteur, date, montants).
// Limite connue (D5, décision du 2026-11-25) : la signature manuscrite de la déclaration et du paiement n'est PAS branchée dans le
// module ; la traçabilité est celle de `CptAudit`.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  declarerMoisTcaCpt,
  enregistrerPaiementTcaCpt,
  getTrustedClientIp,
  prisma,
  rattraperTaxesManquantesCpt,
  taxerEncaissementCpt,
  type NatureContratCpt,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";

export type ResultatTcaAction = { status: "success"; message: string } | { status: "error"; message: string; erreurs?: Record<string, string> };

type SessionCpt = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const DELAI_TRANSACTION_MS = 120_000;
const NON_AUTORISE: ResultatTcaAction = { status: "error", message: "Action non autorisée." };
const MOIS = /^\d{4}-\d{2}-01$/;

async function exigerUne(...permissions: string[]): Promise<SessionCpt | null> {
  const session = await getSession();
  if (!session || !permissions.some((p) => hasPermission(session, p))) return null;
  return session;
}

function rafraichir() {
  revalidatePath("/compta", "layout");
  publishDataChanged();
}

const fcfa = (texte: string) => Number(texte).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Déclare un mois : fige le calcul et verrouille les lignes de taxe. */
export async function declarerMoisTcaAction(mois: string): Promise<ResultatTcaAction> {
  const session = await exigerUne("cpt.declarer_tca");
  if (!session) return NON_AUTORISE;
  if (typeof mois !== "string" || !MOIS.test(mois)) return { status: "error", message: "Mois invalide." };
  const ip = getTrustedClientIp(await headers());
  try {
    const r = await prisma.$transaction((tx) => declarerMoisTcaCpt(tx, { mois }, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
    if (!r.ok) return { status: "error", message: r.message };
    rafraichir();
    const credit = Number(r.credit) > 0 ? ` Crédit à reporter : ${fcfa(r.credit)} FCFA.` : "";
    return { status: "success", message: `Déclaration ${r.reference} enregistrée : ${fcfa(r.montantAPayer)} FCFA à payer, ${r.nbLignes} ligne(s) verrouillée(s).${credit}` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "La déclaration a échoué." };
  }
}

/** Enregistre le paiement et la quittance d'une déclaration. */
export async function enregistrerPaiementTcaAction(declarationId: string, saisie: Record<string, unknown>): Promise<ResultatTcaAction> {
  const session = await exigerUne("cpt.payer_tca");
  if (!session) return NON_AUTORISE;
  if (typeof declarationId !== "string" || !declarationId || typeof saisie !== "object" || saisie === null) return { status: "error", message: "Saisie invalide." };
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction((tx) => enregistrerPaiementTcaCpt(tx, { declarationId, saisie }, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS });
  if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };
  rafraichir();
  const trop = Number(r.tropPaye) > 0 ? ` Trop-payé reporté : ${fcfa(r.tropPaye)} FCFA.` : "";
  return { status: "success", message: `Paiement de la déclaration ${r.reference} enregistré.${trop}` };
}

/** Rejoue la taxe des rattachements validés qui n'avaient pas de taux (à faire une fois le taux saisi). */
export async function rattraperTaxesManquantesAction(): Promise<ResultatTcaAction> {
  const session = await exigerUne("cpt.declarer_tca");
  if (!session) return NON_AUTORISE;
  const ip = getTrustedClientIp(await headers());
  const b = await prisma.$transaction((tx) => rattraperTaxesManquantesCpt(tx, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS });
  rafraichir();
  const reste = b.sansTaux.length > 0 ? ` ${b.sansTaux.length} rattachement(s) n'ont toujours pas de taux.` : "";
  return { status: "success", message: `${b.lignesCreees} ligne(s) de taxe écrite(s).${reste}` };
}

/** Calcule l'avance de taxe d'un encaissement sans contrat (produit connu) ou dont le contrat n'est pas encore rattaché. */
export async function taxerEncaissementAction(saisie: { reference: string; numPolice?: string; produitCode?: string; natureContrat?: string }): Promise<ResultatTcaAction> {
  const session = await exigerUne("cpt.declarer_tca", "cpt.identifier_encaissement");
  if (!session) return NON_AUTORISE;
  const reference = String(saisie?.reference ?? "").trim().toUpperCase();
  const numPolice = String(saisie?.numPolice ?? "").trim();
  const produitCode = String(saisie?.produitCode ?? "").trim().toUpperCase();
  const nature = String(saisie?.natureContrat ?? "").trim();
  if (!reference) return { status: "error", message: "Indiquez la référence de l'encaissement (CPE-…)." };
  if (!numPolice === !produitCode) return { status: "error", message: "Indiquez le numéro de police OU le produit." };
  if (nature && nature !== "INDIVIDUEL" && nature !== "GROUPE") return { status: "error", message: "Nature du contrat invalide." };
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction(async (tx) => {
    const enc = await tx.cptEncaissement.findUnique({ where: { reference }, select: { id: true } });
    if (!enc) return { ok: false as const, message: "Encaissement introuvable." };
    let contratId: string | null = null;
    if (numPolice) {
      const c = await tx.cptContrat.findUnique({ where: { numPolice }, select: { id: true } });
      if (!c) return { ok: false as const, message: "Contrat introuvable." };
      contratId = c.id;
    }
    return taxerEncaissementCpt(tx, { encaissementId: enc.id, contratId, produitCode: contratId ? null : produitCode, natureContrat: (nature || null) as NatureContratCpt | null }, { userId: session.user.id, ip });
  }, { timeout: DELAI_TRANSACTION_MS });
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return { status: "success", message: `Taxe de ${fcfa(r.taxe)} FCFA calculée (taux ${(Number(r.taux) * 100).toFixed(2)} %), à déclarer en ${r.mois.slice(0, 7)}.` };
}
