"use server";

// Server Actions du paramétrage de Gestion Compta : formats d'import (lot GC-3i ; docs/PLAN_GESTION_COMPTA.md, GC-3).
//
// Toutes exigent `cpt.parametrer`, revérifiée ici (jamais seulement le layout `/compta` ni le masquage des boutons). Une
// création, un changement de format par défaut ou une désactivation s'écrivent dans UNE transaction avec leur audit `CptAudit`,
// sous un verrou par type d'import : deux personnes qui désignent « le » format par défaut en même temps ne se heurtent jamais à
// l'index unique « un format par défaut par type » — la seconde passe après la première.

import { readFile } from "node:fs/promises";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  apercuTableurCpt,
  construireDefinitionProduction,
  CptImportLectureError,
  ecrireAuditCpt,
  estTypeReleveCpt,
  formatReleveProposeCpt,
  getTrustedClientIp,
  LIBELLE_TYPE_IMPORT_CPT,
  prisma,
  proposerFormatProduction,
  validerDefinitionFormat,
  type ChoixColonneProduction,
  type PropositionFormatProduction,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { cheminFichierCpt, CptPieceJointeError } from "@/lib/compta/pieceJointe";

export type ResultatSimpleFormat = { status: "success"; message: string } | { status: "error"; message: string };

export type ResultatApercuFormat =
  | { status: "success"; enTetes: string[]; proposition: PropositionFormatProduction }
  | { status: "error"; message: string };

const MESSAGE_REFUS = "Action non autorisée.";
const NOM_MIN = 3;
const NOM_MAX = 80;

async function sessionParametrage() {
  const session = await getSession();
  return session && hasPermission(session, "cpt.parametrer") ? session : null;
}

/** Verrou par type d'import, tenu jusqu'à la fin de la transaction. */
async function verrouillerType(tx: Pick<typeof prisma, "$executeRaw">, type: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cpt:format:${type}`}))`;
}

/**
 * Lit un fichier d'exemple déjà déposé (route `/api/compta/import/upload`) et propose l'association de ses colonnes aux champs du
 * bordereau de production. Rien n'est écrit : l'utilisateur confirme ou corrige chaque association avant l'enregistrement.
 */
export async function apercuFormatProductionAction(pieceJointeId: string, ligneEntete: number): Promise<ResultatApercuFormat> {
  if (!(await sessionParametrage())) return { status: "error", message: MESSAGE_REFUS };
  if (typeof pieceJointeId !== "string" || typeof ligneEntete !== "number") return { status: "error", message: "Demande invalide." };

  const piece = await prisma.cptPieceJointe.findUnique({ where: { id: pieceJointeId }, select: { url: true } });
  if (!piece) return { status: "error", message: "Fichier introuvable : déposez-le de nouveau." };
  let contenu: Buffer;
  try {
    contenu = await readFile(cheminFichierCpt(piece.url));
  } catch (erreur) {
    if (erreur instanceof CptPieceJointeError) return { status: "error", message: erreur.message };
    return { status: "error", message: "Fichier introuvable sur le serveur : déposez-le de nouveau." };
  }
  try {
    const apercu = apercuTableurCpt(contenu, ligneEntete);
    return { status: "success", enTetes: apercu.enTetes, proposition: proposerFormatProduction(apercu.enTetes, apercu.echantillon) };
  } catch (erreur) {
    if (erreur instanceof CptImportLectureError) return { status: "error", message: erreur.message };
    throw erreur;
  }
}

export interface EntreeNouveauFormat {
  nom: string;
  ligneEntete: number;
  choix: ChoixColonneProduction[];
  parDefaut: boolean;
}

function choixValides(choix: unknown): choix is ChoixColonneProduction[] {
  return (
    Array.isArray(choix) &&
    choix.length <= 200 &&
    choix.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as ChoixColonneProduction).entete === "string" &&
        ((c as ChoixColonneProduction).champ === null || typeof (c as ChoixColonneProduction).champ === "string") &&
        ((c as ChoixColonneProduction).formatDate === undefined ||
          (c as ChoixColonneProduction).formatDate === null ||
          typeof (c as ChoixColonneProduction).formatDate === "string")
    )
  );
}

