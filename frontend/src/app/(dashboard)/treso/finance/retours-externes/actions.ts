"use server";

import { remettreChronoDemande } from "backend";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import {
  chargerContexteRattachement,
  chercherDemandeRattachable,
  prisma,
  refusConflitInteret,
  refusRetourRattache,
  type DemandeRattachable,
} from "backend";
import { avecSignature } from "@/lib/signature";

type SimpleActionResult = { status: "success" | "error"; message: string };

const RETOUR_EXTERNE_SOURCE = "retour_externe";

const schema = z.object({
  collaborateurId: z.string().trim().min(1).optional(),
  nomExterne: z.string().trim().min(2, "Le nom de la personne externe est trop court.").optional(),
  montantChequeInitial: z.coerce.number().positive("Le montant du chèque initial doit être supérieur à 0."),
  montantRetourne: z.coerce.number().positive("Le montant retourné doit être supérieur à 0."),
  motif: z.string().trim().min(10, "Le motif est obligatoire (10 caractères minimum)."),
  pieceJointeUrl: z.string().trim().min(1, "Le justificatif du retour est obligatoire."),
  pieceJointeChequeUrl: z.string().trim().min(1, "Le justificatif du chèque initial est obligatoire."),
  demandeId: z.string().trim().min(1).optional(),
  ligneDemandeId: z.string().trim().min(1).optional(),
});

/**
 * Retour EXTERNE (voir CLAUDE.md "Retour externe") : argent revenu en caisse
 * suite à un règlement fait hors système. Réservé au Responsable Finance
 * (`treso.valider_demande` ET PAS `treso.approuver_validation_complete`, même
 * garde que `validerLignesAction`). Écriture immédiate dans JournalCaisse,
 * sans statut "en attente" ni double validation.
 */
export async function creerRetourExterneAction(
  collaborateurId: string | undefined,
  nomExterne: string | undefined,
  montantChequeInitial: number,
  montantRetourne: number,
  motif: string,
  pieceJointeUrl: string,
  pieceJointeChequeUrl: string,
  demandeId?: string,
  ligneDemandeId?: string
): Promise<SimpleActionResult> {
  return avecSignature({ action: "retour_externe", permission: "treso.creer_retour_externe", cible: demandeId ? { type: "demande", id: demandeId } : null, entite: "RetourExterne" }, () => creerRetourExterneInterne(collaborateurId, nomExterne, montantChequeInitial, montantRetourne, motif, pieceJointeUrl, pieceJointeChequeUrl, demandeId, ligneDemandeId));
}

