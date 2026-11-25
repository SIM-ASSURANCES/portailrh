import type { Prisma } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";
import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import type { BrancheCpt, NatureContratCpt, TauxTcaLigne } from "./cptReferentiels";
import {
  baseAvanceCpt,
  calculerAvanceCpt,
  moisImputationLigneCpt,
  planifierTaxeRattachementCpt,
  tauxApplicableCpt,
  type AvanceTaxeCpt,
} from "./cptTaxe";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Écriture des lignes de taxe (lot GC-8b). Toujours dans la transaction de l'appelant. Les lignes sont en ajout seul : une
 * ligne n'est JAMAIS recréée ni réécrite (index uniques en base : une ligne RATTACHEMENT et une IMPUTATION par rattachement, une
 * AVANCE par encaissement).
 */

export type CptTaxeDb = Prisma.TransactionClient;

const ZERO = BigInt(0);
const centimes = (d: { toFixed(n: number): string } | null | undefined) => (d ? (enCentimesEcheancier(d.toFixed(2)) ?? ZERO) : ZERO);
const jour = (d: Date) => d.toISOString().slice(0, 10);
const texte = texteDepuisCentimes;

export interface ParametresTaxeCpt {
  userId: string;
  ip?: string | null;
  maintenant?: Date;
}

/** Verrou de la taxe : sérialise la création des lignes et la déclaration d'un mois (une ligne ne tombe jamais dans un mois en cours de déclaration). */
export async function verrouillerTaxeCpt(db: CptTaxeDb): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpt:tca'))`;
}

/** Dernier mois couvert par une déclaration (AAAA-MM-01), `null` s'il n'y en a pas. */
export async function dernierMoisDeclareCpt(db: CptTaxeDb): Promise<string | null> {
  const derniere = await db.cptDeclarationTca.findFirst({ orderBy: { mois: "desc" }, select: { mois: true } });
  return derniere ? jour(derniere.mois) : null;
}

export async function chargerTauxTcaCpt(db: CptTaxeDb): Promise<TauxTcaLigne[]> {
  const lignes = await db.cptTauxTca.findMany({ select: { id: true, branche: true, produitCode: true, natureContrat: true, taux: true, dateEffet: true } });
  return lignes.map((l) => ({ id: l.id, branche: l.branche as BrancheCpt, produitCode: l.produitCode, natureContrat: l.natureContrat as NatureContratCpt | null, taux: l.taux.toFixed(6), dateEffet: jour(l.dateEffet) }));
}

export interface BilanTaxeRattachementCpt {
  /** Lignes écrites (RATTACHEMENT + IMPUTATION). */
  lignesCreees: number;
  /** Rattachements déjà taxés (rien d'écrit). */
  dejaTaxes: number;
  /** Rattachements sans taux applicable : aucune ligne, jamais un zéro deviné (liste « taux manquant »). */
  sansTaux: string[];
}

/**
 * Taxe des rattachements VALIDÉS (RG-01 : aucun effet avant). Pour chacun, dans l'ordre : ligne RATTACHEMENT (taxe de l'échéance au
 * prorata, reliquat exact sur celui qui solde) et, si l'encaissement porte une avance, ligne IMPUTATION négative. Idempotent.
 */
