// Règles F1 (module Encaissements, CDC V2.6 F1/§3.6, docs/encaissements-conception.md §8.1, arbitrages 2026-09-30).
//
// PURE : aucun accès à la base. Consomme la sortie d'`encImportLecture.ts` (une `LigneFichierProduction`) plus un
// « contexte » (ce qu'on sait déjà du contrat, fourni par l'appelant — commit 4c ira le chercher en base) et décide :
// contrat à créer/mettre à jour, paiement à créer ou non, signalements à lever. N'écrit jamais rien : `analyserLigne`
// renvoie une décision, jamais un effet de bord.
//
// Date du jour et tolérances TOUJOURS en paramètre (jamais `new Date()` ni un nombre en dur ici) — même principe que
// encCalcul.ts : « aucun paramètre en dur ». `controle.tolerance_fcfa` (EncParametre) et la liste des branches
// actives (EncBranche) sont fournis par l'appelant.

import type { Montant, MontantsContrat } from "./encCalcul";
import { montant } from "./encCalcul";
import type { LigneFichierProduction } from "./encImportLecture";

// ---------------------------------------------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ligne à analyser : `LigneFichierProduction` (encImportLecture.ts) + un point d'extension pour l'annulation
 * (V2-A14). AUCUNE colonne du fichier n'est aujourd'hui identifiée pour indiquer qu'une ligne est annulée — question
 * posée au client (reconnaissance par en-tête envisagée : « Statut annulation », « Date annulation », « Motif
 * annulation », « Type annulation ») — `encImportLecture.ts` ne renseigne donc jamais ce champ. Une fois la colonne
 * connue, seule la lecture (commit 4a) aura à le peupler ; la règle ci-dessous (déjà écrite, déjà testée) n'aura pas
 * à changer.
 */
export interface LigneAAnalyser extends LigneFichierProduction {
  indicateurAnnulation?: boolean;
}

export type StatutEncaissementExistant = "A_CONFIRMER" | "CONFIRME" | "NON_RECU";

export interface EncaissementExistantResume {
  id: string;
  paiementIdFichier: string | null;
  reference: string | null;
  datePaiement: Date;
  montant: Montant;
  statut: StatutEncaissementExistant;
}

export interface ContratExistant extends MontantsContrat {
  encaissements: readonly EncaissementExistantResume[];
}

/** `existant: null` = police NOUVELLE (aucun `EncContrat` sous ce `numPolice`). */
export interface ContexteContrat {
  existant: ContratExistant | null;
}

/** Taux de contrôle ATTENDUS pour le produit/partenaire de cette ligne (fraction 0-1, ex. 0.0725 pour 7,25 %),
 *  résolus par l'appelant (`EncTauxControle`, accès base) — jamais ici. Comparés en MONTANT, pas en pourcentage (voir
 *  `OptionsReglesImport.toleranceIncoherenceFcfa` ci-dessous — décision du 2026-09-30, corrige un premier essai en
 *  points de pourcentage). `tauxAccessoires` se compare au montant réel U (base T, IMPLICITE reprise du V1,
 *  PROVISOIRE — à confirmer par le client, V2-A20 toujours partiellement ouverte) : aucune formule alternative n'est
 *  décrite ni par le cahier ni par la maquette. */
export interface TauxControleAttendus {
  tauxTaxe?: Montant | null;
  tauxCommission?: Montant | null;
  tauxHonoraires?: Montant | null;
  tauxAccessoires?: Montant | null;
}

