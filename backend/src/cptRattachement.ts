// Gestion Compta, lot GC-5c : application en base du rattachement des encaissements aux échéances (docs/compta-conception.md §6.2).
//
// Tout se passe dans la transaction de l'appelant (`tx`). Les RÈGLES sont celles du moteur pur (`cptRapprochement.ts` : propositions,
// transitions, plafonds) ; ce module ajoute ce que seule la base garantit :
//  - ordre de verrouillage UNIQUE (encaissements triés, puis échéances triées) : deux validations simultanées ne s'interbloquent pas et le
//    trigger SQL de la migration 20261101190000 rejoue les mêmes plafonds sous verrou (ceinture et bretelles) ;
//  - mises à jour CONDITIONNÉES au statut lu (`updateMany`) : deux personnes qui agissent en même temps sur la même proposition, une seule passe ;
//  - seul un rattachement VALIDE rend la prime payée (RG-01) : à la validation, `CptEncaissement.resteARattacher` / `statut` et
//    `CptEcheance.montantRegle` / `etat` sont RECALCULÉS depuis la somme des rattachements validés (jamais incrémentés) ;
//  - les propositions d'un même groupe (méthode 4) se confirment, se valident et se rejettent ensemble.
// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

import { randomUUID } from "node:crypto";

import type { Prisma } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";
import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import { appliquerTaxeRattachementsCpt } from "./cptTaxeDb";
import {
  controlerConfirmationCpt,
  proposerRattachementsCpt,
  refusSommesValidationCpt,
  resteARattacherCpt,
  transitionRattachementCpt,
  type EcheanceCandidateCpt,
  type EncaissementARapprocher,
  type NiveauPreuveCpt,
  type ParametresRapprochementCpt,
  type StatutRattachementCpt,
} from "./cptRapprochement";

export type CptRattachementDb = Prisma.TransactionClient;

export const RATTACHEMENTS_PAR_LOT_MAX_CPT = 200;
export const ENCAISSEMENTS_PAR_RAPPROCHEMENT_MAX_CPT = 5000;
export const JUSTIFICATION_MANUELLE_MIN_CPT = 10;
export const MOTIF_PAS_UNE_PRIME_MIN_CPT = 5;
export const MESSAGE_RATTACHEMENT_INTROUVABLE_CPT = "Rattachement introuvable.";
export const MESSAGE_DEJA_MODIFIE_CPT = "Ce rattachement vient d'être modifié par quelqu'un d'autre : actualisez la page.";
export const MESSAGE_MEME_COMPTE_CPT = "Le compte qui a confirmé un rattachement ne peut pas le valider.";

const ZERO = BigInt(0);
const centimes = (d: { toFixed(n: number): string }) => enCentimesEcheancier(d.toFixed(2)) ?? ZERO;
const jour = (d: Date) => d.toISOString().slice(0, 10);

export interface ParametresActionCpt {
  userId: string;
  ip?: string | null;
  maintenant?: Date;
}

// ---------------------------------------------------------------------------------------------------------------------
// Verrous
// ---------------------------------------------------------------------------------------------------------------------

