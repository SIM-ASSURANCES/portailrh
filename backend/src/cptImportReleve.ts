// Gestion Compta, lot GC-4d : application en base d'un relevé déjà LU (cptReleve) et dont les lignes sont reconnues (cptReconnaissance).
//
// Tout se passe dans la transaction de l'appelant (`tx`) : un échec annule l'import entier, sans relevé ni encaissement orphelin.
//  - un même fichier ne s'importe qu'une fois (empreinte SHA-256 unique) ET une même ligne ne s'importe qu'une fois par compte
//    (unique (compte, référence), RG-04) : un relevé réexporté avec un autre recouvrement ne recrée rien de ce qui existe déjà ;
//  - UN verrou global (`pg_advisory_xact_lock`) sérialise les imports de relevés : l'appariement d'un virement lit les lignes des
//    AUTRES comptes, deux imports simultanés (Wave et BNI) ne doivent jamais se disputer la même contrepartie ;
//  - une ligne à signalement BLOQUANT, ou datée d'un mois clôturé, n'écrit rien : elle devient une anomalie « ligne rejetée » ;
//  - les numéros CPE-AAAA-NNNNNN sont réservés par blocs (une instruction par année), dans l'ordre du fichier ;
//  - un virement reconnu fait passer la ligne de l'AUTRE compte (déjà en base) en virement interne, dans le même sens, et crée le
//    transfert interne ; jamais un virement compté comme une prime ;
//  - `CptReleve.totalCredits` / `nbLignes` portent les lignes CRÉÉES par cet import (pas celles déjà importées) : la somme des
//    relevés d'un mois égale la somme de ses encaissements, ce qu'utilisera le contrôle mensuel par compte.
// Limite connue, pour GC-5 : un virement reconnu après coup suppose que la ligne de l'autre compte n'a ni rattachement validé ni
// part « pas une prime » (sinon elle n'est pas proposée comme contrepartie) ; les propositions de rattachement encore ouvertes
// sur une telle ligne devront être annulées par le moteur de rattachement.
// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

import { randomUUID } from "node:crypto";

import type { Prisma } from "./generated/prisma/client";
import { preparerAudit, type CptAuditEntree } from "./cptAudit";
import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import type { ResultatLectureCpt } from "./cptImportLecture";
import {
  bilanReconnaissance,
  enLigneComplete,
  reconnaitreLignesReleve,
  type ContrepartieVirement,
  type LigneReleveComplete,
  type TypeFluxCpt,
} from "./cptReconnaissance";
import {
  controlerLotReleve,
  ligneReleveImportable,
  moisPrincipalReleve,
  type LigneReleve,
  type SignalementReleve,
  type TypeReleveCpt,
} from "./cptReleve";
import { cleSequenceAnnuelle, reserverNumerosCpt } from "./cptSequence";

export class CptImportReleveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptImportReleveError";
  }
}

export type CptImportReleveDb = Prisma.TransactionClient;

/** Type de compte qui peut recevoir chaque type de relevé : un relevé Wave ne s'importe pas dans le compte d'une banque. */
export const TYPE_COMPTE_PAR_TYPE_RELEVE: Record<TypeReleveCpt, "WAVE_BUSINESS" | "WAVE_HORS_BUSINESS" | "BANQUE" | "MICROFINANCE" | "AGREGATEUR"> = {
  RELEVE_WAVE_BUSINESS: "WAVE_BUSINESS",
  RELEVE_WAVE_HORS_BUSINESS: "WAVE_HORS_BUSINESS",
  RELEVE_BANQUE: "BANQUE",
  RELEVE_MICROFINANCE: "MICROFINANCE",
  RELEVE_PEYAPAY: "AGREGATEUR",
};

/** Sens inverse : le type de relevé qu'un compte reçoit, déduit de son type (`null` : une caisse n'a pas de relevé importable). */
export const TYPE_RELEVE_PAR_TYPE_COMPTE: Record<string, TypeReleveCpt | null> = {
  WAVE_BUSINESS: "RELEVE_WAVE_BUSINESS",
  WAVE_HORS_BUSINESS: "RELEVE_WAVE_HORS_BUSINESS",
  BANQUE: "RELEVE_BANQUE",
  MICROFINANCE: "RELEVE_MICROFINANCE",
  AGREGATEUR: "RELEVE_PEYAPAY",
  CAISSE: null,
};

const TAILLE_LOT = 1000;
const ZERO = BigInt(0);
const absolu = (n: bigint) => (n < ZERO ? -n : n);
const jour = (texte: string) => new Date(`${texte}T00:00:00.000Z`);
const dateIso = (d: Date) => d.toISOString().slice(0, 10);
const moisDe = (date: string) => `${date.slice(0, 7)}-01`;
const centimes = (d: { toString(): string } | null | undefined) => (d == null ? null : enCentimesEcheancier(d.toString()));