export async function appliquerTaxeRattachementsCpt(db: CptTaxeDb, rattachementIds: readonly string[], p: ParametresTaxeCpt): Promise<BilanTaxeRattachementCpt> {
  const bilan: BilanTaxeRattachementCpt = { lignesCreees: 0, dejaTaxes: 0, sansTaux: [] };
  if (rattachementIds.length === 0) return bilan;
  await verrouillerTaxeCpt(db);
  const [dernierMois, referentiel] = await Promise.all([dernierMoisDeclareCpt(db), chargerTauxTcaCpt(db)]);

  const rattachements = await db.cptRattachement.findMany({
    where: { id: { in: [...new Set(rattachementIds)] }, statut: "VALIDE" },
    orderBy: [{ valideAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      montant: true,
      encaissementId: true,
      echeanceId: true,
      encaissement: { select: { dateValeur: true } },
      echeance: {
        select: {
          montantDu: true,
          taxe: true,
          accessoires: true,
          contrat: { select: { id: true, tauxTcaContrat: true, natureContrat: true, produit: { select: { code: true, branche: true } } } },
        },
      },
    },
  });

  for (const r of rattachements) {
    const deja = await db.cptLigneTaxe.findFirst({ where: { rattachementId: r.id, origine: "RATTACHEMENT" }, select: { id: true } });
    if (deja) {
      bilan.dejaTaxes++;
      continue;
    }
    const contrat = r.echeance.contrat;
    const dateValeur = jour(r.encaissement.dateValeur);
    const taux = tauxApplicableCpt(referentiel, {
      branche: contrat.produit.branche as BrancheCpt,
      produitCode: contrat.produit.code,
      natureContrat: contrat.natureContrat as NatureContratCpt,
      date: dateValeur,
      tauxContrat: contrat.tauxTcaContrat ? contrat.tauxTcaContrat.toFixed(6) : null,
    });

    const [lignesEcheance, avance, imputees] = await Promise.all([
      db.cptLigneTaxe.aggregate({ where: { echeanceId: r.echeanceId, origine: "RATTACHEMENT" }, _sum: { base: true, montant: true, accessoiresHt: true } }),
      db.cptLigneTaxe.findFirst({ where: { encaissementId: r.encaissementId, origine: "AVANCE" } }),
      db.cptLigneTaxe.findMany({ where: { origine: "IMPUTATION", ligneAvance: { encaissementId: r.encaissementId } }, select: { base: true, montant: true, primeHt: true } }),
    ]);
    let avancePlan: (AvanceTaxeCpt & { id: string; taux: string }) | null = null;
    if (avance) {
      avancePlan = {
        id: avance.id,
        taux: avance.taux.toFixed(6),
        base: centimes(avance.base),
        taxe: centimes(avance.montant),
        primeHt: centimes(avance.primeHt),
        baseDejaImputee: imputees.reduce((s, l) => s - centimes(l.base), ZERO),
        taxeDejaImputee: imputees.reduce((s, l) => s - centimes(l.montant), ZERO),
        primeHtDejaImputee: imputees.reduce((s, l) => s - centimes(l.primeHt), ZERO),
      };
    }

    const plan = planifierTaxeRattachementCpt({
      echeance: { montantDu: centimes(r.echeance.montantDu), taxe: centimes(r.echeance.taxe), accessoires: centimes(r.echeance.accessoires) },
      rattachement: {
        montant: centimes(r.montant),
        dejaValideSurEcheance: centimes(lignesEcheance._sum.base),
        taxeDejaAttribuee: centimes(lignesEcheance._sum.montant),
        accessoiresDejaAttribues: centimes(lignesEcheance._sum.accessoiresHt),
      },
      taux: taux?.taux ?? null,
      avance: avancePlan,
    });
    if (!plan.ok) {
      bilan.sansTaux.push(r.id);
      continue;
    }

    const mois = moisImputationLigneCpt(dateValeur, dernierMois);
    for (const l of plan.lignes) {
      const creee = await db.cptLigneTaxe.create({
        data: {
          origine: l.origine,
          moisDeclaration: new Date(`${mois}T00:00:00.000Z`),
          encaissementId: r.encaissementId,
          rattachementId: r.id,
          echeanceId: l.origine === "RATTACHEMENT" ? r.echeanceId : null,
          imputeeSurEcheanceId: l.origine === "IMPUTATION" ? r.echeanceId : null,
          ligneAvanceId: l.ligneAvanceId ?? null,
          contratId: contrat.id,
          produitCode: contrat.produit.code,
          branche: contrat.produit.branche,
          base: texte(l.base),
          primeHt: texte(l.primeHt),
          accessoiresHt: texte(l.accessoiresHt),
          taux: l.taux,
          montant: texte(l.taxe),
          creeParId: p.userId,
        },
        select: { id: true },
      });
      bilan.lignesCreees++;
      await ecrireAudit(db, {
        entite: "CptLigneTaxe",
        entiteId: creee.id,
        action: l.origine === "RATTACHEMENT" ? "taxe_rattachement" : "imputation_avance",
        apres: { rattachementId: r.id, mois, base: texte(l.base), taux: l.taux, taxe: texte(l.taxe), source: taux?.source ?? null },
        mois: new Date(`${mois}T00:00:00.000Z`),
        userId: p.userId,
        ip: p.ip,
      });
    }
  }
  return bilan;
}

/** Rattachements VALIDÉS sans ligne de taxe (taux manquant à leur validation) : à rejouer une fois le taux saisi. */
export async function rattraperTaxesManquantesCpt(db: CptTaxeDb, p: ParametresTaxeCpt, limite = 500): Promise<BilanTaxeRattachementCpt> {
  const ids = await db.cptRattachement.findMany({
    where: { statut: "VALIDE", lignesTaxe: { none: { origine: "RATTACHEMENT" } } },
    orderBy: [{ valideAt: "asc" }, { id: "asc" }],
    take: limite,
    select: { id: true },
  });
  return appliquerTaxeRattachementsCpt(db, ids.map((i) => i.id), p);
}

export type ResultatAvanceDbCpt = { ok: true; ligneId: string; taxe: string; taux: string; mois: string } | { ok: false; message: string };

export const MESSAGE_TAUX_MANQUANT_CPT = "Aucun taux de TCA ne s'applique : saisissez-le dans les référentiels (ou sur le contrat) ; aucune taxe n'est calculée sans taux.";

/**
 * Avance de taxe sur un encaissement non (entièrement) rattaché dont on connaît le contrat OU le produit (cas 2 et 3). Base = montant
 * moins la part « pas une prime » moins ce qui est déjà rattaché et validé (déjà taxé par ses propres lignes).
 */
export async function taxerEncaissementCpt(
  db: CptTaxeDb,
  e: { encaissementId: string; contratId?: string | null; produitCode?: string | null; natureContrat?: NatureContratCpt | null },
  p: ParametresTaxeCpt,
): Promise<ResultatAvanceDbCpt> {
  if (!e.contratId === !e.produitCode) return { ok: false, message: "Indiquez le contrat OU le produit de l'encaissement." };
  await verrouillerTaxeCpt(db);
  await db.$queryRaw`SELECT "id" FROM "CptEncaissement" WHERE "id" = ${e.encaissementId} FOR UPDATE`;
  const enc = await db.cptEncaissement.findUnique({ where: { id: e.encaissementId }, select: { id: true, montant: true, montantPasUnePrime: true, dateValeur: true, typeFlux: true } });
  if (!enc) return { ok: false, message: "Encaissement introuvable." };
  if (enc.typeFlux !== "ENCAISSEMENT") return { ok: false, message: "Seul un encaissement (crédit) peut être taxé." };
  if (await db.cptLigneTaxe.findFirst({ where: { encaissementId: enc.id, origine: "AVANCE" }, select: { id: true } })) {
    return { ok: false, message: "La taxe de cet encaissement a déjà été calculée." };
  }
  const valide = await db.cptRattachement.aggregate({ where: { encaissementId: enc.id, statut: "VALIDE" }, _sum: { montant: true } });
  const base = baseAvanceCpt(centimes(enc.montant), centimes(enc.montantPasUnePrime)) - centimes(valide._sum.montant);

  let branche: BrancheCpt;
  let produitCode: string;
  let natureContrat: NatureContratCpt | null;
  let tauxContrat: string | null = null;
  let contratId: string | null = null;
  if (e.contratId) {
    const c = await db.cptContrat.findUnique({ where: { id: e.contratId }, select: { id: true, natureContrat: true, tauxTcaContrat: true, produit: { select: { code: true, branche: true } } } });
    if (!c) return { ok: false, message: "Contrat introuvable." };
    branche = c.produit.branche as BrancheCpt;
    produitCode = c.produit.code;
    natureContrat = c.natureContrat as NatureContratCpt;
    tauxContrat = c.tauxTcaContrat ? c.tauxTcaContrat.toFixed(6) : null;
    contratId = c.id;
  } else {
    const produit = await db.cptProduit.findUnique({ where: { code: e.produitCode ?? "" }, select: { code: true, branche: true } });
    if (!produit) return { ok: false, message: "Produit introuvable." };
    branche = produit.branche as BrancheCpt;
    produitCode = produit.code;
    natureContrat = e.natureContrat ?? null;
  }
  const dateValeur = jour(enc.dateValeur);
  const taux = tauxApplicableCpt(await chargerTauxTcaCpt(db), { branche, produitCode, natureContrat, date: dateValeur, tauxContrat });
  const calcul = calculerAvanceCpt(base, taux?.taux ?? null);
  if (!calcul.ok) return { ok: false, message: calcul.motif === "TAUX_MANQUANT" ? MESSAGE_TAUX_MANQUANT_CPT : "Rien à taxer : tout le montant est déjà rattaché ou classé « pas une prime »." };

  const mois = moisImputationLigneCpt(dateValeur, await dernierMoisDeclareCpt(db));
  const creee = await db.cptLigneTaxe.create({
    data: {
      origine: "AVANCE",
      moisDeclaration: new Date(`${mois}T00:00:00.000Z`),
      encaissementId: enc.id,
      contratId,
      produitCode,
      branche,
      base: texte(calcul.ligne.base),
      primeHt: texte(calcul.ligne.primeHt),
      accessoiresHt: texte(calcul.ligne.accessoiresHt),
      taux: calcul.taux,
      montant: texte(calcul.ligne.taxe),
      creeParId: p.userId,
    },
    select: { id: true },
  });
  await ecrireAudit(db, {
    entite: "CptLigneTaxe",
    entiteId: creee.id,
    action: "taxe_avance",
    apres: { encaissementId: enc.id, produitCode, contratId, mois, base: texte(calcul.ligne.base), taux: calcul.taux, taxe: texte(calcul.ligne.taxe), source: taux?.source ?? null },
    mois: new Date(`${mois}T00:00:00.000Z`),
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, ligneId: creee.id, taxe: texte(calcul.ligne.taxe), taux: calcul.taux, mois };
}
