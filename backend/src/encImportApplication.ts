// Application en base de l'import de production (module Encaissements, CDC V2.6 F1, commit 4c).
//
// Consomme la sortie d'`encImportLecture.ts` (lignes lues) et d'`encImportRegles.ts` (décisions), et les applique
// RÉELLEMENT en base, dans la transaction de l'appelant (jamais `prisma` directement — voir `EncImportApplicationDb`).
// Rien n'est confirmé ici : tout paiement créé reste "à confirmer" (F5, commit ultérieur) ; tout ce qui est figé à la
// confirmation (AA-AD, commission, honoraires, exigibilité...) reste `null`.
//
// Verrou de concurrence : `pg_advisory_xact_lock` (transaction) sur le numéro de police ET sur la clé du partenaire,
// pour que deux imports simultanés ne créent jamais deux fois le même contrat ni le même partenaire — le verrou se
// relâche automatiquement au COMMIT ou au ROLLBACK de la transaction, jamais besoin de le libérer explicitement.

import type { MontantEntree } from "./encCalcul";
import { montant } from "./encCalcul";
import { ecrireAudit, versJsonAudit, type EncAuditDb } from "./encAudit";
import { cleSequenceAnnuelle, prochainNumero, type EncSequenceDb } from "./encSequence";
import { normaliserNomPartenaire } from "./encReferentiels";
import { indexerMotsContrat } from "./encRecherche";
import {
  analyserLigne,
  type ContexteContrat,
  type LigneAAnalyser,
  type OptionsReglesImport,
  type TauxControleAttendus,
} from "./encImportRegles";
import type { PrismaClient } from "./generated/prisma/client";

export class EncImportApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncImportApplicationError";
  }
}

export type EncImportApplicationDb = Pick<
  PrismaClient,
  | "encBranche"
  | "encPartenaire"
  | "encContrat"
  | "encEncaissement"
  | "encImport"
  | "encSignalement"
  | "encTauxControle"
  | "encAudit"
  | "encContratMot"
  | "$queryRaw"
  | "$executeRaw"
>;

/** Analyses de signalement qui correspondent effectivement à L'ENCAISSEMENT créé sur la même ligne (jamais une
 *  signalement purement contractuel comme `PRIME_MODIFIEE`/`INCOHERENCE`/`ECART_TAUX`/`BRANCHE_INCONNUE`). */
const ANALYSES_LIEES_AU_PAIEMENT_CREE = new Set(["AJOUTE", "REFERENCE_MANQUANTE", "REF_WAVE_NON_CONFORME"]);

export interface ParametresApplicationImport {
  nomFichier: string;
  sha256: string;
  /** `EncPieceJointe` déjà enregistrée (le fichier est écrit sur disque et sa ligne créée AVANT cet appel — même
   *  découpage que le reste du module, voir `lib/encaissements/pieceJointe.ts`). */
  fichierId: string;
  /** Code `EncBranche` choisi par l'utilisateur si le fichier n'a pas de colonne « Branche » (CDC §7.1). */
  brancheParDefaut: string | null;
  origineImport: "FINANCE" | "EQUIPE_TECHNIQUE";
  importeParId: string;
  /** Horodatage de l'import — jamais `new Date()` en interne (déterminisme, tests). */
  maintenant: Date;
  /** `controle.tolerance_fcfa` (`EncParametre`) — chargé par l'appelant, jamais ici. `MontantEntree` (chaîne),
   *  jamais `Montant` : le type branché `Montant` (EncDecimal) n'est constructible que via `montant()`, non exporté
   *  du package (voir `index.ts`) — le frontend, seul appelant hors de `backend/`, ne doit jamais avoir besoin
   *  d'importer `encCalcul.ts` pour construire ce paramètre. Converti une seule fois ci-dessous. */
  toleranceIncoherenceFcfa: MontantEntree;
  ip?: string | null;
}

export interface ResultatApplicationImport {
  importId: string;
  nbLignes: number;
  nbContratsCrees: number;
  nbContratsMaj: number;
  nbPaiementsAConfirmer: number;
  nbATraiter: number;
  nbInfo: number;
}

interface PaiementIndique {
  datePaiement: string | null;
  mode: string | null;
  reference: string | null;
  montant: string | null;
}

function construireLignePaiementIndique(ligne: LigneAAnalyser): PaiementIndique {
  return {
    datePaiement: ligne.datePaiement ? ligne.datePaiement.toISOString().slice(0, 10) : null,
    mode: ligne.mode,
    reference: ligne.reference,
    montant: ligne.Z ? ligne.Z.toFixed(2) : null,
  };
}

