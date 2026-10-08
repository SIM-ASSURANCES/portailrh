"use server";

// Confirmation F5 (commit 6b) : « Reçu », « Non reçu », « Finalement reçu », ligne par ligne ou par lot. Réservé à
// `enc.confirmer_paiement` (Finance), revérifié ici — Équipe technique et Consultation n'y ont pas accès, même en appel
// direct. La confirmation passe toujours par `confirmerEncaissement` (D26) ; un trop-perçu n'est jamais confirmé en lot
// (D30) : il est renvoyé pour une confirmation explicite, ligne par ligne.

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { getClientIp } from "@/lib/auditLog";
import { publishDataChanged } from "@/lib/eventBus";
import {
  confirmerEncaissement,
  confirmerEnLot,
  EncConfirmationError,
  marquerNonRecu,
  marquerNonRecuEnLot,
  prisma,
  type BilanLot,
} from "backend";

type Erreur = { status: "error"; message: string };
export type ResultatLigne =
  | { status: "success"; message: string }
  | { status: "trop_percu"; message: string; tropPercu: string }
  | Erreur;
export type ResultatLot = { status: "success"; message: string; bilan: BilanLot } | Erreur;

const NON_AUTORISE: Erreur = { status: "error", message: "Action non autorisée." };
const fcfa = (v: string) => `${Math.round(Number(v)).toLocaleString("fr-FR")} FCFA`;

async function sessionFinance() {
  const session = await getSession();
  return session && hasPermission(session, "enc.confirmer_paiement") ? session : null;
}

function rafraichir() {
  revalidatePath("/encaissements", "layout");
  publishDataChanged();
}

/** « Reçu » ou « Finalement reçu » d'un paiement. `accepterTropPercu` : confirmation explicite d'un trop-perçu. */
export async function recuAction(encaissementId: string, accepterTropPercu = false): Promise<ResultatLigne> {
  const session = await sessionFinance();
  if (!session) return NON_AUTORISE;
  if (typeof encaissementId !== "string" || !encaissementId) return { status: "error", message: "Données invalides." };
  const ip = await getClientIp();
  try {
    const r = await prisma.$transaction(
      (tx) => confirmerEncaissement(tx, { encaissementId, userId: session.user.id, maintenant: new Date(), accepterTropPercu: accepterTropPercu === true, ip }),
      { timeout: 20000, maxWait: 10000 }
    );
    if (r.statut === "TROP_PERCU_A_CONFIRMER") {
      const tropPercu = r.tropPercu.toFixed(2);
      return {
        status: "trop_percu",
        tropPercu,
        message: `${r.paiementId} dépasse le reste dû (${fcfa(r.restantDu.toFixed(2))}) : trop-perçu de ${fcfa(tropPercu)}. Confirmez-le explicitement.`,
      };
    }
    rafraichir();
    return { status: "success", message: `${r.paiementId} confirmé (rang ${r.rang}).` };
  } catch (e) {
    if (e instanceof EncConfirmationError) return { status: "error", message: e.message };
    throw e;
  }
}

/** « Non reçu » d'un paiement, motif obligatoire. */
export async function nonRecuAction(encaissementId: string, motif: string): Promise<ResultatLigne> {
  const session = await sessionFinance();
  if (!session) return NON_AUTORISE;
  if (typeof encaissementId !== "string" || !encaissementId) return { status: "error", message: "Données invalides." };
  const ip = await getClientIp();
  try {
    const r = await prisma.$transaction((tx) =>
      marquerNonRecu(tx, { encaissementId, motif: String(motif ?? ""), userId: session.user.id, maintenant: new Date(), ip })
    );
    rafraichir();
    return { status: "success", message: `${r.paiementId} marqué non reçu.` };
  } catch (e) {
    if (e instanceof EncConfirmationError) return { status: "error", message: e.message };
    throw e;
  }
}

function resumeBilan(b: BilanLot, verbe: string): string {
  const parts = [`${b.traites.length} paiement(s) ${verbe}`];
  if (b.tropPercus.length > 0) parts.push(`${b.tropPercus.length} trop-perçu(s) écarté(s), à confirmer ligne par ligne`);
  if (b.refuses.length > 0) parts.push(`${b.refuses.length} déjà traité(s) ou refusé(s)`);
  return `${parts.join(" ; ")}.`;
}

/** « Reçu » (ou « Finalement reçu ») pour une sélection. */
export async function recuLotAction(ids: string[]): Promise<ResultatLot> {
  const session = await sessionFinance();
  if (!session) return NON_AUTORISE;
  if (!Array.isArray(ids)) return { status: "error", message: "Données invalides." };
  const ip = await getClientIp();
  try {
    const bilan = await confirmerEnLot(prisma, { ids: ids.map(String), userId: session.user.id, maintenant: new Date(), ip });
    if (bilan.traites.length > 0) rafraichir();
    return { status: "success", message: resumeBilan(bilan, "confirmé(s)"), bilan };
  } catch (e) {
    if (e instanceof EncConfirmationError) return { status: "error", message: e.message };
    throw e;
  }
}

/** « Non reçu » pour une sélection, avec le même motif. */
export async function nonRecuLotAction(ids: string[], motif: string): Promise<ResultatLot> {
  const session = await sessionFinance();
  if (!session) return NON_AUTORISE;
  if (!Array.isArray(ids)) return { status: "error", message: "Données invalides." };
  const ip = await getClientIp();
  try {
    const bilan = await marquerNonRecuEnLot(prisma, { ids: ids.map(String), motif: String(motif ?? ""), userId: session.user.id, maintenant: new Date(), ip });
    if (bilan.traites.length > 0) rafraichir();
    return { status: "success", message: resumeBilan(bilan, "marqué(s) non reçu(s)"), bilan };
  } catch (e) {
    if (e instanceof EncConfirmationError) return { status: "error", message: e.message };
    throw e;
  }
}