function parLots<T>(elements: readonly T[], taille = TAILLE_LOT): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < elements.length; i += taille) lots.push(elements.slice(i, i + taille));
  return lots;
}

export interface ParametresImportReleve {
  type: TypeReleveCpt;
  compteId: string;
  /** Lecture du fichier (anomalies de cellule, type de tableur). */
  lecture: Pick<ResultatLectureCpt, "anomalies" | "nbAnomalies" | "nbLignesVidesIgnorees" | "typeTableur">;
  /** Lignes typées issues de `lireReleveCpt`. */
  lignes: LigneReleve[];
  formatId: string | null;
  /** `CptPieceJointe` du fichier déposé. */
  fichierId: string;
  /** SHA-256 hexadécimal du CONTENU du fichier. */
  empreinte: string;
  userId: string;
  ip?: string | null;
  maintenant?: Date;
  /** Mois du relevé, `AAAA-MM-01` ; à défaut le mois qui porte le plus de lignes. */
  periode?: string | null;
  /** Tolérance du contrôle net = brut − frais, en centimes (défaut 100). */
  toleranceNetCentimes?: bigint;
  fenetreJoursVirement?: number;
  toleranceVirementCentimes?: bigint;
}

export interface BilanImportReleve {
  typeTableur: string;
  periode: string;
  lignesLues: number;
  lignesVidesIgnorees: number;
  lignesRejetees: number;
  lignesDejaImportees: number;
  encaissementsCrees: number;
  parType: Record<TypeFluxCpt, number>;
  virementsApparies: number;
  /** Crédits et frais des lignes créées, en texte « 123.45 ». */
  totalCredits: string;
  totalFrais: string;
  anomaliesCreees: number;
  anomaliesLecture: number;
  signalements: { bloquants: number; alertes: number; infos: number };
}

export interface ResultatImportReleve {
  importId: string;
  releveId: string;
  bilan: BilanImportReleve;
}

interface AnomaliePrevue {
  type: string;
  objetEntite: string;
  objetId: string;
  detail: Prisma.InputJsonValue;
}

interface ContrepartieEnBase {
  id: string;
  compteId: string;
  typeFlux: "ENCAISSEMENT" | "AUTRE_DEBIT";
  montantTexte: string;
}

