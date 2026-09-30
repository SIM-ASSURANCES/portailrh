"use server";

// Paramètres V2 du module Encaissements (docs/encaissements-conception.md §5.2, CDC V2.6 §3.6, F9) : branches,
// bénéficiaire des honoraires daté, partenaires (partage des accessoires), taux de contrôle. SANS écran pour l'instant
// (le F9 arrive au Lot 3, voir CLAUDE.md) — ces Server Actions vivent déjà à la route qui portera cet écran, même
// convention que le reste du portail pour une fonctionnalité livrée avant son interface.
//
// Toutes réservées à `enc.parametrer`, revérifiée ici dans CHAQUE action (jamais seulement via le layout
// `/encaissements`, qui ne garde que `enc.consulter`). Chaque écriture est tracée dans `EncAudit` (avant/après, même
// transaction que la mutation) — jamais de modification silencieuse.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { getClientIp } from "@/lib/auditLog";
import { prisma } from "backend";
import { ecrireAudit } from "backend";
import {
  beneficiaireHonorairesEnVigueur,
  normaliserCodeBranche,
  normaliserNomPartenaire,
  pourcentagePartenaireVersFraction,
  verifierCleTauxControle,
  EncReferentielError,
} from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

function peutParametrer(session: { estAdmin: boolean; permissions: string[] } | null): boolean {
  return !!session && hasPermission(session, "enc.parametrer");
}

function revalidateParametresPaths() {
  // Pas encore d'écran dédié (`/encaissements/parametres`, Lot 3) : revalide l'espace du module dans son ensemble,
  // pour qu'un futur écran affiché sous /encaissements se mette à jour sans changement supplémentaire à cet endroit.
  revalidatePath("/encaissements", "layout");
  publishDataChanged();
}