export interface OptionsReglesImport {
  /** Qui a produit CE fichier — seul ce qui change avec V2-A14 (ligne annulée). */
  origineImport: "FINANCE" | "EQUIPE_TECHNIQUE";
  /** Date du jour (jamais lue en interne) — sert au contrôle « pas de date future » (V2-A28/CDC §8.1). */
  aujourdHui: Date;
  /** `controle.tolerance_fcfa` (EncParametre) — tolérance de l'incohérence T+U+V ≠ S, EN FCFA. Réutilisée TELLE
   *  QUELLE pour l'écart de taux de contrôle ci-dessous (décision du 2026-09-30, CDC V1 §3.8 : même précédent écrit,
   *  « écart en FCFA », 1 FCFA par défaut) — jamais une seconde tolérance dédiée en points de pourcentage : un écart
   *  de 2 points de pourcentage peut représenter un écart de montant énorme ou négligeable selon la base, la
   *  tolérance doit donc toujours porter sur le MONTANT, jamais sur le taux lui-même. */
  toleranceIncoherenceFcfa: Montant;
  /** Codes `EncBranche` actifs ; `null` = liste non vérifiée (le contrôle « branche inconnue » est alors sauté). */
  branchesConnues: readonly string[] | null;
  /** Branche choisie par l'utilisateur à l'import, si le fichier n'a pas de colonne « Branche ». */
  brancheParDefaut: string | null;
  /** Taux de contrôle attendus pour cette ligne — `undefined` = aucun contrôle configuré (produit/partenaire),
   *  `analyserLigne` saute alors ce contrôle sans jamais deviner de défaut. Pas de tolérance dédiée ici : voir
   *  `toleranceIncoherenceFcfa` ci-dessus. */
  tauxControle?: TauxControleAttendus;
}

// ---------------------------------------------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------------------------------------------

export type AnalyseSignalement =
  | "DEJA_PRESENT"
  | "DOUBLON_POSSIBLE"
  | "A_COMPLETER"
  | "REFERENCE_MANQUANTE"
  | "REF_WAVE_NON_CONFORME"
  | "AJOUTE"
  | "SANS_PAIEMENT"
  | "PRIME_MODIFIEE"
  | "INCOHERENCE"
  | "ECART_TAUX"
  | "LIGNE_ANNULEE_REJETEE"
  | "ANNULATION_EN_ATTENTE_L4"
  | "BRANCHE_INCONNUE";

/**
 * Deux valeurs NOUVELLES, absentes du sketch initial de l'enum `EncSignalement.analyse`
 * (docs/encaissements-conception.md §5.5) — le commit 4c (application en base) devra les ajouter au `enum` Prisma
 * réel :
 * - `ANNULATION_EN_ATTENTE_L4` : le cas « Équipe technique » de V2-A14 (D14, 2026-09-30) n'est pas un rejet, le
 *   contrat reste importé normalement — une valeur distincte évite de laisser croire, via `LIGNE_ANNULEE_REJETEE`,
 *   qu'une ligne réellement importée aurait été rejetée.
 * - `REFERENCE_MANQUANTE` (décision du 2026-09-30, deux corrections post-revue successives) : le tableau F1.4 ne
 *   cite que date, mode et montant pour le cas « manquant » — une référence manquante n'empêche PAS l'ajout du
 *   paiement (« à confirmer »), contrairement à ce qu'un premier essai avait supposé (fondu dans `A_COMPLETER`).
 *   L'obligation de référence du CDC §3.2 vise la SAISIE À L'ÉCRAN, pas le fichier de production. **Le doublon
 *   possible (fuzzy, ±1 FCFA/±7 jours) reste néanmoins vérifié pour ces lignes** (deuxième correction : un premier
 *   essai le sautait, en pensant à tort que le groupe 3 du rapprochement — CDC F5, « même montant à 3 jours près,
 *   sans référence commune » — en avait seul la charge) : l'ORDRE voulu est déjà présent → doublon possible → à
 *   compléter → puis, seulement si la ligne est ajoutée, `REFERENCE_MANQUANTE` (ou `REF_WAVE_NON_CONFORME`) vient
 *   s'ajouter à l'ajout, jamais à sa place. Le groupe 3 reste utile pour les cas que ce contrôle ne détecte pas.
 */

export type NiveauSignalement = "A_TRAITER" | "INFO";

export interface SignalementPropose {
  analyse: AnalyseSignalement;
  niveau: NiveauSignalement;
  /** Texte explicatif — pas encore un champ dédié d'`EncSignalement` (le modèle n'existe pas avant le commit 4c). */
  detail: string;
  encaissementExistantId?: string;
  primeAvant?: MontantsContrat;
  primeApres?: MontantsContrat;
}

