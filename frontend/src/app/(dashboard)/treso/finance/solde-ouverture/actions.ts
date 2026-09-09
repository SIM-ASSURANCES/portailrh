"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import {
  getSoldeOuvertureInfo,
  SOLDE_OUVERTURE_ANNULATION_SOURCE,
  SOLDE_OUVERTURE_CORRECTION_SOURCE,
  SOLDE_OUVERTURE_SOURCE,
} from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

function revalidateSoldeOuverturePaths() {
  revalidatePath("/treso/finance/solde-ouverture");
  revalidatePath("/treso/finance");
  publishDataChanged();
}

const montantSchema = z.coerce.number().positive("Le montant doit être supérieur à 0");

/**
 * Définit le solde d'ouverture de caisse — UNE SEULE FOIS (voir CLAUDE.md
 * "Solde d'ouverture de caisse") : en conditions réelles, de l'argent
 * physique peut déjà être présent en caisse avant que l'application ne
 * commence à l'utiliser ; `getSoldeCaisse()` partait implicitement de 0
 * sans ce mécanisme. Réservée à Finance/Admin (`treso.effectuer_reglement`
 * — la même permission qui gouverne déjà les autres écritures
 * `JournalCaisse` — OU `isAdmin()`), jamais au DG (`treso.valider_demande`
 * seule ne suffit pas).
 *
 * Crée une écriture `JournalCaisse` ORDINAIRE (`type: "ENTREE"`,
 * `source: "solde_ouverture"`) — `getSoldeCaisse()` n'a besoin d'AUCUNE
 * modification pour en tenir compte, il somme déjà toutes les écritures
 * sans distinction de source. `demandeId: null` : seul cas de mouvement de
 * caisse sans demande d'origine (voir la migration
 * `journalcaisse_demande_optionnelle`).
 */
export async function definirSoldeOuvertureAction(
  montant: number,
  motif?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !(isAdmin(session) || hasPermission(session, "treso.effectuer_reglement"))) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantSchema.safeParse(montant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }

  // Empêche un second solde d'ouverture — fausserait tout le grand livre.
  // Défense en profondeur : revérifié ici juste avant l'écriture, jamais
  // uniquement via le masquage du formulaire côté UI.
  const dejaDefini = await prisma.journalCaisse.count({ where: { source: SOLDE_OUVERTURE_SOURCE } });
  if (dejaDefini > 0) {
    return {
      status: "error",
      message: "Un solde d'ouverture a déjà été défini. Utilisez la correction si le montant initial était erroné.",
    };
  }

  await prisma.$transaction(async (tx) => {
    const entree = await tx.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant: parsedMontant.data,
        source: SOLDE_OUVERTURE_SOURCE,
        refId: SOLDE_OUVERTURE_SOURCE,
        userId: session.user.id,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "JournalCaisse",
        entityId: entree.id,
        action: "SOLDE_OUVERTURE",
        detail: `Solde d'ouverture défini à ${parsedMontant.data.toLocaleString("fr-FR")} FCFA${
          motif?.trim() ? ` — ${motif.trim()}` : ""
        }`,
        userId: session.user.id,
      },
    });
  });

  revalidateSoldeOuverturePaths();

  return {
    status: "success",
    message: `Solde d'ouverture défini à ${parsedMontant.data.toLocaleString("fr-FR")} FCFA.`,
  };
}

const motifCorrectionSchema = z
  .string()
  .trim()
  .min(3, "Le motif de la correction est obligatoire (3 caractères minimum)");

/**
 * Corrige le solde d'ouverture après coup (montant initial mal saisi).
 * **Jamais une édition silencieuse de l'écriture existante** — même
 * principe que `annulerReglementAction` (Ticket 4) : une écriture
 * compensatoire neutralise le montant actuellement en vigueur (grand livre
 * immuable), puis une nouvelle écriture porte le montant corrigé. Motif
 * obligatoire, comme toute annulation/correction du module.
 */
export async function corrigerSoldeOuvertureAction(
  nouveauMontant: number,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !(isAdmin(session) || hasPermission(session, "treso.effectuer_reglement"))) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantSchema.safeParse(nouveauMontant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }
  const parsedMotif = motifCorrectionSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const { existe, montantActuel } = await getSoldeOuvertureInfo();
  if (!existe) {
    return { status: "error", message: "Aucun solde d'ouverture à corriger — définissez-en un d'abord." };
  }

  await prisma.$transaction(async (tx) => {
    // Neutralise le montant actuellement en vigueur (jamais 0 si `existe`
    // est vrai, sauf correction déjà ramenée à 0 par une précédente
    // itération — géré sans écriture inutile dans ce cas limite).
    if (montantActuel !== 0) {
      await tx.journalCaisse.create({
        data: {
          type: montantActuel > 0 ? "SORTIE" : "ENTREE",
          montant: Math.abs(montantActuel),
          source: SOLDE_OUVERTURE_ANNULATION_SOURCE,
          refId: SOLDE_OUVERTURE_SOURCE,
          userId: session.user.id,
        },
      });
    }

    const nouvelleEcriture = await tx.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant: parsedMontant.data,
        source: SOLDE_OUVERTURE_CORRECTION_SOURCE,
        refId: SOLDE_OUVERTURE_SOURCE,
        userId: session.user.id,
      },
    });

    await tx.historiqueEntry.create({
      data: {
        entity: "JournalCaisse",
        entityId: nouvelleEcriture.id,
        action: "CORRECTION_SOLDE_OUVERTURE",
        detail: `Solde d'ouverture corrigé : ${montantActuel.toLocaleString("fr-FR")} FCFA → ${parsedMontant.data.toLocaleString("fr-FR")} FCFA — ${parsedMotif.data}`,
        userId: session.user.id,
      },
    });
  });

  revalidateSoldeOuverturePaths();

  return {
    status: "success",
    message: `Solde d'ouverture corrigé à ${parsedMontant.data.toLocaleString("fr-FR")} FCFA.`,
  };
}