/** Message uniforme pour l'unique erreur métier possible ici (`encReferentiels.ts`), jamais une pile technique brute. */
function messageErreurMetier(e: unknown): string | null {
  if (e instanceof EncReferentielError) return e.message;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Branches (P1, provisoire — liste paramétrée par la Finance, voir docs/encaissements-conception.md §5.1)
// ---------------------------------------------------------------------------------------------------------------

const creerBrancheSchema = z.object({
  code: z.string().trim().min(1),
  libelle: z.string().trim().min(2, "Le libellé doit contenir au moins 2 caractères"),
});

export async function creerBrancheAction(code: string, libelle: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = creerBrancheSchema.safeParse({ code, libelle });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  let codeNormalise: string;
  try {
    codeNormalise = normaliserCodeBranche(parsed.data.code);
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  if (await prisma.encBranche.findUnique({ where: { code: codeNormalise } })) {
    return { status: "error", message: `Une branche « ${codeNormalise} » existe déjà.` };
  }

  const ip = await getClientIp();
  const branche = await prisma.$transaction(async (tx) => {
    const cree = await tx.encBranche.create({
      data: { code: codeNormalise, libelle: parsed.data.libelle, creeParId: session.user.id },
    });
    await ecrireAudit(tx, {
      entite: "EncBranche",
      entiteId: cree.id,
      action: "creation",
      apres: cree,
      userId: session.user.id,
      ip,
    });
    return cree;
  });

  revalidateParametresPaths();
  return { status: "success", message: `Branche « ${branche.code} » créée.` };
}

export async function toggleBrancheActiveAction(brancheId: string, actif: boolean): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const avant = await prisma.encBranche.findUnique({ where: { id: brancheId } });
  if (!avant) return { status: "error", message: "Branche introuvable." };

  const ip = await getClientIp();
  const branche = await prisma.$transaction(async (tx) => {
    const maj = await tx.encBranche.update({ where: { id: brancheId }, data: { actif } });
    await ecrireAudit(tx, {
      entite: "EncBranche",
      entiteId: maj.id,
      action: actif ? "activation" : "desactivation",
      avant,
      apres: maj,
      userId: session.user.id,
      ip,
    });
    return maj;
  });

  revalidateParametresPaths();
  return { status: "success", message: actif ? `Branche « ${branche.code} » activée.` : `Branche « ${branche.code} » désactivée.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Partenaires — partage des accessoires (CDC §3.6, branché sur choisirTauxAccessoires, encCalcul.ts)
// ---------------------------------------------------------------------------------------------------------------

const nomPartenaireSchema = z.string().trim().min(1, "Le nom du partenaire ne peut pas être vide.");
const pourcentSchema = z.number().min(0).max(100).nullable();

export async function creerPartenaireAction(
  nom: string,
  partAccessoiresPourcent: number | null
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const nomParsed = nomPartenaireSchema.safeParse(nom);
  const pctParsed = pourcentSchema.safeParse(partAccessoiresPourcent);
  if (!nomParsed.success || !pctParsed.success) {
    return { status: "error", message: "Formulaire invalide." };
  }

  let cleNom: string;
  let fraction: string | null;
  try {
    cleNom = normaliserNomPartenaire(nomParsed.data);
    fraction = pourcentagePartenaireVersFraction(pctParsed.data);
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  if (await prisma.encPartenaire.findUnique({ where: { cleNom } })) {
    return { status: "error", message: `Un partenaire correspondant à « ${nomParsed.data} » existe déjà.` };
  }

  const ip = await getClientIp();
  const partenaire = await prisma.$transaction(async (tx) => {
    const cree = await tx.encPartenaire.create({
      data: {
        cleNom,
        nom: nomParsed.data,
        partAccessoiresPartenaire: fraction,
        creeParId: session.user.id,
      },
    });
    await ecrireAudit(tx, {
      entite: "EncPartenaire",
      entiteId: cree.id,
      action: "creation",
      apres: cree,
      userId: session.user.id,
      ip,
    });
    return cree;
  });

  revalidateParametresPaths();
  return { status: "success", message: `Partenaire « ${partenaire.nom} » créé.` };
}

export async function modifierTauxAccessoiresPartenaireAction(
  partenaireId: string,
  partAccessoiresPourcent: number | null
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const pctParsed = pourcentSchema.safeParse(partAccessoiresPourcent);
  if (!pctParsed.success) return { status: "error", message: "Formulaire invalide." };

  const avant = await prisma.encPartenaire.findUnique({ where: { id: partenaireId } });
  if (!avant) return { status: "error", message: "Partenaire introuvable." };

  let fraction: string | null;
  try {
    fraction = pourcentagePartenaireVersFraction(pctParsed.data);
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  const ip = await getClientIp();
  const partenaire = await prisma.$transaction(async (tx) => {
    const maj = await tx.encPartenaire.update({
      where: { id: partenaireId },
      data: { partAccessoiresPartenaire: fraction, majParId: session.user.id },
    });
    await ecrireAudit(tx, {
      entite: "EncPartenaire",
      entiteId: maj.id,
      action: "modification_taux_accessoires",
      avant,
      apres: maj,
      userId: session.user.id,
      ip,
    });
    return maj;
  });

  revalidateParametresPaths();
  return { status: "success", message: `Taux du partenaire « ${partenaire.nom} » mis à jour.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Part partenaire par défaut des accessoires (EncParametre, encParametres.ts)
// ---------------------------------------------------------------------------------------------------------------

const pourcentDefautSchema = z.number().min(0).max(100);

export async function definirPartAccessoiresDefautAction(partPartenairePourcent: number): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = pourcentDefautSchema.safeParse(partPartenairePourcent);
  if (!parsed.success) return { status: "error", message: "Le pourcentage doit être compris entre 0 et 100." };

  const cle = "accessoires.part_partenaire_defaut";
  const avant = await prisma.encParametre.findUnique({ where: { cle } });
  if (!avant) return { status: "error", message: "Paramètre introuvable en base." };

  let fraction: string;
  try {
    fraction = pourcentagePartenaireVersFraction(parsed.data)!;
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.encParametre.update({ where: { cle }, data: { valeur: fraction, majParId: session.user.id } });
    await ecrireAudit(tx, {
      entite: "EncParametre",
      entiteId: cle,
      action: "modification",
      avant,
      apres,
      userId: session.user.id,
      ip,
    });
  });

  revalidateParametresPaths();
  return { status: "success", message: `Part partenaire par défaut fixée à ${parsed.data} %.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Bénéficiaire des honoraires (CDC §3.6) — jamais une ligne modifiée, toujours une nouvelle ligne datée
// ---------------------------------------------------------------------------------------------------------------

const definirBeneficiaireSchema = z.object({
  nom: z.string().trim().min(1, "Le nom du bénéficiaire ne peut pas être vide."),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de début invalide (AAAA-MM-JJ)."),
});

export async function definirBeneficiaireHonorairesAction(nom: string, dateDebut: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = definirBeneficiaireSchema.safeParse({ nom, dateDebut });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const date = new Date(`${parsed.data.dateDebut}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { status: "error", message: "Date de début invalide." };

  if (await prisma.encBeneficiaireHonoraires.findUnique({ where: { dateDebut: date } })) {
    return { status: "error", message: `Une ligne existe déjà à la date du ${parsed.data.dateDebut}.` };
  }

  const ip = await getClientIp();
  const ligne = await prisma.$transaction(async (tx) => {
    const cree = await tx.encBeneficiaireHonoraires.create({
      data: { nom: parsed.data.nom, dateDebut: date, creeParId: session.user.id },
    });
    await ecrireAudit(tx, {
      entite: "EncBeneficiaireHonoraires",
      entiteId: cree.id,
      action: "creation",
      apres: cree,
      userId: session.user.id,
      ip,
    });
    return cree;
  });

  // Rappel non bloquant (jamais une erreur) : une nouvelle ligne dont la date de début est ANTÉRIEURE à la plus
  // récente déjà existante ne changerait le bénéficiaire en vigueur pour aucun encaissement futur — confusion
  // possible, signalée dans le message de succès plutôt que refusée (le cahier ne l'interdit pas).
  const toutes = await prisma.encBeneficiaireHonoraires.findMany({ select: { nom: true, dateDebut: true } });
  const enVigueurAujourdHui = beneficiaireHonorairesEnVigueur(toutes, new Date());

  revalidateParametresPaths();
  return {
    status: "success",
    message:
      enVigueurAujourdHui?.nom === ligne.nom
        ? `Bénéficiaire « ${ligne.nom} » enregistré, en vigueur depuis le ${parsed.data.dateDebut}.`
        : `Bénéficiaire « ${ligne.nom} » enregistré (date antérieure à la ligne déjà en vigueur — sans effet sur le bénéficiaire actuel).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Taux de contrôle (CDC §3.6, F9) — facultatifs, aucun effet sur les montants (signalement seulement)
// ---------------------------------------------------------------------------------------------------------------

const tauxOptionnelSchema = z.number().min(0).max(100).nullable().optional();

const definirTauxControleSchema = z.object({
  produitCode: z.string().trim().min(1).nullable(),
  partenaireId: z.string().trim().min(1).nullable(),
  tauxTaxe: tauxOptionnelSchema,
  tauxCommission: tauxOptionnelSchema,
  tauxAccessoires: tauxOptionnelSchema,
  tauxHonoraires: tauxOptionnelSchema,
});

/** Convertit un pourcentage optionnel (0-100, ou absent/nul) en fraction texte pour `Decimal(7,6)`. */
function versFractionOptionnelle(pourcent: number | null | undefined): string | null {
  if (pourcent === null || pourcent === undefined) return null;
  return pourcentagePartenaireVersFraction(pourcent);
}

export async function definirTauxControleAction(input: {
  produitCode: string | null;
  partenaireId: string | null;
  tauxTaxe?: number | null;
  tauxCommission?: number | null;
  tauxAccessoires?: number | null;
  tauxHonoraires?: number | null;
}): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = definirTauxControleSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide." };

  try {
    verifierCleTauxControle({ produitCode: parsed.data.produitCode, partenaireId: parsed.data.partenaireId });
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  if (parsed.data.partenaireId && !(await prisma.encPartenaire.findUnique({ where: { id: parsed.data.partenaireId } }))) {
    return { status: "error", message: "Partenaire introuvable." };
  }

  // `findUnique` sur la clé composée n'accepte pas `null` côté typage Prisma pour une colonne nullable (limite connue
  // du client généré, voir `EncTauxControleProduitCodePartenaireIdCompoundUniqueInput` : `string`, jamais `string | null`)
  // — `findFirst` avec un filtre classique, lui, accepte `null` normalement.
  const existant = await prisma.encTauxControle.findFirst({
    where: { produitCode: parsed.data.produitCode, partenaireId: parsed.data.partenaireId },
  });
  if (existant) {
    return { status: "error", message: "Un taux de contrôle existe déjà pour ce produit/partenaire — supprimez-le avant d'en redéfinir un." };
  }

  let data: { tauxTaxe: string | null; tauxCommission: string | null; tauxAccessoires: string | null; tauxHonoraires: string | null };
  try {
    data = {
      tauxTaxe: versFractionOptionnelle(parsed.data.tauxTaxe),
      tauxCommission: versFractionOptionnelle(parsed.data.tauxCommission),
      tauxAccessoires: versFractionOptionnelle(parsed.data.tauxAccessoires),
      tauxHonoraires: versFractionOptionnelle(parsed.data.tauxHonoraires),
    };
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const ligne = await tx.encTauxControle.create({
      data: { produitCode: parsed.data.produitCode, partenaireId: parsed.data.partenaireId, majParId: session.user.id, ...data },
    });
    await ecrireAudit(tx, {
      entite: "EncTauxControle",
      entiteId: ligne.id,
      action: "creation",
      apres: ligne,
      userId: session.user.id,
      ip,
    });
  });

  revalidateParametresPaths();
  return { status: "success", message: "Taux de contrôle enregistré." };
}

export async function supprimerTauxControleAction(tauxControleId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !peutParametrer(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const avant = await prisma.encTauxControle.findUnique({ where: { id: tauxControleId } });
  if (!avant) return { status: "error", message: "Taux de contrôle introuvable." };

  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    await tx.encTauxControle.delete({ where: { id: tauxControleId } });
    await ecrireAudit(tx, {
      entite: "EncTauxControle",
      entiteId: tauxControleId,
      action: "suppression",
      avant,
      userId: session.user.id,
      ip,
    });
  });

  revalidateParametresPaths();
  return { status: "success", message: "Taux de contrôle supprimé." };
}