export interface PaiementACreer {
  datePaiement: Date;
  mode: string;
  /** `null` uniquement pour le cas « référence manquante » (décision du 2026-09-30) — le paiement est quand même
   *  créé, signalé `REFERENCE_MANQUANTE` ; le rapprochement (CDC F5, groupe 3) est pensé pour ce cas précis. */
  reference: string | null;
  montant: Montant;
  /** PaiementID DU FICHIER (anti-doublon seulement, D7/A1b) — jamais notre propre numéro PAI, attribué ailleurs
   *  (commit 4c, `prochainNumero`, `encSequence.ts`) au moment de la création réelle. */
  paiementIdFichier: string | null;
}

export interface DecisionLigne {
  numeroLigne: number;
  policeConnue: boolean;
  /** `null` UNIQUEMENT si la ligne est rejetée en bloc (V2-A14, fichier Finance) — sinon toujours renseigné : les
   *  informations du contrat viennent toujours du fichier (CDC §3.1), même quand aucun paiement n'est créé. */
  contrat: MontantsContrat | null;
  /** `true` si le contrat existait déjà ET qu'au moins un des 6 montants a changé (avenant possible, D8). */
  avenant: boolean;
  paiementACreer: PaiementACreer | null;
  signalements: SignalementPropose[];
}

// ---------------------------------------------------------------------------------------------------------------
// Aide — dates et montants
// ---------------------------------------------------------------------------------------------------------------

/** Reprise directe d'`isWaveId` (Maquette_registre_paiements.html) : identifiant de transaction Wave (CDC §3.2/§8.1). */
export function estIdentifiantWave(reference: string): boolean {
  return /^T_[A-Z0-9]{10,}$/i.test(reference.trim());
}