async function creerRetourExterneInterne(
  collaborateurId: string | undefined,
  nomExterne: string | undefined,
  montantChequeInitial: number,
  montantRetourne: number,
  motif: string,
  pieceJointeUrl: string,
  pieceJointeChequeUrl: string,
  demandeId?: string,
  ligneDemandeId?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_retour_externe")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = schema.safeParse({
    collaborateurId: collaborateurId || undefined,
    nomExterne: nomExterne || undefined,
    montantChequeInitial,
    montantRetourne,
    motif,
    pieceJointeUrl,
    pieceJointeChequeUrl,
    demandeId: demandeId || undefined,
    ligneDemandeId: ligneDemandeId || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }
  const d = parsed.data;
  if (d.pieceJointeUrl === d.pieceJointeChequeUrl) {
    return { status: "error", message: "Les deux justificatifs (chèque initial et retour) doivent être deux fichiers distincts." };
  }
  if ((d.collaborateurId ? 1 : 0) + (d.nomExterne ? 1 : 0) !== 1) {
    return { status: "error", message: "Renseignez soit un collaborateur, soit un nom externe (jamais les deux ni aucun)." };
  }

  if (d.ligneDemandeId && !d.demandeId) {
    return { status: "error", message: "Indiquez la demande à laquelle l'article appartient." };
  }

  let personne = d.nomExterne ?? "";
  if (d.collaborateurId) {
    const user = await prisma.user.findUnique({ where: { id: d.collaborateurId } });
    if (!user) {
      return { status: "error", message: "Collaborateur introuvable." };
    }
    personne = user.fullName;
  }

  // Rattachement FACULTATIF à une demande + article (lot G bis) : retour d'un fonds versé par banque. Non rattaché, le
  // retour externe reste autonome (inchangé).
  let rattache: { demandeId: string; reference: string; createurId: string; libelleArticle: string | null } | null = null;
  if (d.demandeId) {
    const refusConflit = await refusConflitInteret(prisma, { demandeId: d.demandeId, ligneDemandeId: d.ligneDemandeId ?? null }, session.user.id);
    if (refusConflit) {
      return { status: "error", message: refusConflit };
    }
    const demande = await prisma.demande.findUnique({
      where: { id: d.demandeId },
      select: { id: true, reference: true, createurId: true },
    });
    if (!demande) {
      return { status: "error", message: "Demande introuvable." };
    }
    const ligne = d.ligneDemandeId
      ? await prisma.ligneDemande.findFirst({ where: { id: d.ligneDemandeId, demandeId: demande.id }, select: { libelle: true } })
      : null;
    rattache = { demandeId: demande.id, reference: demande.reference, createurId: demande.createurId, libelleArticle: ligne?.libelle ?? null };
  }

  const refusTransaction = await prisma.$transaction(async (tx) => {
    if (rattache) {
      // Deux retours rattachés simultanément au même article : le second attend, puis voit le premier dans le plafond.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retourexterne:${rattache.demandeId}:${d.ligneDemandeId ?? ""}`}))`;
      const ctx = await chargerContexteRattachement(rattache.demandeId, d.ligneDemandeId ?? null);
      if (!ctx) return "Demande introuvable.";
      const refus = refusRetourRattache(ctx, d.montantRetourne);
      if (refus) return refus;
    }
    const pj = await tx.pieceJointe.create({ data: { url: d.pieceJointeUrl } });
    const pjCheque = await tx.pieceJointe.create({ data: { url: d.pieceJointeChequeUrl } });
    const retour = await tx.retourExterne.create({
      data: {
        collaborateurId: d.collaborateurId ?? null,
        nomExterne: d.nomExterne ?? null,
        montantChequeInitial: d.montantChequeInitial,
        montantRetourne: d.montantRetourne,
        motif: d.motif,
        pieceJointeId: pj.id,
        pieceJointeChequeId: pjCheque.id,
        demandeId: rattache?.demandeId ?? null,
        ligneDemandeId: d.ligneDemandeId ?? null,
        creeParId: session.user.id,
      },
    });
    await tx.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant: d.montantRetourne,
        source: RETOUR_EXTERNE_SOURCE,
        refId: retour.id,
        userId: session.user.id,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "RetourExterne",
        entityId: retour.id,
        action: "retour_externe",
        detail: `Retour externe de ${personne} : ${d.montantRetourne.toLocaleString("fr-FR")} FCFA retournés (chèque initial déclaré : ${d.montantChequeInitial.toLocaleString("fr-FR")} FCFA) — motif : ${d.motif} (justificatifs joints : chèque initial et retour)${rattache ? ` — rattaché à la demande ${rattache.reference}${rattache.libelleArticle ? `, article « ${rattache.libelleArticle} »` : ""}` : ""}.`,
        userId: session.user.id,
      },
    });
    if (rattache) {
      await tx.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: rattache.demandeId,
          action: "retour_externe_rattache",
          detail: `Retour de ${d.montantRetourne.toLocaleString("fr-FR")} FCFA enregistré par la Finance (retour externe, fonds versé par banque et rendu à la caisse)${rattache.libelleArticle ? ` pour l'article « ${rattache.libelleArticle} »` : ""}, rattaché à la demande ${rattache.reference} (réf. ${retour.id}).`,
          userId: session.user.id,
        },
      });
    }
    return null;
  });
  if (refusTransaction) {
    return { status: "error", message: refusTransaction };
  }
  if (rattache) {
    await notify({
      userId: rattache.createurId,
      titre: "Retour enregistré sur votre demande",
      message: `La Finance a enregistré un retour de ${d.montantRetourne.toLocaleString("fr-FR")} FCFA sur votre demande ${rattache.reference}${rattache.libelleArticle ? ` (article « ${rattache.libelleArticle} »)` : ""}.`,
      lien: `/treso/demandes/${rattache.demandeId}`,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  }

  if (rattache) await remettreChronoDemande(rattache.demandeId);
  revalidatePath("/treso/finance", "layout");
  if (rattache) revalidatePath("/treso/demandes", "layout");
  publishDataChanged();
  return {
    status: "success",
    message: `Retour externe de ${d.montantRetourne.toLocaleString("fr-FR")} FCFA enregistré : la caisse est créditée.`,
  };
}

/**
 * Recherche d'une demande par sa référence, pour rattacher un retour externe : renvoie ses articles qui ont des fonds
 * versés par banque (avec ce qui a déjà été retourné et le solde à régulariser). Même garde que la création.
 */
export async function chercherDemandeRattachableAction(
  reference: string
): Promise<{ status: "success"; demande: DemandeRattachable } | { status: "error"; message: string }> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_retour_externe")) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (reference.trim().length < 3) {
    return { status: "error", message: "Saisissez la référence de la demande (ex : DEM-2026-000123)." };
  }
  const demande = await chercherDemandeRattachable(reference);
  if (!demande) {
    return { status: "error", message: "Aucune demande ne porte cette référence." };
  }
  if (demande.articles.length === 0) {
    return { status: "error", message: `La demande ${demande.reference} n'a aucun règlement par banque confirmé : il n'y a pas de retour de fonds bancaire à y rattacher.` };
  }
  return { status: "success", demande };
}