export async function appliquerImportReleveCpt(tx: CptImportReleveDb, p: ParametresImportReleve): Promise<ResultatImportReleve> {
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = dateIso(maintenant);

  // Verrou d'abord : tout ce qui suit (anti-doublon, contreparties) doit voir l'état après l'import précédent.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpt:releves'))`;

  const dejaImporte = await tx.cptImport.findUnique({ where: { empreinte: p.empreinte }, select: { creeAt: true } });
  if (dejaImporte) {
    throw new CptImportReleveError(`Ce fichier a déjà été importé le ${dateIso(dejaImporte.creeAt)} : un même fichier ne s'importe qu'une fois.`);
  }

  const compte = await tx.cptCompte.findUnique({ where: { id: p.compteId }, select: { id: true, actif: true, type: true, libelle: true } });
  if (!compte) throw new CptImportReleveError("Compte d'encaissement introuvable.");
  if (!compte.actif) throw new CptImportReleveError(`Le compte « ${compte.libelle} » est désactivé : réactivez-le avant d'importer un relevé.`);
  if (compte.type !== TYPE_COMPTE_PAR_TYPE_RELEVE[p.type]) {
    throw new CptImportReleveError(`Le compte « ${compte.libelle} » ne peut pas recevoir un relevé de ce type.`);
  }

  const periode = p.periode ?? moisPrincipalReleve(p.lignes);
  if (!periode || !/^\d{4}-\d{2}-01$/.test(periode)) {
    throw new CptImportReleveError("Mois du relevé introuvable : aucune ligne n'a de date lisible et aucun mois n'a été indiqué.");
  }

  const controle = controlerLotReleve(p.lignes, { aujourdhui, periode, toleranceCentimes: p.toleranceNetCentimes });

  const importCree = await tx.cptImport.create({
    data: { type: p.type, formatId: p.formatId, fichierId: p.fichierId, empreinte: p.empreinte, compteId: p.compteId, periode: jour(periode), statut: "VALIDE", creeParId: p.userId },
    select: { id: true },
  });
  const importId = importCree.id;

  const anomalies: AnomaliePrevue[] = [];
  const audits: CptAuditEntree[] = [];
  const objetLigne = (numeroLigne: number) => ({ objetEntite: "LIGNE_IMPORT", objetId: `${importId}:${numeroLigne}` });
  const detailSignalement = (ligne: LigneReleve, s: SignalementReleve): Prisma.InputJsonValue => ({
    numeroLigne: ligne.numeroLigne,
    reference: ligne.reference,
    champ: s.champ ?? null,
    gravite: s.gravite,
    message: s.message,
  });

  // ---------- Lignes importables : signalements bloquants et mois clôturés écartés ----------
  const moisLignes = [...new Set(p.lignes.flatMap((l) => (l.dateValeur ? [moisDe(l.dateValeur)] : [])))];
  const clotures = new Set<string>();
  if (moisLignes.length > 0) {
    const trouves = await tx.cptPeriode.findMany({ where: { statut: "CLOTUREE", mois: { in: moisLignes.map(jour) } }, select: { mois: true } });
    for (const t of trouves) clotures.add(dateIso(t.mois));
  }

  let lignesRejetees = 0;
  const importables: LigneReleveComplete[] = [];
  for (const ligne of p.lignes) {
    const signalements = controle.parLigne.get(ligne.numeroLigne) ?? [];
    if (!ligneReleveImportable(signalements)) {
      lignesRejetees += 1;
      for (const s of signalements.filter((x) => x.gravite !== "INFO")) anomalies.push({ type: s.code, ...objetLigne(ligne.numeroLigne), detail: detailSignalement(ligne, s) });
      continue;
    }
    const complete = enLigneComplete(ligne) as LigneReleveComplete; // aucun signalement bloquant garantit référence, date et montant
    if (clotures.has(moisDe(complete.dateValeur))) {
      lignesRejetees += 1;
      anomalies.push({
        type: "PERIODE_CLOTUREE",
        ...objetLigne(ligne.numeroLigne),
        detail: { numeroLigne: ligne.numeroLigne, reference: ligne.reference, gravite: "BLOQUANT", message: `Le mois ${moisDe(complete.dateValeur).slice(0, 7)} est clôturé : la ligne n'est pas importée.` },
      });
      continue;
    }
    importables.push(complete);
  }

  // ---------- Contexte de la reconnaissance : références déjà connues, contreparties de virement ----------
  const referencesExistantes = new Set<string>();
  for (const lot of parLots([...new Set(importables.map((l) => l.reference))])) {
    const trouves = await tx.cptEncaissement.findMany({ where: { compteId: p.compteId, referenceReleve: { in: lot } }, select: { referenceReleve: true } });
    for (const t of trouves) referencesExistantes.add(t.referenceReleve);
  }

  const fenetre = p.fenetreJoursVirement ?? 3;
  const contreparties: ContrepartieVirement[] = [];
  const contrepartiesEnBase = new Map<string, ContrepartieEnBase>();
  const lignesAApparier = importables.filter((l) => l.montant !== ZERO && !referencesExistantes.has(l.reference));
  if (lignesAApparier.length > 0) {
    const dates = lignesAApparier.map((l) => l.dateValeur).sort();
    const bornes = {
      gte: new Date(jour(dates[0]).getTime() - fenetre * 86_400_000),
      lte: new Date(jour(dates[dates.length - 1]).getTime() + fenetre * 86_400_000),
    };
    const montants = [...new Set(lignesAApparier.map((l) => texteDepuisCentimes(absolu(l.montant))))];
    for (const lot of parLots(montants)) {
      const trouves = await tx.cptEncaissement.findMany({
        where: {
          compteId: { not: p.compteId },
          montant: { in: lot },
          dateValeur: bornes,
          OR: [{ typeFlux: "ENCAISSEMENT", statut: "A_RATTACHER" }, { typeFlux: "AUTRE_DEBIT" }],
        },
        select: { id: true, compteId: true, dateValeur: true, montant: true, typeFlux: true, resteARattacher: true, montantPasUnePrime: true },
      });
      for (const t of trouves) {
        const montant = centimes(t.montant);
        if (montant === null) continue;
        // Un crédit déjà entamé (rattachement validé, part « pas une prime ») n'est plus une contrepartie libre.
        if (t.typeFlux === "ENCAISSEMENT" && (centimes(t.resteARattacher) !== montant || (centimes(t.montantPasUnePrime) ?? ZERO) !== ZERO)) continue;
        contreparties.push({ id: t.id, compteId: t.compteId, dateValeur: dateIso(t.dateValeur), montant, sens: t.typeFlux === "ENCAISSEMENT" ? "ENTREE" : "SORTIE" });
        contrepartiesEnBase.set(t.id, { id: t.id, compteId: t.compteId, typeFlux: t.typeFlux as "ENCAISSEMENT" | "AUTRE_DEBIT", montantTexte: t.montant.toString() });
      }
    }
  }

  const reconnues = reconnaitreLignesReleve(importables, {
    compteId: p.compteId,
    referencesExistantes,
    contreparties,
    fenetreJoursVirement: p.fenetreJoursVirement,
    toleranceVirementCentimes: p.toleranceVirementCentimes,
  });
  const bilanReco = bilanReconnaissance(reconnues);

  // ---------- Numéros CPE, par année de la date de valeur, dans l'ordre du fichier ----------
  const aCreer = importables.map((ligne, i) => ({ ligne, reco: reconnues[i] })).filter((x) => x.reco.decision === "A_CREER");
  const parAnnee = new Map<string, number>();
  for (const x of aCreer) {
    const annee = x.ligne.dateValeur.slice(0, 4);
    parAnnee.set(annee, (parAnnee.get(annee) ?? 0) + 1);
  }
  const numeros = new Map<string, string[]>();
  for (const annee of [...parAnnee.keys()].sort()) {
    numeros.set(annee, await reserverNumerosCpt(tx, cleSequenceAnnuelle("CPE", Number(annee)), parAnnee.get(annee)!));
  }
  const curseur = new Map<string, number>();
  const prochainNumeroDeLAnnee = (annee: string) => {
    const k = curseur.get(annee) ?? 0;
    curseur.set(annee, k + 1);
    return numeros.get(annee)![k];
  };

  // ---------- Relevé et encaissements ----------
  // Les crédits du relevé n'incluent PAS les transactions test : le sens d'une ligne test (crédit ou débit) n'est pas conservé en base
  // (`montant` est toujours positif), et un test n'est jamais de l'argent reçu. Ainsi le contrôle mensuel est exact :
  // Σ crédits des relevés = Σ encaissements de type ENCAISSEMENT + Σ virements internes reçus.
  let totalCredits = ZERO;
  let totalFrais = ZERO;
  for (const x of aCreer) {
    if (x.ligne.montant > ZERO && x.reco.typeFlux !== "TEST") totalCredits += x.ligne.montant;
    totalFrais += x.ligne.frais ?? ZERO;
  }
  const releveId = randomUUID();
  await tx.cptReleve.create({
    data: { id: releveId, importId, compteId: p.compteId, periode: jour(periode), nbLignes: aCreer.length, totalCredits: texteDepuisCentimes(totalCredits), totalFrais: texteDepuisCentimes(totalFrais) },
  });

  const lignesCreees = aCreer.map((x) => ({ ...x, id: randomUUID(), reference: prochainNumeroDeLAnnee(x.ligne.dateValeur.slice(0, 4)) }));
  for (const lot of parLots(lignesCreees)) {
    await tx.cptEncaissement.createMany({
      data: lot.map(({ ligne, reco, id, reference }) => {
        const montant = texteDepuisCentimes(absolu(ligne.montant));
        const credit = reco.typeFlux === "ENCAISSEMENT";
        return {
          id,
          reference,
          compteId: p.compteId,
          referenceReleve: ligne.reference,
          dateValeur: jour(ligne.dateValeur),
          montant,
          frais: texteDepuisCentimes(ligne.frais ?? ZERO),
          typeFlux: reco.typeFlux,
          typeSource: ligne.typeSource,
          payeur: ligne.payeur,
          telephone: ligne.telephone,
          referenceClient: ligne.referenceClient,
          libelle: ligne.libelle,
          sessionPaiement: ligne.sessionPaiement,
          statut: credit ? ("A_RATTACHER" as const) : ("SANS_OBJET" as const),
          resteARattacher: credit ? montant : "0.00",
          releveId,
          ligneReleve: ligne.numeroLigne,
          creeParId: p.userId,
        };
      }),
    });
  }

  // ---------- Virements : l'autre côté passe en virement interne, le transfert est créé ----------
  const transferts: Prisma.CptTransfertInterneCreateManyInput[] = [];
  for (const { ligne, reco, id, reference } of lignesCreees) {
    if (reco.raison !== "VIREMENT_APPARIE" || !reco.contrepartieId) continue;
    const autre = contrepartiesEnBase.get(reco.contrepartieId);
    if (!autre) throw new CptImportReleveError(`Contrepartie de virement introuvable (ligne ${ligne.numeroLigne}).`);
    const ceCoteSortant = reco.typeFlux === "VIREMENT_INTERNE_SORTANT";
    const nouveauTypeAutre = ceCoteSortant ? "VIREMENT_INTERNE_ENTRANT" : "VIREMENT_INTERNE_SORTANT";
    const modifiees = await tx.cptEncaissement.updateMany({
      where: {
        id: autre.id,
        typeFlux: autre.typeFlux,
        ...(autre.typeFlux === "ENCAISSEMENT" ? { statut: "A_RATTACHER" as const, resteARattacher: autre.montantTexte, montantPasUnePrime: "0" } : {}),
      },
      data: { typeFlux: nouveauTypeAutre, statut: "SANS_OBJET", resteARattacher: "0.00" },
    });
    if (modifiees.count !== 1) {
      throw new CptImportReleveError(`La ligne de l'autre compte a changé pendant l'import (ligne ${ligne.numeroLigne}) : relancez l'import.`);
    }
    transferts.push({
      encaissementSortantId: ceCoteSortant ? id : autre.id,
      encaissementEntrantId: ceCoteSortant ? autre.id : id,
      compteSourceId: ceCoteSortant ? p.compteId : autre.compteId,
      compteCibleId: ceCoteSortant ? autre.compteId : p.compteId,
      creeParId: p.userId,
    });
    audits.push({
      entite: "CptEncaissement",
      entiteId: autre.id,
      action: "reconnaissance_virement",
      avant: { typeFlux: autre.typeFlux },
      apres: { typeFlux: nouveauTypeAutre, apparieAvec: reference, importId },
      mois: jour(ligne.dateValeur),
      userId: p.userId,
      ip: p.ip,
    });
  }
  for (const lot of parLots(transferts)) await tx.cptTransfertInterne.createMany({ data: lot });

  // ---------- Anomalies, audit, bilan ----------
  for (const { ligne, reco, id } of lignesCreees) {
    const alertes = (controle.parLigne.get(ligne.numeroLigne) ?? []).filter((s) => s.gravite === "ALERTE");
    for (const s of alertes) anomalies.push({ type: s.code, objetEntite: "ENCAISSEMENT", objetId: id, detail: detailSignalement(ligne, s) });
    for (const s of reco.signalements) {
      anomalies.push({ type: s.code, objetEntite: "ENCAISSEMENT", objetId: id, detail: { numeroLigne: ligne.numeroLigne, reference: ligne.reference, gravite: "ALERTE", message: s.message } });
    }
  }
  for (const a of p.lecture.anomalies) {
    anomalies.push({
      type: "CELLULE_ILLISIBLE",
      ...objetLigne(a.numeroLigne),
      detail: { numeroLigne: a.numeroLigne, champ: a.champ, entete: a.entete, valeurBrute: a.valeurBrute, message: a.motif },
    });
  }
  for (const lot of parLots(anomalies)) {
    await tx.cptAnomalie.createMany({ data: lot.map((a) => ({ type: a.type, objetEntite: a.objetEntite, objetId: a.objetId, detail: a.detail, importId })) });
  }

  const bilan: BilanImportReleve = {
    typeTableur: p.lecture.typeTableur,
    periode,
    lignesLues: p.lignes.length,
    lignesVidesIgnorees: p.lecture.nbLignesVidesIgnorees,
    lignesRejetees,
    lignesDejaImportees: bilanReco.nbDejaImportees,
    encaissementsCrees: aCreer.length,
    parType: bilanReco.parType,
    virementsApparies: bilanReco.nbVirementsApparies,
    totalCredits: texteDepuisCentimes(totalCredits),
    totalFrais: texteDepuisCentimes(totalFrais),
    anomaliesCreees: anomalies.length,
    anomaliesLecture: p.lecture.nbAnomalies,
    signalements: { bloquants: controle.nbBloquants, alertes: controle.nbAlertes, infos: controle.nbInfos },
  };

  for (const { ligne, reco, id, reference } of lignesCreees) {
    audits.push({
      entite: "CptEncaissement",
      entiteId: id,
      action: "creation",
      apres: { reference, compteId: p.compteId, referenceReleve: ligne.reference, typeFlux: reco.typeFlux, montant: texteDepuisCentimes(absolu(ligne.montant)), importId },
      mois: jour(ligne.dateValeur),
      userId: p.userId,
      ip: p.ip,
    });
  }
  audits.push({ entite: "CptImport", entiteId: importId, action: "import_releve", apres: bilan, mois: jour(periode), userId: p.userId, ip: p.ip });
  for (const lot of parLots(audits)) await tx.cptAudit.createMany({ data: lot.map((a) => preparerAudit(a)) });

  await tx.cptImport.update({ where: { id: importId }, data: { bilan: bilan as unknown as Prisma.InputJsonValue } });
  return { importId, releveId, bilan };
}
