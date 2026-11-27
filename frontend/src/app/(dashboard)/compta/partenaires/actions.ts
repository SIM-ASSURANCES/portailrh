"use server";

// Server Actions de la rémunération des partenaires (lot GC-9). Chaque action REVÉRIFIE sa permission (jamais seulement le layout
// `/compta` ni un bouton grisé) puis appelle la couche base, qui refait tout le calcul SOUS le verrou du partenaire. Tout est tracé
// dans `CptAudit` (auteur, date, montants, motif). Signature manuscrite (D5) non branchée, comme pour la taxe.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { deciderModeRemunerationCpt, enregistrerAnnulationRemunerationCpt, enregistrerCompensationCpt, enregistrerReglementPartenaireCpt, getTrustedClientIp, prisma } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { peutVoirRemunerationCpt } from "@/lib/compta/droitsRemuneration";
import { publishDataChanged } from "@/lib/eventBus";

export type ResultatRemunerationAction = { status: "success"; message: string } | { status: "error"; message: string; erreurs?: Record<string, string> };

const DELAI_TRANSACTION_MS = 120_000;
const NON_AUTORISE: ResultatRemunerationAction = { status: "error", message: "Action non autorisée." };
const SAISIE_INVALIDE: ResultatRemunerationAction = { status: "error", message: "Saisie invalide." };

async function exiger(permission: string) {
  const session = await getSession();
  // Les réponses citent des montants de rémunération : la lecture (C-36) est exigée en plus de la permission de l'action.
  return session && peutVoirRemunerationCpt(session) && hasPermission(session, permission) ? session : null;
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function rafraichir() {
  revalidatePath("/compta", "layout");
  publishDataChanged();
}

/** Enregistre un règlement versé à un partenaire et l'affecte aux montants exigibles les plus anciens de sa nature. */
export async function enregistrerReglementPartenaireAction(saisie: Record<string, unknown>): Promise<ResultatRemunerationAction> {
  const session = await exiger("cpt.regler_partenaire");
  if (!session) return NON_AUTORISE;
  if (!estObjet(saisie)) return SAISIE_INVALIDE;
  const ip = getTrustedClientIp(await headers());
  try {
    const r = await prisma.$transaction((tx) => enregistrerReglementPartenaireCpt(tx, saisie, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
    if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };
    rafraichir();
    return { status: "success", message: `Règlement ${r.reference} enregistré, affecté à ${r.nbAffectations} échéance(s).` };
  } catch (e) {
    console.error("[Gestion Compta] règlement de partenaire", e);
    return { status: "error", message: "Le règlement n'a pas pu être enregistré. Rien n'a été écrit." };
  }
}

/** Décision « en une fois / au prorata » sur un contrat, pour un bénéficiaire et une nature, avec motif. */
export async function deciderModeRemunerationAction(saisie: Record<string, unknown>): Promise<ResultatRemunerationAction> {
  const session = await exiger("cpt.regler_partenaire");
  if (!session) return NON_AUTORISE;
  if (!estObjet(saisie)) return SAISIE_INVALIDE;
  const ip = getTrustedClientIp(await headers());
  const r = await prisma.$transaction(
    (tx) =>
      deciderModeRemunerationCpt(
        tx,
        { partenaireId: saisie.partenaireId, contratId: saisie.contratId, nature: saisie.nature, mode: saisie.mode, motif: saisie.motif },
        { userId: session.user.id, ip },
      ),
    { timeout: DELAI_TRANSACTION_MS },
  );
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir();
  return { status: "success", message: "Décision enregistrée pour ce contrat." };
}

/** Compensation EXPLICITE : l'avance d'une nature est imputée sur ce qu'il reste à verser d'une autre, avec motif (`cpt.compenser`). */
export async function compenserRemunerationAction(saisie: Record<string, unknown>): Promise<ResultatRemunerationAction> {
  const session = await exiger("cpt.compenser");
  if (!session) return NON_AUTORISE;
  if (!estObjet(saisie)) return SAISIE_INVALIDE;
  const ip = getTrustedClientIp(await headers());
  try {
    const r = await prisma.$transaction((tx) => enregistrerCompensationCpt(tx, saisie, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
    if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };
  } catch (e) {
    console.error("[Gestion Compta] compensation", e);
    return { status: "error", message: "La compensation n'a pas pu être enregistrée. Rien n'a été écrit." };
  }
  rafraichir();
  return { status: "success", message: "Compensation enregistrée." };
}

/**
 * Annulation tracée d'un règlement (`cpt.regler_partenaire`) ou d'une compensation (`cpt.compenser`), avec motif ; la direction
 * (`cpt.trancher_litige`) peut annuler les deux. Jamais l'auteur de l'opération : la couche base et la base le revérifient.
 */
export async function annulerOperationRemunerationAction(saisie: Record<string, unknown>): Promise<ResultatRemunerationAction> {
  const session = await getSession();
  if (!estObjet(saisie)) return SAISIE_INVALIDE;
  const permission = saisie.type === "COMPENSATION" ? "cpt.compenser" : "cpt.regler_partenaire";
  if (!session || !peutVoirRemunerationCpt(session) || !(hasPermission(session, permission) || hasPermission(session, "cpt.trancher_litige"))) return NON_AUTORISE;
  const ip = getTrustedClientIp(await headers());
  try {
    const r = await prisma.$transaction((tx) => enregistrerAnnulationRemunerationCpt(tx, saisie, { userId: session.user.id, ip }), { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 });
    if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };
  } catch (e) {
    console.error("[Gestion Compta] annulation d'une opération de rémunération", e);
    return { status: "error", message: "L'annulation n'a pas pu être enregistrée. Rien n'a été écrit." };
  }
  rafraichir();
  return { status: "success", message: "Annulation enregistrée : l'opération ne compte plus." };
}