/** Enregistre un format d'import de PRODUCTION construit à l'écran. Le premier format actif d'un type devient son format par défaut. */
export async function creerFormatProductionAction(entree: EntreeNouveauFormat): Promise<ResultatSimpleFormat> {
  const session = await sessionParametrage();
  if (!session) return { status: "error", message: MESSAGE_REFUS };
  if (!entree || typeof entree.nom !== "string" || typeof entree.ligneEntete !== "number" || !choixValides(entree.choix)) {
    return { status: "error", message: "Demande invalide." };
  }

  const nom = entree.nom.replace(/\s+/g, " ").trim();
  if (nom.length < NOM_MIN || nom.length > NOM_MAX) return { status: "error", message: `Le nom doit comporter de ${NOM_MIN} à ${NOM_MAX} caractères.` };

  const definition = construireDefinitionProduction(entree.ligneEntete, entree.choix);
  if (!definition.ok) return { status: "error", message: definition.erreurs.join(" ") };

  const ip = getTrustedClientIp(await headers());
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatSimpleFormat> => {
    await verrouillerType(tx, "PRODUCTION");
    if (await tx.cptFormatImport.findUnique({ where: { type_nom: { type: "PRODUCTION", nom } }, select: { id: true } })) {
      return { status: "error", message: `Un format « ${nom} » existe déjà pour ce type de fichier.` };
    }
    const aDejaUnDefaut = (await tx.cptFormatImport.count({ where: { type: "PRODUCTION", parDefaut: true, actif: true } })) > 0;
    const parDefaut = entree.parDefaut || !aDejaUnDefaut;
    if (parDefaut) await tx.cptFormatImport.updateMany({ where: { type: "PRODUCTION", parDefaut: true }, data: { parDefaut: false } });
    const cree = await tx.cptFormatImport.create({
      data: {
        type: "PRODUCTION",
        nom,
        ligneEntete: definition.definition.ligneEntete,
        colonnes: definition.definition.colonnes as unknown as object[],
        parDefaut,
        actif: true,
      },
    });
    await ecrireAuditCpt(tx, {
      entite: "CptFormatImport",
      entiteId: cree.id,
      action: "creation_format",
      apres: { type: cree.type, nom, ligneEntete: cree.ligneEntete, nbColonnes: definition.definition.colonnes.length, parDefaut },
      userId: session.user.id,
      ip,
    });
    return { status: "success", message: `Format « ${nom} » enregistré${parDefaut ? " et défini par défaut" : ""}.` };
  });

  if (resultat.status === "success") {
    revalidatePath("/compta", "layout");
    publishDataChanged();
  }
  return resultat;
}

/**
 * Enregistre le format PROPOSÉ d'un type de relevé (`formatReleveProposeCpt`, colonnes déduites du plan : aucun vrai relevé n'a encore
 * été fourni, question Q6). Il devient le format par défaut du type s'il n'en a pas encore. Refusé si le type a déjà un format : un
 * format réel se crée ou se corrige à la main, jamais en écrasant un format existant.
 */
export async function creerFormatReleveProposeAction(type: string): Promise<ResultatSimpleFormat> {
  const session = await sessionParametrage();
  if (!session) return { status: "error", message: MESSAGE_REFUS };
  if (typeof type !== "string" || !estTypeReleveCpt(type)) return { status: "error", message: "Type de relevé inconnu." };

  const definition = formatReleveProposeCpt(type);
  const verification = validerDefinitionFormat(definition);
  if (!verification.ok) return { status: "error", message: verification.erreurs.join(" ") };
  const nom = `Modèle proposé (provisoire) — ${LIBELLE_TYPE_IMPORT_CPT[type]}`;

  const ip = getTrustedClientIp(await headers());
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatSimpleFormat> => {
    await verrouillerType(tx, type);
    if ((await tx.cptFormatImport.count({ where: { type } })) > 0) {
      return { status: "error", message: "Ce type de relevé a déjà un format : modifiez-le plutôt que d'en proposer un second." };
    }
    const cree = await tx.cptFormatImport.create({
      data: { type, nom, ligneEntete: definition.ligneEntete, colonnes: definition.colonnes as unknown as object[], parDefaut: true, actif: true },
    });
    await ecrireAuditCpt(tx, {
      entite: "CptFormatImport",
      entiteId: cree.id,
      action: "creation_format",
      apres: { type, nom, ligneEntete: cree.ligneEntete, nbColonnes: definition.colonnes.length, parDefaut: true, source: "modele_propose" },
      userId: session.user.id,
      ip,
    });
    return { status: "success", message: `Format « ${nom} » enregistré et défini par défaut.` };
  });

  if (resultat.status === "success") {
    revalidatePath("/compta", "layout");
    publishDataChanged();
  }
  return resultat;
}