function memeJour(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

function diffJours(a: Date, b: Date): number {
  const jourA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const jourB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.abs(jourA - jourB) / MS_PAR_JOUR;
}

function montantsEgaux(a: MontantsContrat, b: MontantsContrat): boolean {
  return a.S.eq(b.S) && a.T.eq(b.T) && a.U.eq(b.U) && a.V.eq(b.V) && a.W.eq(b.W) && a.X.eq(b.X);
}

// ---------------------------------------------------------------------------------------------------------------
// Décision
// ---------------------------------------------------------------------------------------------------------------

/** `true` si la ligne porte au moins un début d'intention de paiement (date, mode, référence ou montant). */
function aUneIntentionDePaiement(ligne: LigneAAnalyser): boolean {
  return ligne.datePaiement !== null || ligne.mode !== null || ligne.reference !== null || ligne.Z !== null;
}

/** Les 3 champs cités par le tableau F1.4 pour le cas « manquant » (CDC F1.4 : date, mode, montant — PAS la
 *  référence, voir `REFERENCE_MANQUANTE` ci-dessus, décision du 2026-09-30). */
function dateModeMontantManquant(ligne: LigneAAnalyser): boolean {
  return ligne.datePaiement === null || ligne.mode === null || ligne.Z === null;
}

/** « Déjà présent » (F1.4) : ne requiert AUCUN champ en particulier — chaque clause se garde elle-même (une ligne
 *  sans référence peut par exemple encore matcher par PaiementID). Compare avec TOUS les encaissements existants, y
 *  compris "non reçus" (V2-A12, PROVISOIRE 2026-09-30, D12). */
export function chercherDejaPresent<E extends EncaissementExistantResume>(
  ligne: Pick<LigneAAnalyser, "paiementIdFichier" | "reference" | "datePaiement" | "Z">,
  existants: readonly E[]
): E | null {
  for (const e of existants) {
    const memePaiementId = ligne.paiementIdFichier !== null && e.paiementIdFichier === ligne.paiementIdFichier;
    const memeReference = ligne.reference !== null && e.reference === ligne.reference;
    const memeDateEtMontant = ligne.datePaiement !== null && ligne.Z !== null && memeJour(ligne.datePaiement, e.datePaiement) && ligne.Z.eq(e.montant);
    if (memePaiementId || memeReference || memeDateEtMontant) return e;
  }
  return null;
}

/** « Doublon possible » (F1.4) : nécessite date ET montant (renvoie `null` sinon) ; compare seulement avec les
 *  encaissements CONFIRMÉS et À CONFIRMER (V2-A12, PROVISOIRE 2026-09-30, D12). Vérifiée QUE la référence soit
 *  présente ou non (décision du 2026-09-30, revue après un premier essai) : une ligne sans référence qui ressemble
 *  à un encaissement existant reste un doublon possible, jamais ajoutée directement — le rapprochement F5 (groupe 3)
 *  sert pour les cas que CE contrôle-ci n'a pas détectés, jamais pour le remplacer. */
function chercherDoublonPossible(ligne: LigneAAnalyser, existants: readonly EncaissementExistantResume[]): EncaissementExistantResume | null {
  if (ligne.datePaiement === null || ligne.Z === null) return null;
  const candidats = existants.filter((e) => e.statut === "CONFIRME" || e.statut === "A_CONFIRMER");
  for (const e of candidats) {
    const montantProche = ligne.Z.minus(e.montant).abs().lte(montant("1"));
    const dateProche = diffJours(ligne.datePaiement, e.datePaiement) <= 7;
    if (montantProche && dateProche) return e;
  }
  return null;
}

/**
 * Analyse UNE ligne déjà lue (`encImportLecture.ts`) et décide du sort du contrat et de l'éventuel paiement, sans
 * jamais toucher la base. Voir les interfaces ci-dessus pour le détail des entrées/sorties.
 */
export function analyserLigne(ligne: LigneAAnalyser, contexte: ContexteContrat, options: OptionsReglesImport): DecisionLigne {
  const signalements: SignalementPropose[] = [];
  const policeConnue = contexte.existant !== null;

  // 1. Annulation (V2-A14, D14) — point d'extension : aucune colonne connue aujourd'hui pour le déclencher.
  if (ligne.indicateurAnnulation) {
    if (options.origineImport === "FINANCE") {
      return {
        numeroLigne: ligne.numeroLigne,
        policeConnue,
        contrat: null,
        avenant: false,
        paiementACreer: null,
        signalements: [
          {
            analyse: "LIGNE_ANNULEE_REJETEE",
            niveau: "A_TRAITER",
            detail: "Ligne marquée annulée dans un fichier importé par la Finance : rejetée entièrement (annulation réservée à l'équipe technique).",
          },
        ],
      };
    }
    signalements.push({
      analyse: "ANNULATION_EN_ATTENTE_L4",
      niveau: "A_TRAITER",
      detail: "Ligne marquée annulée dans un fichier de l'équipe technique : contrat importé normalement, annulation non appliquée (en attente du Lot 4).",
    });
  }

  // 2. Branche.
  const brancheEffective = ligne.brancheCode ?? options.brancheParDefaut;
  if (brancheEffective && options.branchesConnues && !options.branchesConnues.includes(brancheEffective)) {
    signalements.push({ analyse: "BRANCHE_INCONNUE", niveau: "A_TRAITER", detail: `Branche « ${brancheEffective} » inconnue de la liste paramétrée par la Finance.` });
  }

  // 3. Contrat : toujours mis à jour depuis le fichier (CDC §3.1 : « toutes les informations viennent du fichier »).
  const contrat: MontantsContrat | null =
    ligne.S && ligne.T && ligne.U && ligne.V && ligne.W && ligne.X ? { S: ligne.S, T: ligne.T, U: ligne.U, V: ligne.V, W: ligne.W, X: ligne.X } : null;

  let avenant = false;
  if (contrat && contexte.existant && !montantsEgaux(contexte.existant, contrat)) {
    avenant = true;
    signalements.push({
      analyse: "PRIME_MODIFIEE",
      niveau: "INFO",
      detail: "Avenant possible : la prime ou l'une de ses composantes a changé depuis le dernier import.",
      primeAvant: { S: contexte.existant.S, T: contexte.existant.T, U: contexte.existant.U, V: contexte.existant.V, W: contexte.existant.W, X: contexte.existant.X },
      primeApres: contrat,
    });
  }

  // 4. Incohérence T + U + V ≠ S (CDC §5.1/§8.1, tolérance fournie par l'appelant).
  if (contrat) {
    const somme = contrat.T.plus(contrat.U).plus(contrat.V);
    const ecart = somme.minus(contrat.S).abs();
    if (ecart.gt(options.toleranceIncoherenceFcfa)) {
      signalements.push({
        analyse: "INCOHERENCE",
        niveau: "A_TRAITER",
        detail: `Prime nette + accessoires + taxes (${somme.toFixed(2)}) ≠ prime TTC (${contrat.S.toFixed(2)}) : écart ${ecart.toFixed(2)} FCFA.`,
      });
    }
  }

  // 5. Écart de taux de contrôle (CDC §3.6 : signale, ne modifie jamais un montant). Comparaison en MONTANT — montant
  //    attendu = taux paramétré × base —, jamais en pourcentage : un écart de quelques points de taux peut recouvrir
  //    un montant énorme ou négligeable selon la base, la tolérance doit donc toujours porter sur le montant.
  //    Tolérance = `toleranceIncoherenceFcfa` (même précédent écrit que l'incohérence T+U+V≠S, CDC V1 §3.8, 1 FCFA
  //    par défaut) — décision du 2026-09-30, corrige un premier essai qui comparait des fractions avec une tolérance
  //    en points (un écart de 2 points aurait laissé passer 20 % de commission au lieu de 18 %, une dérive bien
  //    supérieure à 1 FCFA en valeur réelle). Bases reprises de Maquette_registre_paiements.html (seule formule
  //    disponible) : taxe sur (T+U), commission/honoraires/accessoires sur T — accessoires PROVISOIRE (V2-A20
  //    reste partiellement ouverte). Jamais besoin de garde `T > 0` : sans division, `attendu × 0 = 0` reste un
  //    montant attendu valide (un écart réel sur une base nulle est alors, à raison, toujours signalé).
  if (contrat && options.tauxControle) {
    const { tauxTaxe, tauxCommission, tauxHonoraires, tauxAccessoires } = options.tauxControle;
    const verifier = (libelle: string, reelMontant: Montant, base: Montant, attendu: Montant | null | undefined) => {
      if (attendu === null || attendu === undefined) return;
      const montantAttendu = attendu.times(base);
      const ecart = reelMontant.minus(montantAttendu).abs();
      if (ecart.gt(options.toleranceIncoherenceFcfa)) {
        signalements.push({
          analyse: "ECART_TAUX",
          niveau: "A_TRAITER",
          detail: `Montant de ${libelle} réel (${reelMontant.toFixed(2)} FCFA) hors tolérance du montant attendu (${montantAttendu.toFixed(2)} FCFA, taux de ${attendu.times(100).toFixed(2)} % × ${base.toFixed(2)} FCFA) : écart ${ecart.toFixed(2)} FCFA.`,
        });
      }
    };
    verifier("taxe", contrat.V, contrat.T.plus(contrat.U), tauxTaxe);
    verifier("commission", contrat.W, contrat.T, tauxCommission);
    verifier("honoraires", contrat.X, contrat.T, tauxHonoraires);
    verifier("accessoires", contrat.U, contrat.T, tauxAccessoires);
  }

  // 6. Paiement — tableau des cas F1.4 (CDC F1.4) + V2-A10/A28 (D13/D15) + REFERENCE_MANQUANTE (2026-09-30).
  // Ordre voulu (décision du 2026-09-30, revue après un premier essai) : déjà présent → doublon possible → à
  // compléter (date/mode/montant manquant) → puis, SI la ligne est ajoutée, un signalement selon la référence
  // (manquante, ou Wave non conforme) vient s'ajouter à l'ajout — jamais à sa place. Une ligne SANS référence qui
  // ressemble à un encaissement existant (±1 FCFA, ±7 jours) reste donc un « doublon possible », jamais ajoutée.
  let paiementACreer: PaiementACreer | null = null;
  const dejaPresent = chercherDejaPresent(ligne, contexte.existant?.encaissements ?? []);
  const doublonPossible = dejaPresent === null ? chercherDoublonPossible(ligne, contexte.existant?.encaissements ?? []) : null;

  if (!aUneIntentionDePaiement(ligne)) {
    // Aucune information de paiement : rien à signaler pour une police NOUVELLE (un contrat peut légitimement
    // apparaître sans paiement ce mois-ci) ; "à vérifier" pour une police déjà connue (F1.4, dernière ligne).
    if (policeConnue) {
      signalements.push({ analyse: "SANS_PAIEMENT", niveau: "A_TRAITER", detail: "Police revenue sans aucune information de paiement : à vérifier." });
    }
  } else if (ligne.datePaiement !== null && ligne.datePaiement.getTime() > options.aujourdHui.getTime()) {
    // V2-A28 (D15) : date future — contrat importé, paiement NON créé, signalé "à compléter" (même traitement que
    // "date, mode ou montant manquant", décision explicite du 2026-09-30).
    signalements.push({ analyse: "A_COMPLETER", niveau: "A_TRAITER", detail: "Date de paiement dans le futur : paiement non créé, à corriger." });
  } else if (dejaPresent) {
    // "Déjà présent" (F1.4) est vérifié EN PREMIER (priorité du tableau) : ne requiert aucun champ en particulier,
    // peut matcher même une ligne par ailleurs incomplète (PaiementID ou référence seuls suffisent).
    signalements.push({ analyse: "DEJA_PRESENT", niveau: "INFO", detail: "Paiement déjà présent (même PaiementID, même référence, ou même date et même montant qu'un encaissement existant).", encaissementExistantId: dejaPresent.id });
  } else if (doublonPossible) {
    // Vérifié AVANT "à compléter"/"référence manquante" : une ligne sans référence peut encore être un doublon
    // possible (fuzzy, ±1 FCFA/±7 jours) — le groupe 3 du rapprochement (CDC F5) sert pour les cas non détectés ici,
    // pas pour court-circuiter cette détection.
    signalements.push({
      analyse: "DOUBLON_POSSIBLE",
      niveau: "A_TRAITER",
      detail: `Doublon possible : même montant (± 1 FCFA) à 7 jours près d'un encaissement existant (référence « ${doublonPossible.reference ?? "—"} »).`,
      encaissementExistantId: doublonPossible.id,
    });
  } else if (dateModeMontantManquant(ligne)) {
    // Date, mode ou montant manquant (F1.4) — la RÉFÉRENCE n'en fait plus partie (voir REFERENCE_MANQUANTE ci-dessus).
    signalements.push({ analyse: "A_COMPLETER", niveau: "A_TRAITER", detail: "Date, mode ou montant manquant : paiement non créé." });
  } else if (ligne.reference === null) {
    // Référence manquante (décision du 2026-09-30) : ajouté "à confirmer" quand même (déjà présent/doublon possible
    // viennent d'être vérifiés ci-dessus et n'ont rien trouvé) — jamais "à compléter".
    paiementACreer = { datePaiement: ligne.datePaiement!, mode: ligne.mode!, reference: null, montant: ligne.Z!, paiementIdFichier: ligne.paiementIdFichier };
    signalements.push({ analyse: "REFERENCE_MANQUANTE", niveau: "A_TRAITER", detail: "Référence de paiement manquante : ajouté à confirmer, le rapprochement (groupe 3) en tiendra compte." });
  } else if (ligne.mode === "WAVE" && !estIdentifiantWave(ligne.reference)) {
    // Ajouté "à confirmer" MALGRÉ le problème (F1.4) — jamais rapproché automatiquement ensuite.
    paiementACreer = { datePaiement: ligne.datePaiement!, mode: ligne.mode, reference: ligne.reference, montant: ligne.Z!, paiementIdFichier: ligne.paiementIdFichier };
    signalements.push({ analyse: "REF_WAVE_NON_CONFORME", niveau: "A_TRAITER", detail: "Paiement Wave dont la référence n'est pas un identifiant de transaction (T_…) : il ne pourra pas être rapproché automatiquement." });
  } else {
    // "Autre cas" de F1.4, ajouté "à confirmer", pour information.
    paiementACreer = { datePaiement: ligne.datePaiement!, mode: ligne.mode!, reference: ligne.reference, montant: ligne.Z!, paiementIdFichier: ligne.paiementIdFichier };
    signalements.push({ analyse: "AJOUTE", niveau: "INFO", detail: "Paiement ajouté, à confirmer." });
  }

  return { numeroLigne: ligne.numeroLigne, policeConnue, contrat, avenant, paiementACreer, signalements };
}
