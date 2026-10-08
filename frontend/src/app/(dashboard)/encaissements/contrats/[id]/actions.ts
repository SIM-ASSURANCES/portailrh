"use server";

// Saisie d'un versement depuis la fiche police (F3, commit 6c). Réservée à `enc.saisir_encaissement`, revérifiée ici.
// Le versement est créé et confirmé dans la même transaction (`saisirEncaissement` → `confirmerEncaissement`, D26).

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { getClientIp } from "@/lib/auditLog";
import { publishDataChanged } from "@/lib/eventBus";
import { EncConfirmationError, prisma, saisirEncaissement, type ErreursSaisie, type SaisieEncaissement } from "backend";

export type ResultatSaisieAction =
  | { status: "success"; message: string }
  | { status: "erreurs"; message: string; erreurs: ErreursSaisie }
  | { status: "reference_deja_utilisee"; message: string }
  | { status: "trop_percu"; message: string }
  | { status: "error"; message: string };

const fcfa = (v: string) => `${Math.round(Number(v)).toLocaleString("fr-FR")} FCFA`;

export async function saisirVersementAction(
  contratId: string,
  saisie: SaisieEncaissement,
  confirmations: { referenceDejaUtilisee?: boolean; tropPercu?: boolean } = {}
): Promise<ResultatSaisieAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.saisir_encaissement")) return { status: "error", message: "Action non autorisée." };
  if (typeof contratId !== "string" || !contratId || !saisie || typeof saisie !== "object") return { status: "error", message: "Données invalides." };

  const ip = await getClientIp();
  try {
    const r = await prisma.$transaction(
      (tx) =>
        saisirEncaissement(tx, {
          contratId,
          datePaiement: String(saisie.datePaiement ?? ""),
          mode: String(saisie.mode ?? ""),
          reference: String(saisie.reference ?? ""),
          montant: String(saisie.montant ?? ""),
          userId: session.user.id,
          maintenant: new Date(),
          accepterReferenceDejaUtilisee: confirmations.referenceDejaUtilisee === true,
          accepterTropPercu: confirmations.tropPercu === true,
          ip,
        }),
      { timeout: 20000, maxWait: 10000 }
    );
    switch (r.statut) {
      case "ERREURS":
        return { status: "erreurs", message: "Le versement contient des erreurs.", erreurs: r.erreurs };
      case "REFERENCE_DEJA_UTILISEE":
        return {
          status: "reference_deja_utilisee",
          message: `Cette référence est déjà utilisée : ${r.paiements.map((p) => `${p.paiementId} (${p.numPolice})`).join(", ")}. Enregistrer quand même ?`,
        };
      case "TROP_PERCU_A_CONFIRMER":
        return {
          status: "trop_percu",
          message: `Le versement dépasse le reste dû (${fcfa(r.restantDu.toFixed(2))}) : trop-perçu de ${fcfa(r.tropPercu.toFixed(2))}. Confirmer quand même ?`,
        };
      case "CONFIRME":
        revalidatePath("/encaissements", "layout");
        publishDataChanged();
        return { status: "success", message: `Versement ${r.paiementId} enregistré et confirmé (rang ${r.rang}).` };
    }
  } catch (e) {
    if (e instanceof EncConfirmationError) return { status: "error", message: e.message };
    throw e;
  }
}