/** Verrouille les encaissements puis les échéances, chacun dans l'ordre de ses identifiants (ordre fixe : pas d'interblocage). */
async function verrouiller(db: CptRattachementDb, encaissementIds: string[], echeanceIds: string[]): Promise<void> {
  const encs = [...new Set(encaissementIds)].sort();
  const echs = [...new Set(echeanceIds)].sort();
  if (encs.length > 0) await db.$queryRaw`SELECT "id" FROM "CptEncaissement" WHERE "id" = ANY(${encs}::text[]) ORDER BY "id" FOR UPDATE`;
  if (echs.length > 0) await db.$queryRaw`SELECT "id" FROM "CptEcheance" WHERE "id" = ANY(${echs}::text[]) ORDER BY "id" FOR UPDATE`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Propositions du moteur
// ---------------------------------------------------------------------------------------------------------------------

interface LigneCandidate {
  echeanceId: string;
  contratId: string;
  numPolice: string;
  rang: number;
  clientNom: string;
  partenaireId: string | null;
  referenceDeclaree: string | null;
  datePaiementDeclaree: string | null;
  datePrevue: string;
  reste: bigint;
}

/**
 * Échéances que le moteur peut proposer : les trois plus anciennes échéances OUVERTES (reste > 0) de chaque contrat en cours. Une seule
 * requête, sans aller-retour par contrat ; le reste est calculé par la base (montant dû − déjà rattaché VALIDE, tenu à jour à la validation).
 */
export async function chargerCandidatsCpt(db: CptRattachementDb): Promise<EcheanceCandidateCpt[]> {
  const lignes = await db.$queryRaw<LigneCandidate[]>`
    SELECT e."id" AS "echeanceId", e."contratId", c."numPolice", e."rang", cl."nom" AS "clientNom",
           c."partenaireApporteurId" AS "partenaireId", c."referencePaiementDeclaree" AS "referenceDeclaree",
           to_char(c."datePaiementDeclaree", 'YYYY-MM-DD') AS "datePaiementDeclaree",
           to_char(e."datePrevue", 'YYYY-MM-DD') AS "datePrevue",
           ((e."montantDu" - e."montantRegle") * 100)::bigint AS "reste"
    FROM (
      SELECT *, row_number() OVER (PARTITION BY "contratId" ORDER BY "rang") AS rn
      FROM "CptEcheance" WHERE "etat" = 'OUVERTE'
    ) e
    JOIN "CptContrat" c ON c."id" = e."contratId" AND c."statut" = 'EN_COURS'
    JOIN "CptClient" cl ON cl."id" = c."clientId"
    WHERE e.rn <= 3 AND e."montantDu" > e."montantRegle"`;
  return lignes.map((l) => ({ ...l, reste: BigInt(l.reste) }));
}

export interface BilanRapprochementCpt {
  encaissementsExamines: number;
  propositionsCreees: number;
  encaissementsSansProposition: number;
  parMethode: Record<string, number>;
}

/**
 * Calcule et ENREGISTRE les propositions (état PROPOSE, `proposeParId` nul = moteur) pour les encaissements à rattacher qui n'en ont pas
 * déjà une vivante. Idempotent : un second passage n'ajoute rien tant que les propositions existantes ne sont ni confirmées-validées ni
 * rejetées. Ne rattache JAMAIS : aucune prime n'est payée avant la validation du RFCRH (RG-01, RG-02).
 */
export async function lancerRapprochementCpt(
  db: CptRattachementDb,
  p: ParametresActionCpt & { limite?: number; parametres?: ParametresRapprochementCpt },
): Promise<BilanRapprochementCpt> {
  // Un seul rapprochement à la fois : deux lancements simultanés ne créent pas deux fois les mêmes propositions.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpt:rapprochement'))`;
  const limite = Math.min(p.limite ?? ENCAISSEMENTS_PAR_RAPPROCHEMENT_MAX_CPT, ENCAISSEMENTS_PAR_RAPPROCHEMENT_MAX_CPT);

  const lignes = await db.cptEncaissement.findMany({
    where: {
      typeFlux: "ENCAISSEMENT",
      statut: "A_RATTACHER",
      resteARattacher: { gt: 0 },
      rattachements: { none: { statut: { in: ["PROPOSE", "CONFIRME"] } } },
    },
    orderBy: [{ dateValeur: "asc" }, { reference: "asc" }],
    take: limite,
    select: { id: true, referenceReleve: true, referenceClient: true, dateValeur: true, resteARattacher: true, payeur: true },
  });
  const encaissements: EncaissementARapprocher[] = lignes.map((l) => ({
    id: l.id,
    // La référence saisie par le payeur (souvent le numéro de police) passe avant celle de l'opérateur pour la méthode « référence ».
    referenceReleve: l.referenceClient?.trim() ? l.referenceClient : l.referenceReleve,
    dateValeur: jour(l.dateValeur),
    montant: centimes(l.resteARattacher),
    payeur: l.payeur,
  }));

  const candidates = encaissements.length > 0 ? await chargerCandidatsCpt(db) : [];
  const resultat = proposerRattachementsCpt(encaissements, candidates, p.parametres);

  if (resultat.propositions.length > 0) {
    await db.cptRattachement.createMany({
      data: resultat.propositions.map((x) => ({
        encaissementId: x.encaissementId,
        echeanceId: x.echeanceId,
        montant: texteDepuisCentimes(x.montant),
        methode: x.methode,
        niveauPreuve: x.niveauPreuve,
        justification: x.justification,
        groupe: x.groupe,
      })),
    });
  }
  const parMethode: Record<string, number> = {};
  for (const x of resultat.propositions) parMethode[x.methode] = (parMethode[x.methode] ?? 0) + 1;
  const bilan: BilanRapprochementCpt = {
    encaissementsExamines: encaissements.length,
    propositionsCreees: resultat.propositions.length,
    encaissementsSansProposition: resultat.sansProposition.length,
    parMethode,
  };
  await ecrireAudit(db, { entite: "CptRattachement", entiteId: `rapprochement-${randomUUID()}`, action: "rapprochement", apres: bilan, userId: p.userId, ip: p.ip });
  return bilan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture d'un lot (avec les propositions de son groupe)
// ---------------------------------------------------------------------------------------------------------------------

interface RattachementLu {
  id: string;
  encaissementId: string;
  echeanceId: string;
  montant: bigint;
  niveauPreuve: NiveauPreuveCpt;
  statut: StatutRattachementCpt;
  groupe: string | null;
  recuReference: string | null;
  recuPieceId: string | null;
  confirmeParId: string | null;
}

async function lireAvecGroupes(db: CptRattachementDb, ids: readonly string[]): Promise<RattachementLu[]> {
  const brut = await db.cptRattachement.findMany({
    where: { id: { in: [...ids] } },
    select: { groupe: true },
  });
  const groupes = [...new Set(brut.map((b) => b.groupe).filter((g): g is string => !!g))];
  const lignes = await db.cptRattachement.findMany({
    where: { OR: [{ id: { in: [...ids] } }, ...(groupes.length > 0 ? [{ groupe: { in: groupes } }] : [])] },
    select: {
      id: true,
      encaissementId: true,
      echeanceId: true,
      montant: true,
      niveauPreuve: true,
      statut: true,
      groupe: true,
      recuReference: true,
      recuPieceId: true,
      confirmeParId: true,
    },
    orderBy: { id: "asc" },
  });
  return lignes.map((l) => ({ ...l, montant: centimes(l.montant) }));
}

/** Les rattachements d'un lot, regroupés : un groupe (méthode 4) est traité d'un bloc, les autres un par un. */
function enBlocs(lignes: RattachementLu[]): RattachementLu[][] {
  const parGroupe = new Map<string, RattachementLu[]>();
  const blocs: RattachementLu[][] = [];
  for (const l of lignes) {
    if (!l.groupe) {
      blocs.push([l]);
      continue;
    }
    const bloc = parGroupe.get(l.groupe);
    if (bloc) bloc.push(l);
    else {
      const nouveau = [l];
      parGroupe.set(l.groupe, nouveau);
      blocs.push(nouveau);
    }
  }
  return blocs;
}

export interface ResultatBlocCpt {
  ids: string[];
  ok: boolean;
  message?: string;
}

function verifierTaille(ids: readonly string[]): string | null {
  if (ids.length === 0) return "Aucun rattachement sélectionné.";
  if (ids.length > RATTACHEMENTS_PAR_LOT_MAX_CPT) return `Au plus ${RATTACHEMENTS_PAR_LOT_MAX_CPT} rattachements à la fois.`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Étape 1 : confirmation du commercial, avec le reçu
// ---------------------------------------------------------------------------------------------------------------------

export async function confirmerRattachementsCpt(
  db: CptRattachementDb,
  ids: readonly string[],
  p: ParametresActionCpt & { recuReference?: string | null; recuPieceId?: string | null; commentaire?: string | null },
): Promise<{ ok: true; resultats: ResultatBlocCpt[] } | { ok: false; message: string }> {
  const taille = verifierTaille(ids);
  if (taille) return { ok: false, message: taille };
  const recuReference = (p.recuReference ?? "").replace(/\s+/g, " ").trim() || null;
  if (!recuReference && !p.recuPieceId) return { ok: false, message: controlerConfirmationCpt(null)! };
  const maintenant = p.maintenant ?? new Date();

  const lus = await lireAvecGroupes(db, [...new Set(ids)]);
  if (lus.length === 0) return { ok: false, message: MESSAGE_RATTACHEMENT_INTROUVABLE_CPT };
  const resultats: ResultatBlocCpt[] = [];
  for (const bloc of enBlocs(lus)) {
    const refus = bloc
      .map((l) => transitionRattachementCpt({ statut: l.statut, niveauPreuve: l.niveauPreuve, recuConfirmation: null }, "CONFIRMER"))
      .find((t) => !t.ok);
    if (refus && !refus.ok) {
      resultats.push({ ids: bloc.map((l) => l.id), ok: false, message: refus.raison });
      continue;
    }
    let appliques = 0;
    for (const l of bloc) {
      const maj = await db.cptRattachement.updateMany({
        where: { id: l.id, statut: "PROPOSE" },
        data: {
          statut: "CONFIRME",
          confirmeParId: p.userId,
          confirmeAt: maintenant,
          recuReference,
          recuPieceId: p.recuPieceId ?? null,
          commentaireConfirmation: p.commentaire?.trim() || null,
        },
      });
      appliques += maj.count;
      if (maj.count === 1) {
        await ecrireAudit(db, {
          entite: "CptRattachement",
          entiteId: l.id,
          action: "confirmation",
          avant: { statut: "PROPOSE" },
          apres: { statut: "CONFIRME", recuReference, recuPieceId: p.recuPieceId ?? null },
          motif: p.commentaire ?? null,
          userId: p.userId,
          ip: p.ip,
        });
      }
    }
    resultats.push(
      appliques === bloc.length ? { ids: bloc.map((l) => l.id), ok: true } : { ids: bloc.map((l) => l.id), ok: false, message: MESSAGE_DEJA_MODIFIE_CPT },
    );
  }
  return { ok: true, resultats };
}

// ---------------------------------------------------------------------------------------------------------------------
// Étape 2 : validation du RFCRH
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Valide des rattachements (seuls ou par lot). Un bloc (groupe) est atomique : un seul membre refusé, aucun n'est validé. Les plafonds
 * (Σ validés ≤ encaissement, ≤ montant dû) sont vérifiés ici sous verrou ET rejoués par le trigger SQL. Après chaque validation,
 * `resteARattacher`, `statut`, `montantRegle` et `etat` sont recalculés depuis la somme des rattachements validés.
 */
export async function validerRattachementsCpt(
  db: CptRattachementDb,
  ids: readonly string[],
  p: ParametresActionCpt,
): Promise<{ ok: true; resultats: ResultatBlocCpt[] } | { ok: false; message: string }> {
  const taille = verifierTaille(ids);
  if (taille) return { ok: false, message: taille };
  const maintenant = p.maintenant ?? new Date();

  // 1. Lecture préalable pour connaître ce qu'il faut verrouiller, 2. verrous dans l'ordre fixe, 3. relecture sous verrou.
  const apercu = await lireAvecGroupes(db, [...new Set(ids)]);
  if (apercu.length === 0) return { ok: false, message: MESSAGE_RATTACHEMENT_INTROUVABLE_CPT };
  await verrouiller(db, apercu.map((l) => l.encaissementId), apercu.map((l) => l.echeanceId));
  const lus = await lireAvecGroupes(db, [...new Set(ids)]);

  const encIds = [...new Set(lus.map((l) => l.encaissementId))];
  const echIds = [...new Set(lus.map((l) => l.echeanceId))];
  const [encaissements, echeances, sommesEnc, sommesEch] = await Promise.all([
    db.cptEncaissement.findMany({ where: { id: { in: encIds } }, select: { id: true, montant: true, montantPasUnePrime: true } }),
    db.cptEcheance.findMany({ where: { id: { in: echIds } }, select: { id: true, montantDu: true } }),
    db.cptRattachement.groupBy({ by: ["encaissementId"], where: { encaissementId: { in: encIds }, statut: "VALIDE" }, _sum: { montant: true } }),
    db.cptRattachement.groupBy({ by: ["echeanceId"], where: { echeanceId: { in: echIds }, statut: "VALIDE" }, _sum: { montant: true } }),
  ]);
  const montantEnc = new Map(encaissements.map((e) => [e.id, centimes(e.montant)]));
  const pasUnePrime = new Map(encaissements.map((e) => [e.id, centimes(e.montantPasUnePrime)]));
  const duEch = new Map(echeances.map((e) => [e.id, centimes(e.montantDu)]));
  const valideEnc = new Map(sommesEnc.map((s) => [s.encaissementId, s._sum.montant ? centimes(s._sum.montant) : ZERO]));
  const valideEch = new Map(sommesEch.map((s) => [s.echeanceId, s._sum.montant ? centimes(s._sum.montant) : ZERO]));

  const resultats: ResultatBlocCpt[] = [];
  const valides: string[] = [];
  const encTouches = new Set<string>();
  const echTouchees = new Set<string>();
  for (const bloc of enBlocs(lus)) {
    const idsBloc = bloc.map((l) => l.id);
    // Contrôles du bloc, sur des sommes de travail : rien n'est écrit tant que tous les membres ne passent pas.
    let refus: string | null = null;
    const ajoutEnc = new Map<string, bigint>();
    const ajoutEch = new Map<string, bigint>();
    for (const l of bloc) {
      const t = transitionRattachementCpt({ statut: l.statut, niveauPreuve: l.niveauPreuve, recuConfirmation: l.recuReference ?? (l.recuPieceId ? "pièce jointe" : null) }, "VALIDER");
      if (!t.ok) {
        refus = t.raison;
        break;
      }
      if (l.confirmeParId && l.confirmeParId === p.userId) {
        refus = MESSAGE_MEME_COMPTE_CPT;
        break;
      }
      const dejaEnc = (valideEnc.get(l.encaissementId) ?? ZERO) + (ajoutEnc.get(l.encaissementId) ?? ZERO);
      const dejaEch = (valideEch.get(l.echeanceId) ?? ZERO) + (ajoutEch.get(l.echeanceId) ?? ZERO);
      refus = refusSommesValidationCpt({
        montantRattachement: l.montant,
        montantEncaissement: (montantEnc.get(l.encaissementId) ?? ZERO) - (pasUnePrime.get(l.encaissementId) ?? ZERO),
        dejaValideSurEncaissement: dejaEnc,
        montantDuEcheance: duEch.get(l.echeanceId) ?? ZERO,
        dejaValideSurEcheance: dejaEch,
      });
      if (refus) break;
      ajoutEnc.set(l.encaissementId, (ajoutEnc.get(l.encaissementId) ?? ZERO) + l.montant);
      ajoutEch.set(l.echeanceId, (ajoutEch.get(l.echeanceId) ?? ZERO) + l.montant);
    }
    if (refus) {
      resultats.push({ ids: idsBloc, ok: false, message: refus });
      continue;
    }
    let appliques = 0;
    for (const l of bloc) {
      const maj = await db.cptRattachement.updateMany({
        where: { id: l.id, statut: l.statut },
        data: { statut: "VALIDE", valideParId: p.userId, valideAt: maintenant },
      });
      appliques += maj.count;
      if (maj.count === 1) {
        await ecrireAudit(db, {
          entite: "CptRattachement",
          entiteId: l.id,
          action: "validation",
          avant: { statut: l.statut },
          apres: { statut: "VALIDE", montant: texteDepuisCentimes(l.montant) },
          mois: maintenant,
          userId: p.userId,
          ip: p.ip,
        });
      }
    }
    if (appliques !== bloc.length) {
      // Quelqu'un d'autre est passé entre la lecture et l'écriture : on annule le bloc entier (le verrou rend ce cas exceptionnel).
      throw new Error(MESSAGE_DEJA_MODIFIE_CPT);
    }
    for (const [id, v] of ajoutEnc) {
      valideEnc.set(id, (valideEnc.get(id) ?? ZERO) + v);
      encTouches.add(id);
    }
    for (const [id, v] of ajoutEch) {
      valideEch.set(id, (valideEch.get(id) ?? ZERO) + v);
      echTouchees.add(id);
    }
    valides.push(...idsBloc);
    resultats.push({ ids: idsBloc, ok: true });
  }

  // Recalcul de l'avancement, depuis les sommes (jamais en incrémentant).
  for (const id of encTouches) {
    const { reste, statut } = resteARattacherCpt(montantEnc.get(id) ?? ZERO, valideEnc.get(id) ?? ZERO, pasUnePrime.get(id) ?? ZERO);
    await db.cptEncaissement.update({ where: { id }, data: { resteARattacher: texteDepuisCentimes(reste), statut } });
  }
  for (const id of echTouchees) {
    const regle = valideEch.get(id) ?? ZERO;
    await db.cptEcheance.update({ where: { id }, data: { montantRegle: texteDepuisCentimes(regle), etat: regle >= (duEch.get(id) ?? ZERO) ? "SOLDEE" : "OUVERTE" } });
  }
  // GC-8 : un rattachement VALIDÉ (et seulement lui, RG-01) porte sa taxe, dans la même transaction. Sans taux applicable, aucune
  // ligne n'est écrite : le rattachement reste valide et apparaît dans la liste « taux manquant ».
  await appliquerTaxeRattachementsCpt(db, valides, { userId: p.userId, ip: p.ip });
  return { ok: true, resultats };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rejet (RFCRH) : retour au commercial
// ---------------------------------------------------------------------------------------------------------------------

export async function rejeterRattachementsCpt(
  db: CptRattachementDb,
  ids: readonly string[],
  p: ParametresActionCpt & { motif: string },
): Promise<{ ok: true; resultats: ResultatBlocCpt[] } | { ok: false; message: string }> {
  const taille = verifierTaille(ids);
  if (taille) return { ok: false, message: taille };
  const motif = (p.motif ?? "").replace(/\s+/g, " ").trim();
  const maintenant = p.maintenant ?? new Date();
  const lus = await lireAvecGroupes(db, [...new Set(ids)]);
  if (lus.length === 0) return { ok: false, message: MESSAGE_RATTACHEMENT_INTROUVABLE_CPT };

  const resultats: ResultatBlocCpt[] = [];
  for (const bloc of enBlocs(lus)) {
    const refus = bloc.map((l) => transitionRattachementCpt({ statut: l.statut, niveauPreuve: l.niveauPreuve, recuConfirmation: null }, "REJETER", motif)).find((t) => !t.ok);
    if (refus && !refus.ok) {
      resultats.push({ ids: bloc.map((l) => l.id), ok: false, message: refus.raison });
      continue;
    }
    let appliques = 0;
    for (const l of bloc) {
      const maj = await db.cptRattachement.updateMany({
        where: { id: l.id, statut: { in: ["PROPOSE", "CONFIRME"] } },
        data: { statut: "REJETE", rejeteParId: p.userId, rejeteAt: maintenant, motifRejet: motif },
      });
      appliques += maj.count;
      if (maj.count === 1) {
        await ecrireAudit(db, { entite: "CptRattachement", entiteId: l.id, action: "rejet", avant: { statut: l.statut }, apres: { statut: "REJETE" }, motif, userId: p.userId, ip: p.ip });
      }
    }
    resultats.push(
      appliques === bloc.length ? { ids: bloc.map((l) => l.id), ok: true } : { ids: bloc.map((l) => l.id), ok: false, message: MESSAGE_DEJA_MODIFIE_CPT },
    );
  }
  return { ok: true, resultats };
}

// ---------------------------------------------------------------------------------------------------------------------
// Identification manuelle (commercial) : une identification est toujours « à confirmer » ; le commercial la confirme dans le même geste
// ---------------------------------------------------------------------------------------------------------------------

export interface PartIdentification {
  echeanceId: string;
  /** Centimes. */
  montant: bigint;
}

export async function identifierManuellementCpt(
  db: CptRattachementDb,
  p: ParametresActionCpt & {
    encaissementId: string;
    parts: readonly PartIdentification[];
    justification: string;
    recuReference?: string | null;
    recuPieceId?: string | null;
  },
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const justification = (p.justification ?? "").replace(/\s+/g, " ").trim();
  if (justification.length < JUSTIFICATION_MANUELLE_MIN_CPT) return { ok: false, message: `La justification est obligatoire (${JUSTIFICATION_MANUELLE_MIN_CPT} caractères au moins).` };
  const recuReference = (p.recuReference ?? "").replace(/\s+/g, " ").trim() || null;
  if (!recuReference && !p.recuPieceId) return { ok: false, message: controlerConfirmationCpt(null)! };
  if (p.parts.length === 0) return { ok: false, message: "Aucune échéance choisie." };
  if (new Set(p.parts.map((x) => x.echeanceId)).size !== p.parts.length) return { ok: false, message: "Une échéance ne peut figurer qu'une fois." };
  if (p.parts.some((x) => x.montant <= ZERO)) return { ok: false, message: "Chaque montant doit être positif." };

  await verrouiller(db, [p.encaissementId], p.parts.map((x) => x.echeanceId));
  const enc = await db.cptEncaissement.findUnique({ where: { id: p.encaissementId }, select: { id: true, typeFlux: true, statut: true, resteARattacher: true } });
  if (!enc) return { ok: false, message: "Encaissement introuvable." };
  if (enc.typeFlux !== "ENCAISSEMENT" || enc.statut !== "A_RATTACHER") return { ok: false, message: "Cet encaissement n'attend plus de rattachement." };
  const total = p.parts.reduce((s, x) => s + x.montant, ZERO);
  if (total > centimes(enc.resteARattacher)) return { ok: false, message: "Le total des parts dépasse ce qu'il reste à rattacher sur l'encaissement." };

  const echeances = await db.cptEcheance.findMany({
    where: { id: { in: p.parts.map((x) => x.echeanceId) } },
    select: { id: true, etat: true, montantDu: true, montantRegle: true },
  });
  for (const part of p.parts) {
    const e = echeances.find((x) => x.id === part.echeanceId);
    if (!e || e.etat !== "OUVERTE") return { ok: false, message: "Une des échéances choisies n'est plus ouverte." };
    if (part.montant > centimes(e.montantDu) - centimes(e.montantRegle)) return { ok: false, message: "Une part dépasse ce qu'il reste dû sur son échéance." };
  }
  const existant = await db.cptRattachement.count({
    where: { encaissementId: p.encaissementId, echeanceId: { in: p.parts.map((x) => x.echeanceId) }, statut: { in: ["PROPOSE", "CONFIRME", "VALIDE"] } },
  });
  if (existant > 0) return { ok: false, message: "Un rattachement existe déjà entre cet encaissement et une de ces échéances : rejetez-le d'abord." };

  const maintenant = p.maintenant ?? new Date();
  const groupe = p.parts.length > 1 ? `M-${randomUUID()}` : null;
  const ids: string[] = [];
  for (const part of p.parts) {
    const cree = await db.cptRattachement.create({
      data: {
        encaissementId: p.encaissementId,
        echeanceId: part.echeanceId,
        montant: texteDepuisCentimes(part.montant),
        methode: "MANUELLE",
        niveauPreuve: "A_CONFIRMER",
        statut: "CONFIRME",
        groupe,
        justification,
        proposeParId: p.userId,
        confirmeParId: p.userId,
        confirmeAt: maintenant,
        recuReference,
        recuPieceId: p.recuPieceId ?? null,
      },
      select: { id: true },
    });
    ids.push(cree.id);
    await ecrireAudit(db, { entite: "CptRattachement", entiteId: cree.id, action: "identification_manuelle", apres: { montant: texteDepuisCentimes(part.montant), recuReference }, motif: justification, userId: p.userId, ip: p.ip });
  }
  return { ok: true, ids };
}

// ---------------------------------------------------------------------------------------------------------------------
// « Pas une prime » (RG-03) : motif écrit obligatoire
// ---------------------------------------------------------------------------------------------------------------------

export async function classerPasUnePrimeCpt(
  db: CptRattachementDb,
  p: ParametresActionCpt & { encaissementId: string; montant: bigint; motif: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const motif = (p.motif ?? "").replace(/\s+/g, " ").trim();
  if (motif.length < MOTIF_PAS_UNE_PRIME_MIN_CPT) return { ok: false, message: `Le motif est obligatoire (${MOTIF_PAS_UNE_PRIME_MIN_CPT} caractères au moins).` };
  if (p.montant <= ZERO) return { ok: false, message: "Le montant doit être positif." };

  await verrouiller(db, [p.encaissementId], []);
  const enc = await db.cptEncaissement.findUnique({
    where: { id: p.encaissementId },
    select: { typeFlux: true, statut: true, montant: true, resteARattacher: true, montantPasUnePrime: true, motifPasUnePrime: true },
  });
  if (!enc) return { ok: false, message: "Encaissement introuvable." };
  if (enc.typeFlux !== "ENCAISSEMENT" || enc.statut !== "A_RATTACHER") return { ok: false, message: "Cet encaissement n'attend plus de rattachement." };
  const reste = centimes(enc.resteARattacher);
  if (p.montant > reste) return { ok: false, message: "Le montant dépasse ce qu'il reste à rattacher." };

  const nouveauPup = centimes(enc.montantPasUnePrime) + p.montant;
  const nouveauReste = reste - p.montant;
  const motifTotal = enc.motifPasUnePrime ? `${enc.motifPasUnePrime} | ${motif}` : motif;
  await db.cptEncaissement.update({
    where: { id: p.encaissementId },
    data: {
      montantPasUnePrime: texteDepuisCentimes(nouveauPup),
      motifPasUnePrime: motifTotal,
      resteARattacher: texteDepuisCentimes(nouveauReste),
      statut: nouveauReste === ZERO ? "SOLDE" : "A_RATTACHER",
    },
  });
  await ecrireAudit(db, {
    entite: "CptEncaissement",
    entiteId: p.encaissementId,
    action: "pas_une_prime",
    avant: { montantPasUnePrime: texteDepuisCentimes(centimes(enc.montantPasUnePrime)), resteARattacher: texteDepuisCentimes(reste) },
    apres: { montantPasUnePrime: texteDepuisCentimes(nouveauPup), resteARattacher: texteDepuisCentimes(nouveauReste) },
    motif,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true };
}
