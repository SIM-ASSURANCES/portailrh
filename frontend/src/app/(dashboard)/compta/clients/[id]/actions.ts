"use server";

// Server Actions des relances et promesses d'un client (lot GC-7d, Q10 option A, PROVISOIRE : rien n'est envoyé). Chaque action REVÉRIFIE
// `cpt.relancer` (jamais seulement le layout ni le formulaire masqué) puis appelle la couche base `cptRelancesClientDb.ts`, dans une transaction.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { enregistrerRelanceCpt, evaluerPromessesCpt, getTrustedClientIp, jourTexteCpt, prisma, type SaisieRelanceEtPromesseCpt } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";

export type ResultatRelanceActionCpt = { status: "success"; message: string } | { status: "error"; message: string; erreurs?: Record<string, string> };

const NON_AUTORISE: ResultatRelanceActionCpt = { status: "error", message: "Action non autorisée." };
const DELAI_MS = 60_000;

function rafraichir() {
  revalidatePath("/compta", "layout");
  publishDataChanged();
}

/** Enregistre une relance faite hors de l'application (et la promesse qu'elle a obtenue). Évalue d'abord les promesses échues du client. */
export async function enregistrerRelanceCptAction(clientId: string, saisie: SaisieRelanceEtPromesseCpt): Promise<ResultatRelanceActionCpt> {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.relancer")) return NON_AUTORISE;
  if (typeof clientId !== "string" || !clientId) return { status: "error", message: "Client introuvable." };
  const ip = getTrustedClientIp(await headers());
  const aujourdhui = jourTexteCpt(new Date());
  const r = await prisma.$transaction(
    async (tx) => {
      await evaluerPromessesCpt(tx, { userId: session.user.id, ip, aujourdhui, clientId });
      return enregistrerRelanceCpt(tx, { clientId, saisie, userId: session.user.id, ip, aujourdhui });
    },
    { timeout: DELAI_MS, maxWait: 10_000 }
  );
  if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };
  rafraichir();
  return { status: "success", message: r.message };
}

/**
 * Applique la règle d'évaluation aux promesses échues (d'un client, ou de tous). Ne choisit jamais un statut : « tenue » ou « non tenue » sort
 * de l'encaissé prouvé à la date promise ; chaque changement est tracé dans l'audit.
 */
export async function evaluerPromessesCptAction(clientId?: string): Promise<ResultatRelanceActionCpt> {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.relancer")) return NON_AUTORISE;
  const ip = getTrustedClientIp(await headers());
  const bilan = await prisma.$transaction((tx) => evaluerPromessesCpt(tx, { userId: session.user.id, ip, aujourdhui: jourTexteCpt(new Date()), clientId: typeof clientId === "string" && clientId ? clientId : undefined }), {
    timeout: DELAI_MS,
    maxWait: 10_000,
  });
  rafraichir();
  return { status: "success", message: bilan.evaluees === 0 ? "Aucune promesse à évaluer." : `${bilan.evaluees} promesse(s) évaluée(s) : ${bilan.tenues} tenue(s), ${bilan.nonTenues} non tenue(s).` };
}
