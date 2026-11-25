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