/** Désigne le format par défaut de son type (l'ancien cesse de l'être). Un format inactif ne peut pas l'être. */
export async function definirFormatParDefautAction(formatId: string): Promise<ResultatSimpleFormat> {
  const session = await sessionParametrage();
  if (!session) return { status: "error", message: MESSAGE_REFUS };
  if (typeof formatId !== "string") return { status: "error", message: "Demande invalide." };

  const ip = getTrustedClientIp(await headers());
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatSimpleFormat> => {
    const format = await tx.cptFormatImport.findUnique({ where: { id: formatId } });
    if (!format) return { status: "error", message: "Format introuvable." };
    await verrouillerType(tx, format.type);
    const courant = await tx.cptFormatImport.findUnique({ where: { id: formatId } });
    if (!courant) return { status: "error", message: "Format introuvable." };
    if (!courant.actif) return { status: "error", message: "Réactivez ce format avant de le définir par défaut." };
    if (courant.parDefaut) return { status: "error", message: "Ce format est déjà le format par défaut." };

    const ancien = await tx.cptFormatImport.findFirst({ where: { type: courant.type, parDefaut: true }, select: { id: true, nom: true } });
    await tx.cptFormatImport.updateMany({ where: { type: courant.type, parDefaut: true }, data: { parDefaut: false } });
    await tx.cptFormatImport.update({ where: { id: courant.id }, data: { parDefaut: true } });
    await ecrireAuditCpt(tx, {
      entite: "CptFormatImport",
      entiteId: courant.id,
      action: "format_par_defaut",
      avant: { parDefaut: false, ancienParDefaut: ancien?.nom ?? null },
      apres: { parDefaut: true, nom: courant.nom },
      userId: session.user.id,
      ip,
    });
    return { status: "success", message: `« ${courant.nom} » est maintenant le format par défaut.` };
  });

  if (resultat.status === "success") {
    revalidatePath("/compta", "layout");
    publishDataChanged();
  }
  return resultat;
}

/** Active ou désactive un format. Le format par défaut ne se désactive pas : désigner d'abord un autre format par défaut. */
export async function basculerFormatActifAction(formatId: string): Promise<ResultatSimpleFormat> {
  const session = await sessionParametrage();
  if (!session) return { status: "error", message: MESSAGE_REFUS };
  if (typeof formatId !== "string") return { status: "error", message: "Demande invalide." };

  const ip = getTrustedClientIp(await headers());
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatSimpleFormat> => {
    const format = await tx.cptFormatImport.findUnique({ where: { id: formatId } });
    if (!format) return { status: "error", message: "Format introuvable." };
    await verrouillerType(tx, format.type);
    const courant = await tx.cptFormatImport.findUnique({ where: { id: formatId } });
    if (!courant) return { status: "error", message: "Format introuvable." };
    if (courant.actif && courant.parDefaut) {
      return { status: "error", message: "C'est le format par défaut : désignez d'abord un autre format par défaut avant de le désactiver." };
    }
    const actif = !courant.actif;
    await tx.cptFormatImport.update({ where: { id: courant.id }, data: { actif } });
    await ecrireAuditCpt(tx, {
      entite: "CptFormatImport",
      entiteId: courant.id,
      action: actif ? "reactivation_format" : "desactivation_format",
      avant: { actif: courant.actif },
      apres: { actif, nom: courant.nom },
      userId: session.user.id,
      ip,
    });
    return { status: "success", message: `« ${courant.nom} » ${actif ? "réactivé" : "désactivé"}.` };
  });

  if (resultat.status === "success") {
    revalidatePath("/compta", "layout");
    publishDataChanged();
  }
  return resultat;
}