/**
 * Résout un partenaire par son nom normalisé (`cleNom`) — créé automatiquement s'il est absent (CDC §3.6 : « liste
 * illimitée, alimentée automatiquement par les imports »). Le créateur enregistré est l'utilisateur qui a déclenché
 * CET import (aucun acteur « système » distinct n'existe dans ce projet ; `EncPartenaire.creeParId` n'est jamais nul
 * en dehors de la ligne NOVELIA-équivalente). Verrou dédié (clé préfixée, jamais la même que celle des polices) pour
 * qu'un même nouveau partenaire ne soit jamais créé deux fois par deux imports simultanés.
 */
async function resoudrePartenaire(
  db: EncImportApplicationDb & EncAuditDb,
  nomBrut: string,
  importeParId: string,
  maintenant: Date,
  ip: string | null | undefined
): Promise<{ id: string; nom: string }> {
  const cleNom = normaliserNomPartenaire(nomBrut);
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"partenaire:" + cleNom})::bigint)`;
  const existant = await db.encPartenaire.findUnique({ where: { cleNom } });
  if (existant) return { id: existant.id, nom: existant.nom };

  const cree = await db.encPartenaire.create({ data: { cleNom, nom: nomBrut.trim(), creeParId: importeParId } });
  await ecrireAudit(db, {
    entite: "EncPartenaire",
    entiteId: cree.id,
    action: "creation_automatique_import",
    apres: { cleNom: cree.cleNom, nom: cree.nom },
    userId: importeParId,
    ip,
    mois: maintenant,
  });
  return { id: cree.id, nom: cree.nom };
}

/** Lecture SEULE (jamais de création) — sert uniquement à retrouver un taux de contrôle déjà associé à CE partenaire
 *  avant que `resoudrePartenaire` ne s'exécute (elle-même appelée plus tard, seulement si la ligne aboutit à un
 *  contrat). Un partenaire flambant neuf ne peut de toute façon jamais avoir de ligne `EncTauxControle` existante
 *  (celles-ci ne se créent que par rapport à un partenaire déjà là, voir F9) : cette lecture anticipée est donc sans
 *  risque, jamais un doublon de logique avec `resoudrePartenaire`. */
async function trouverPartenaireIdExistant(db: Pick<EncImportApplicationDb, "encPartenaire">, nomBrut: string): Promise<string | null> {
  const cleNom = normaliserNomPartenaire(nomBrut);
  const existant = await db.encPartenaire.findUnique({ where: { cleNom }, select: { id: true } });
  return existant?.id ?? null;
}

/**
 * Taux de contrôle attendus pour cette ligne (CDC §3.6, F9) — recherche par spécificité décroissante : la
 * combinaison EXACTE (produit ET partenaire) l'emporte si elle existe, sinon la ligne « ce partenaire, tous
 * produits » (`produitCode: null`), sinon la ligne « ce produit, tous partenaires » (`partenaireId: null`). Ordre de
 * priorité non décrit par le cahier (F9 n'a pas d'écran avant le Lot 3) — choix du plus spécifique d'abord, décision
 * de cette tâche, à confirmer si l'écran F9 introduit une règle différente. Aucune ligne trouvée → `null`, et
 * `analyserLigne` saute alors simplement ce contrôle (comportement déjà prévu et testé, 4b).
 */
async function resoudreTauxControleAttendus(
  db: Pick<EncImportApplicationDb, "encTauxControle">,
  produitCode: string | null,
  partenaireId: string | null
): Promise<TauxControleAttendus | null> {
  if (!produitCode && !partenaireId) return null;

  const clesParSpecificiteDecroissante: { produitCode: string | null; partenaireId: string | null }[] = [];
  if (produitCode && partenaireId) clesParSpecificiteDecroissante.push({ produitCode, partenaireId });
  if (partenaireId) clesParSpecificiteDecroissante.push({ produitCode: null, partenaireId });
  if (produitCode) clesParSpecificiteDecroissante.push({ produitCode, partenaireId: null });

  const candidats = await db.encTauxControle.findMany({ where: { OR: clesParSpecificiteDecroissante } });
  const trouve = clesParSpecificiteDecroissante
    .map((cle) => candidats.find((c) => c.produitCode === cle.produitCode && c.partenaireId === cle.partenaireId))
    .find((c) => c !== undefined);
  if (!trouve) return null;
  return {
    tauxTaxe: trouve.tauxTaxe ? montant(trouve.tauxTaxe) : null,
    tauxCommission: trouve.tauxCommission ? montant(trouve.tauxCommission) : null,
    tauxAccessoires: trouve.tauxAccessoires ? montant(trouve.tauxAccessoires) : null,
    tauxHonoraires: trouve.tauxHonoraires ? montant(trouve.tauxHonoraires) : null,
  };
}

/**
 * Applique un import de production déjà lu (`encImportLecture.ts`) et dont chaque ligne a déjà été décidée
 * (`encImportRegles.ts` est appelé ICI, ligne par ligne, avec le contexte réel de la base). Refuse l'import ENTIER
 * (rien n'est écrit, pas même la ligne `EncImport`) si une branche utilisée par le fichier n'existe pas dans
 * `EncBranche` — décision PROVISOIRE du 2026-09-30 (liste encore paramétrée par la Finance, P1) : avant cette
 * décision, une branche inconnue n'était que SIGNALÉE (`BRANCHE_INCONNUE`) ; conserve la lecture pure telle quelle,
 * seule l'application en base ajoute ce refus.
 */
export async function appliquerImportProduction(
  db: EncImportApplicationDb & EncAuditDb & EncSequenceDb,
  lignes: readonly LigneAAnalyser[],
  params: ParametresApplicationImport
): Promise<ResultatApplicationImport> {
  // 1. Valider TOUTES les branches utilisées AVANT toute écriture (rien n'est créé si l'une d'elles est inconnue).
  const codesUtilises = new Set<string>();
  for (const ligne of lignes) {
    const code = ligne.brancheCode ?? params.brancheParDefaut;
    if (code) codesUtilises.add(code);
  }
  const branchesActives = await db.encBranche.findMany({ where: { actif: true }, select: { id: true, code: true, libelle: true } });
  const idParCode = new Map(branchesActives.map((b) => [b.code, b.id]));
  const libelleParCode = new Map(branchesActives.map((b) => [b.code, b.libelle]));
  const inconnues = [...codesUtilises].filter((c) => !idParCode.has(c));
  if (inconnues.length > 0) {
    throw new EncImportApplicationError(
      `Branche(s) inconnue(s) : ${inconnues.join(", ")} — à créer dans les paramètres (Encaissements) avant de réimporter ce fichier.`
    );
  }

  // Codes lus dans la colonne « Branche » du fichier (jamais la branche par défaut choisie à l'écran) : conservés sur
  // l'import pour l'historique, plutôt que reconstitués après coup depuis les contrats/signalements (fragile).
  const branchesFichier = [...new Set(lignes.map((l) => l.brancheCode).filter((c): c is string => c !== null))].sort();

  // 2. Ligne EncImport (totaux définitifs posés à la fin, une fois toutes les lignes traitées).
  const imp = await db.encImport.create({
    data: {
      type: "PRODUCTION",
      statut: "VALIDE",
      nomFichier: params.nomFichier,
      sha256: params.sha256,
      fichierId: params.fichierId,
      brancheParDefautId: params.brancheParDefaut ? (idParCode.get(params.brancheParDefaut) ?? null) : null,
      branchesFichier: branchesFichier.length > 0 ? branchesFichier : undefined,
      nbLignes: lignes.length,
      importeParId: params.importeParId,
      importeAt: params.maintenant,
      // F1 n'a pas d'étape "aperçu" distincte (contrairement à F1.5, CDC §8.2) : validé par le même utilisateur, au
      // même instant que l'import lui-même.
      valideParId: params.importeParId,
      valideAt: params.maintenant,
    },
  });

  let nbContratsCrees = 0;
  let nbContratsMaj = 0;
  let nbPaiementsAConfirmer = 0;
  let nbATraiter = 0;
  let nbInfo = 0;
  let totalPrimesTtc = montant("0");

  const branchesConnues = [...idParCode.keys()];

  for (const ligne of lignes) {
    // Ligne sans numéro de police : hors du périmètre du tableau F1.4 (jamais rencontré ni testé par
    // encImportRegles.ts, voir encImportLecture.ts) — signalée seule, ignorée pour le reste, n'interrompt pas
    // l'import (une ligne isolée illisible ne doit jamais faire échouer tout un fichier de plusieurs milliers).
    if (ligne.numPolice === null) {
      await db.encSignalement.create({
        data: {
          importId: imp.id,
          numPolice: null,
          analyse: "A_COMPLETER",
          niveau: "A_TRAITER",
          statut: "A_TRAITER",
          detail: `Ligne ${ligne.numeroLigne} : numéro de police manquant, ignorée.`,
          paiementIndique: versJsonAudit(construireLignePaiementIndique(ligne)),
        },
      });
      nbATraiter += 1;
      continue;
    }

    // Verrou : sérialise les accès concurrents à LA MÊME police (deux imports simultanés ne créent jamais deux fois
    // le même contrat) — verrou de TRANSACTION, relâché automatiquement au commit/rollback, jamais à libérer à la main.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"police:" + ligne.numPolice})::bigint)`;

    const contratExistant = await db.encContrat.findUnique({
      where: { numPolice: ligne.numPolice },
      include: {
        encaissements: {
          select: { id: true, paiementIdFichier: true, reference: true, datePaiement: true, Z: true, statut: true },
        },
      },
    });

    const contexte: ContexteContrat = contratExistant
      ? {
          existant: {
            S: montant(contratExistant.S),
            T: montant(contratExistant.T),
            U: montant(contratExistant.U),
            V: montant(contratExistant.V),
            W: montant(contratExistant.W),
            X: montant(contratExistant.X),
            encaissements: contratExistant.encaissements.map((e) => ({
              id: e.id,
              paiementIdFichier: e.paiementIdFichier,
              reference: e.reference,
              datePaiement: e.datePaiement,
              montant: montant(e.Z),
              statut: e.statut,
            })),
          },
        }
      : { existant: null };

    // Lecture SEULE d'un éventuel partenaire déjà existant (jamais de création ici) : sert uniquement à retrouver un
    // taux de contrôle qui lui serait rattaché AVANT que la ligne ne soit décidée — voir `trouverPartenaireIdExistant`.
    const partenaireExistantId = ligne.partenaireNom ? await trouverPartenaireIdExistant(db, ligne.partenaireNom) : null;
    const tauxControleAttendus = await resoudreTauxControleAttendus(db, ligne.produitCode, partenaireExistantId);

    const options: OptionsReglesImport = {
      origineImport: params.origineImport,
      aujourdHui: params.maintenant,
      toleranceIncoherenceFcfa: montant(params.toleranceIncoherenceFcfa),
      branchesConnues,
      brancheParDefaut: params.brancheParDefaut,
      // Taux de contrôle (V2-A20) : câblés sur l'import (`resoudreTauxControleAttendus`) — sans ligne
      // `EncTauxControle` pour cette ligne (produit/partenaire), `tauxControle` reste `undefined` et
      // `analyserLigne` saute le contrôle, comportement déjà prévu et testé (4b). Comparaison en MONTANT, pas en
      // pourcentage (décision du 2026-09-30) : la tolérance est `toleranceIncoherenceFcfa` ci-dessus, jamais une
      // seconde tolérance dédiée — voir `encImportRegles.ts`.
      tauxControle: tauxControleAttendus ?? undefined,
    };

    const decision = analyserLigne(ligne, contexte, options);

    // Partenaire : résolu SEULEMENT si le contrat va réellement être écrit (jamais pour une ligne rejetée en bloc,
    // V2-A14/Finance — `decision.contrat` vaut alors `null`).
    const partenaire =
      decision.contrat && ligne.partenaireNom
        ? await resoudrePartenaire(db, ligne.partenaireNom, params.importeParId, params.maintenant, params.ip)
        : null;
    const partenaireId = partenaire?.id ?? null;

    const brancheEffective = ligne.brancheCode ?? params.brancheParDefaut;
    const brancheId = brancheEffective ? (idParCode.get(brancheEffective) ?? null) : null;

    let contratId: string | null = contratExistant?.id ?? null;

    if (decision.contrat) {
      // brancheId/dateEffet sont garantis non nuls ici : brancheEffective vient d'une branche déjà validée à
      // l'étape 1 (jamais `null` pour une ligne dont le contrat est retenu), dateEffet est un champ contractuel
      // obligatoire (CDC §3.1) déjà lu par `encImportLecture.ts`.
      const donneesContrat = {
        brancheId: brancheId!,
        typeContrat: ligne.typeContrat,
        produitLibelle: ligne.produitLibelle,
        produitCode: ligne.produitCode,
        typeOperation: ligne.typeOperation,
        clientId: ligne.clientId,
        clientNom: ligne.clientNom,
        partenaireId,
        dateEffet: ligne.dateEffet!,
        dateEcheance: ligne.dateEcheance,
        typePolice: ligne.typePolice,
        S: decision.contrat.S,
        T: decision.contrat.T,
        U: decision.contrat.U,
        V: decision.contrat.V,
        W: decision.contrat.W,
        X: decision.contrat.X,
      };
      if (contratExistant) {
        await db.encContrat.update({ where: { id: contratExistant.id }, data: { ...donneesContrat, majParImportId: imp.id } });
        nbContratsMaj += 1;
      } else {
        const cree = await db.encContrat.create({ data: { numPolice: ligne.numPolice, ...donneesContrat, creeParImportId: imp.id } });
        contratId = cree.id;
        nbContratsCrees += 1;
      }
      totalPrimesTtc = totalPrimesTtc.plus(decision.contrat.S);
    }

    let encaissementCreeId: string | null = null;
    if (decision.paiementACreer && contratId && brancheId) {
      const paiementId = await prochainNumero(db, cleSequenceAnnuelle("PAI", params.maintenant.getUTCFullYear()));
      const cree = await db.encEncaissement.create({
        data: {
          paiementId,
          paiementIdFichier: decision.paiementACreer.paiementIdFichier,
          contratId,
          brancheId,
          source: "FICHIER",
          statut: "A_CONFIRMER",
          datePaiement: decision.paiementACreer.datePaiement,
          mode: decision.paiementACreer.mode,
          reference: decision.paiementACreer.reference,
          Z: decision.paiementACreer.montant,
          dateSaisie: params.maintenant,
          saisiParId: params.importeParId,
          importId: imp.id,
          importLigne: ligne.numeroLigne,
        },
      });
      encaissementCreeId = cree.id;
      nbPaiementsAConfirmer += 1;
    }

    // Index de recherche (F2, 5a-bis) : réécrit dans la même transaction dès que le contrat est écrit — nom du
    // partenaire TEL QU'ENREGISTRÉ (pas celui de la ligne, qui peut différer à la ponctuation près), libellé de la
    // branche, références de tous les paiements du contrat (existants et celui créé ci-dessus).
    // Réimport sans changement (mêmes champs indexés, aucun nouveau paiement) : les mots déjà enregistrés sont
    // identiques, rien à réécrire — évite deux requêtes par ligne sur un réimport complet.
    const motsInchanges =
      contratExistant !== null &&
      encaissementCreeId === null &&
      contratExistant.clientNom === ligne.clientNom &&
      contratExistant.clientId === ligne.clientId &&
      contratExistant.produitLibelle === ligne.produitLibelle &&
      contratExistant.produitCode === ligne.produitCode &&
      contratExistant.partenaireId === partenaireId &&
      contratExistant.brancheId === brancheId;
    if (decision.contrat && contratId && !motsInchanges) {
      const references = [
        ...(contratExistant?.encaissements.map((e) => e.reference) ?? []),
        decision.paiementACreer && encaissementCreeId ? decision.paiementACreer.reference : null,
      ];
      await indexerMotsContrat(
        db,
        contratId,
        [
          ligne.numPolice,
          ligne.clientNom,
          ligne.clientId,
          ligne.produitLibelle,
          ligne.produitCode,
          partenaire?.nom,
          brancheEffective,
          brancheEffective ? libelleParCode.get(brancheEffective) : null,
          ...references,
        ],
        !contratExistant
      );
    }

    const paiementIndique = versJsonAudit(construireLignePaiementIndique(ligne));
    for (const s of decision.signalements) {
      await db.encSignalement.create({
        data: {
          importId: imp.id,
          contratId,
          numPolice: ligne.numPolice,
          brancheId,
          analyse: s.analyse,
          niveau: s.niveau,
          statut: s.niveau,
          detail: s.detail,
          paiementIndique,
          encaissementExistantId: s.encaissementExistantId ?? null,
          encaissementCreeId: ANALYSES_LIEES_AU_PAIEMENT_CREE.has(s.analyse) ? encaissementCreeId : null,
          primeAvant: s.primeAvant ? versJsonAudit(s.primeAvant) : undefined,
          primeApres: s.primeApres ? versJsonAudit(s.primeApres) : undefined,
        },
      });
      if (s.niveau === "A_TRAITER") nbATraiter += 1;
      else nbInfo += 1;
    }
  }

  await db.encImport.update({
    where: { id: imp.id },
    data: { totalPrimesTtc, nbContratsCrees, nbContratsMaj, nbPaiementsAConfirmer, nbATraiter },
  });

  await ecrireAudit(db, {
    entite: "EncImport",
    entiteId: imp.id,
    action: "import_production",
    apres: {
      nomFichier: params.nomFichier,
      nbLignes: lignes.length,
      nbContratsCrees,
      nbContratsMaj,
      nbPaiementsAConfirmer,
      nbATraiter,
      nbInfo,
    },
    userId: params.importeParId,
    ip: params.ip,
    mois: params.maintenant,
  });

  return { importId: imp.id, nbLignes: lignes.length, nbContratsCrees, nbContratsMaj, nbPaiementsAConfirmer, nbATraiter, nbInfo };
}
