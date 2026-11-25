import type { Prisma } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";
import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import {
  cleSequenceAnnuelle,
  prochainNumero,
} from "./cptSequence";
import type { BrancheCpt, NatureContratCpt, TauxTcaLigne } from "./cptReferentiels";
import {
  baseAvanceCpt,
  calculerAvanceCpt,
  anneeDeclarationCpt,
  calculerMoisTcaCpt,
  etatParTauxCpt,
  ligneSuiviTaxeCpt,
  moisSuivantCpt,
  tropPayeAuPaiementCpt,
  validerPaiementTcaCpt,
  type SaisiePaiementTcaCpt,
  refusDeclarationMoisCpt,
  type CalculMoisTcaCpt,
  type EtatParTauxCpt,
  type LigneSuiviTaxeCpt,
  type SuiviTaxeContratEntreeCpt,
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
/** Decimal (signé) → centimes. `enCentimesEcheancier` n'accepte que des montants positifs : le signe est traité ici (une imputation est négative). */
const centimes = (d: { toFixed(n: number): string } | null | undefined): bigint => {
  if (!d) return ZERO;
  const t = d.toFixed(2);
  const negatif = t.startsWith("-");
  const c = enCentimesEcheancier(negatif ? t.slice(1) : t) ?? ZERO;
  return negatif ? -c : c;
};
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

// ---------------------------------------------------------------------------------------------------------------------
// Calcul du mois (GC-8c) — lecture seule
// ---------------------------------------------------------------------------------------------------------------------

const dateMois = (mois: string) => new Date(`${mois}T00:00:00.000Z`);

/** Rattachements VALIDÉS dont la taxe manque faute de taux (aucune ligne RATTACHEMENT), valorisés au plus tard le mois indiqué. */
export function rattachementsSansTauxWhere(moisMax?: string): Prisma.CptRattachementWhereInput {
  return {
    statut: "VALIDE",
    lignesTaxe: { none: { origine: "RATTACHEMENT" } },
    ...(moisMax ? { encaissement: { dateValeur: { lt: dateMois(moisSuivantCpt(moisMax)) } } } : {}),
  };
}

export interface EtatCalculMoisCpt {
  calcul: CalculMoisTcaCpt;
  /** Motif pour lequel le mois ne peut pas être déclaré (ou `null`). */
  refus: string | null;
  dernierMoisDeclare: string | null;
  declaration: { id: string; reference: string; statut: "DECLAREE" | "PAYEE" } | null;
  nbTauxManquants: number;
}

/**
 * Calcul du mois : taxe due cumulée (lignes des mois ≤ mois) − taxe déjà payée (déclarations antérieures, quittance si payée) ; un
 * négatif devient un crédit reporté. Lecture seule, la même fonction sert l'écran et la déclaration (aucun second calcul).
 */
export async function chargerCalculMoisCpt(db: CptTaxeDb, mois: string, maintenant: Date = new Date()): Promise<EtatCalculMoisCpt> {
  const dateM = dateMois(mois);
  const [cumul, imputations, nbLignesDuMois, anterieures, credits, dernier, mensNonDeclares, nbTauxManquants, declaration] = await Promise.all([
    db.cptLigneTaxe.aggregate({ where: { moisDeclaration: { lte: dateM } }, _sum: { montant: true } }),
    db.cptLigneTaxe.aggregate({ where: { moisDeclaration: { lte: dateM }, origine: "IMPUTATION" }, _sum: { montant: true } }),
    db.cptLigneTaxe.count({ where: { moisDeclaration: dateM } }),
    db.cptDeclarationTca.findMany({ where: { mois: { lt: dateM } }, orderBy: { mois: "asc" }, select: { mois: true, montantAPayer: true, quittanceMontant: true } }),
    db.cptCreditTaxe.findMany({ where: { statut: "A_RECUPERER" }, select: { id: true, montant: true } }),
    dernierMoisDeclareCpt(db),
    db.cptLigneTaxe.groupBy({ by: ["moisDeclaration"], where: { declarationId: null } }),
    db.cptRattachement.count({ where: rattachementsSansTauxWhere(mois) }),
    db.cptDeclarationTca.findUnique({ where: { mois: dateM }, select: { id: true, reference: true, statut: true } }),
  ]);
  const calcul = calculerMoisTcaCpt({
    mois,
    montantDuCumule: centimes(cumul._sum.montant),
    corrections: centimes(imputations._sum.montant),
    nbLignesDuMois,
    anterieures: anterieures.map((d) => ({ mois: jour(d.mois), montantAPayer: centimes(d.montantAPayer), quittanceMontant: d.quittanceMontant ? centimes(d.quittanceMontant) : null })),
    creditsOuverts: credits.map((c) => ({ id: c.id, montant: centimes(c.montant) })),
  });
  const refus = declaration
    ? "Ce mois est déjà déclaré."
    : refusDeclarationMoisCpt({
        mois,
        moisCourant: `${maintenant.toISOString().slice(0, 7)}-01`,
        dernierMoisDeclare: dernier,
        moisAvecLignesNonDeclarees: mensNonDeclares.map((m) => jour(m.moisDeclaration)),
        nbTauxManquants,
      });
  return { calcul, refus, dernierMoisDeclare: dernier, declaration, nbTauxManquants };
}

export interface RattachementSansTauxCpt {
  rattachementId: string;
  montant: string;
  dateValeur: string;
  numPolice: string;
  produit: string;
  encaissementReference: string;
}

/** Liste « taux manquant » : rattachements validés sans ligne de taxe, du plus ancien au plus récent. */
export async function listerTauxManquantsCpt(db: CptTaxeDb, limite = 100): Promise<{ total: number; lignes: RattachementSansTauxCpt[] }> {
  const where = rattachementsSansTauxWhere();
  const [total, lignes] = await Promise.all([
    db.cptRattachement.count({ where }),
    db.cptRattachement.findMany({
      where,
      orderBy: [{ valideAt: "asc" }, { id: "asc" }],
      take: limite,
      select: {
        id: true,
        montant: true,
        encaissement: { select: { dateValeur: true, reference: true } },
        echeance: { select: { contrat: { select: { numPolice: true, produit: { select: { code: true } } } } } },
      },
    }),
  ]);
  return {
    total,
    lignes: lignes.map((l) => ({
      rattachementId: l.id,
      montant: l.montant.toFixed(2),
      dateValeur: jour(l.encaissement.dateValeur),
      numPolice: l.echeance.contrat.numPolice,
      produit: l.echeance.contrat.produit.code,
      encaissementReference: l.encaissement.reference,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Déclaration, quittance et verrouillage (GC-8d)
// ---------------------------------------------------------------------------------------------------------------------

export type ResultatDeclarationCpt =
  | { ok: true; declarationId: string; reference: string; montantAPayer: string; credit: string; nbLignes: number }
  | { ok: false; message: string };

/**
 * Déclare un mois : fige le calcul (`chargerCalculMoisCpt`, la même fonction que l'écran), affecte TOUTES les lignes non déclarées du
 * mois et antérieures — elles sont verrouillées par trigger —, crée la déclaration `CPD-AAAA-NN` et traite les crédits (les crédits
 * ouverts sont récupérés ici, un nouveau crédit porte le trop-payé éventuel). Sous le verrou `cpt:tca` : deux déclarations simultanées
 * du même mois, une seule passe (la seconde lit la déclaration existante, et l'unicité du mois le garantit aussi en base).
 */
export async function declarerMoisTcaCpt(db: CptTaxeDb, e: { mois: string }, p: ParametresTaxeCpt): Promise<ResultatDeclarationCpt> {
  const maintenant = p.maintenant ?? new Date();
  await verrouillerTaxeCpt(db);
  const etat = await chargerCalculMoisCpt(db, e.mois, maintenant);
  if (etat.refus) return { ok: false, message: etat.refus };
  const c = etat.calcul;
  const aAffecter = { declarationId: null, moisDeclaration: { lte: dateMois(e.mois) } };
  const nbLignes = await db.cptLigneTaxe.count({ where: aAffecter });
  const reference = await prochainNumero(db, cleSequenceAnnuelle("CPD", anneeDeclarationCpt(e.mois)));
  const declaration = await db.cptDeclarationTca.create({
    data: {
      reference,
      mois: dateMois(e.mois),
      montantDu: texte(c.montantDu),
      montantDejaPaye: texte(c.montantDejaPaye),
      corrections: texte(c.corrections),
      montantAPayer: texte(c.montantAPayer),
      nbLignes,
      declareParId: p.userId,
    },
    select: { id: true },
  });
  const affectees = await db.cptLigneTaxe.updateMany({ where: aAffecter, data: { declarationId: declaration.id } });
  if (affectees.count !== nbLignes) throw new Error("La taxe du mois a changé pendant la déclaration : recommencez.");
  // Crédits : ceux qui attendaient sont absorbés par ce mois ; le trop-payé éventuel de ce mois devient le crédit à reporter.
  if (c.creditsRecuperes.length > 0) {
    await db.cptCreditTaxe.updateMany({ where: { id: { in: c.creditsRecuperes }, statut: "A_RECUPERER" }, data: { statut: "RECUPERE", recupereDansId: declaration.id, recupereAt: maintenant } });
  }
  if (c.credit > ZERO) {
    await db.cptCreditTaxe.create({ data: { origine: "TROP_PAYE", declarationId: declaration.id, montant: texte(c.credit) } });
  }
  await ecrireAudit(db, {
    entite: "CptDeclarationTca",
    entiteId: declaration.id,
    action: "declaration",
    apres: { reference, mois: e.mois, montantDu: texte(c.montantDu), montantDejaPaye: texte(c.montantDejaPaye), montantAPayer: texte(c.montantAPayer), credit: texte(c.credit), nbLignes },
    mois: dateMois(e.mois),
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, declarationId: declaration.id, reference, montantAPayer: texte(c.montantAPayer), credit: texte(c.credit), nbLignes };
}

export type ResultatPaiementTcaCpt = { ok: true; reference: string; tropPaye: string } | { ok: false; message: string; erreurs?: Record<string, string> };

/**
 * Enregistre le paiement et la quittance d'une déclaration (DECLAREE → PAYEE, une seule fois). Une quittance supérieure au montant déclaré
 * crée un crédit (trop-payé) ; inférieure, le manque se retrouve au calcul du mois suivant (le cumul compte ce qui a réellement été payé).
 */
export async function enregistrerPaiementTcaCpt(db: CptTaxeDb, e: { declarationId: string; saisie: SaisiePaiementTcaCpt }, p: ParametresTaxeCpt): Promise<ResultatPaiementTcaCpt> {
  const maintenant = p.maintenant ?? new Date();
  const valide = validerPaiementTcaCpt(e.saisie, jour(maintenant));
  if (!valide.ok) return { ok: false, message: "Saisie invalide.", erreurs: valide.erreurs };
  await verrouillerTaxeCpt(db);
  const d = await db.cptDeclarationTca.findUnique({ where: { id: e.declarationId }, select: { id: true, reference: true, mois: true, statut: true, montantAPayer: true } });
  if (!d) return { ok: false, message: "Déclaration introuvable." };
  if (d.statut !== "DECLAREE") return { ok: false, message: "Cette déclaration est déjà payée." };
  const v = valide.valeur;
  const maj = await db.cptDeclarationTca.updateMany({
    where: { id: d.id, statut: "DECLAREE" },
    data: {
      statut: "PAYEE",
      quittanceNumero: v.quittanceNumero,
      quittanceDate: new Date(`${v.quittanceDate}T00:00:00.000Z`),
      quittanceMontant: texte(v.quittanceMontant),
      datePaiement: new Date(`${v.datePaiement}T00:00:00.000Z`),
      pieceOdoo: v.pieceOdoo,
      payeParId: p.userId,
      payeAt: maintenant,
    },
  });
  if (maj.count !== 1) return { ok: false, message: "Cette déclaration vient d'être payée par quelqu'un d'autre." };
  const trop = tropPayeAuPaiementCpt(centimes(d.montantAPayer), v.quittanceMontant);
  if (trop > ZERO) await db.cptCreditTaxe.create({ data: { origine: "TROP_PAYE", declarationId: d.id, montant: texte(trop) } });
  await ecrireAudit(db, {
    entite: "CptDeclarationTca",
    entiteId: d.id,
    action: "paiement",
    avant: { statut: "DECLAREE", montantAPayer: texte(centimes(d.montantAPayer)) },
    apres: { statut: "PAYEE", quittanceNumero: v.quittanceNumero, quittanceDate: v.quittanceDate, quittanceMontant: texte(v.quittanceMontant), datePaiement: v.datePaiement, pieceOdoo: v.pieceOdoo, tropPaye: texte(trop) },
    mois: d.mois,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, reference: d.reference, tropPaye: texte(trop) };
}

// ---------------------------------------------------------------------------------------------------------------------
// État par taux (GC-8e) — lecture seule
// ---------------------------------------------------------------------------------------------------------------------

export interface EtatParTauxMoisCpt {
  mois: string;
  etat: EtatParTauxCpt;
  declaration: { reference: string; statut: "DECLAREE" | "PAYEE"; montantAPayer: string } | null;
  /** Crédits à part : trop-payés nés de la déclaration du mois, et total des crédits encore à récupérer. */
  creditsDuMois: bigint;
  creditsAReporter: bigint;
}

/** Lignes de taxe d'un mois (celles que sa déclaration verrouille), regroupées par taux : la source de l'écran ET de l'export. */
export async function lireLignesEtatTauxCpt(db: CptTaxeDb, mois: string) {
  const lignes = await db.cptLigneTaxe.findMany({ where: { moisDeclaration: dateMois(mois) }, select: { taux: true, base: true, primeHt: true, accessoiresHt: true, montant: true } });
  return lignes.map((l) => ({ taux: l.taux.toFixed(6), base: centimes(l.base), primeHt: centimes(l.primeHt), accessoiresHt: centimes(l.accessoiresHt), montant: centimes(l.montant) }));
}

export async function chargerEtatParTauxCpt(db: CptTaxeDb, mois: string): Promise<EtatParTauxMoisCpt> {
  const [lignes, declaration, creditsMois, creditsOuverts] = await Promise.all([
    lireLignesEtatTauxCpt(db, mois),
    db.cptDeclarationTca.findUnique({ where: { mois: dateMois(mois) }, select: { id: true, reference: true, statut: true, montantAPayer: true } }),
    db.cptCreditTaxe.aggregate({ where: { declaration: { mois: dateMois(mois) } }, _sum: { montant: true } }),
    db.cptCreditTaxe.aggregate({ where: { statut: "A_RECUPERER" }, _sum: { montant: true } }),
  ]);
  return {
    mois,
    etat: etatParTauxCpt(lignes),
    declaration: declaration ? { reference: declaration.reference, statut: declaration.statut, montantAPayer: declaration.montantAPayer.toFixed(2) } : null,
    creditsDuMois: centimes(creditsMois._sum.montant),
    creditsAReporter: centimes(creditsOuverts._sum.montant),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Suivi par contrat et par mois, taxe payée d'avance (GC-8f) — lecture seule
// ---------------------------------------------------------------------------------------------------------------------

export const TAILLE_PAGE_SUIVI_TAXE_CPT = 50;

export interface LigneSuiviContratCpt extends LigneSuiviTaxeCpt {
  numPolice: string;
  clientNom: string;
}

/**
 * Suivi par contrat pour un mois : taxe émise (échéances du mois), exigible (rattachements validés du mois), payée d'avance et imputée,
 * déclarée, payée. Trois requêtes groupées ; la recherche par numéro de police et la pagination se font sur les contrats concernés.
 */
export async function chargerSuiviTaxeCpt(db: CptTaxeDb, p: { mois: string; q?: string; page?: number }): Promise<{ total: number; page: number; nbPages: number; lignes: LigneSuiviContratCpt[] }> {
  const debut = dateMois(p.mois);
  const fin = dateMois(moisSuivantCpt(p.mois));
  const [emises, taxees] = await Promise.all([
    db.$queryRaw<{ contratId: string; emise: string }[]>`
      SELECT "contratId", sum("taxe")::text AS emise FROM "CptEcheance"
      WHERE "datePrevue" >= ${debut} AND "datePrevue" < ${fin} AND "etat" <> 'ANNULEE' GROUP BY "contratId"`,
    db.$queryRaw<{ contratId: string; exigible: string; imputee: string; declaree: string; payee: string }[]>`
      SELECT l."contratId",
        coalesce(sum(CASE WHEN l."origine" = 'RATTACHEMENT' THEN l."montant" ELSE 0 END), 0)::text AS exigible,
        coalesce(sum(CASE WHEN l."origine" = 'IMPUTATION' THEN -l."montant" ELSE 0 END), 0)::text AS imputee,
        coalesce(sum(CASE WHEN l."declarationId" IS NOT NULL THEN l."montant" ELSE 0 END), 0)::text AS declaree,
        coalesce(sum(CASE WHEN d."statut" = 'PAYEE' THEN l."montant" ELSE 0 END), 0)::text AS payee
      FROM "CptLigneTaxe" l LEFT JOIN "CptDeclarationTca" d ON d."id" = l."declarationId"
      WHERE l."moisDeclaration" = ${debut} AND l."contratId" IS NOT NULL GROUP BY l."contratId"`,
  ]);
  const parContrat = new Map<string, SuiviTaxeContratEntreeCpt>();
  const entree = (id: string) => parContrat.get(id) ?? { contratId: id, taxeEmise: ZERO, taxeExigible: ZERO, taxeImputee: ZERO, taxeDeclaree: ZERO, taxePayee: ZERO };
  for (const e of emises) parContrat.set(e.contratId, { ...entree(e.contratId), taxeEmise: centimes({ toFixed: () => Number(e.emise).toFixed(2) }) });
  for (const t of taxees) {
    const c = (v: string) => centimes({ toFixed: () => Number(v).toFixed(2) });
    parContrat.set(t.contratId, { ...entree(t.contratId), taxeExigible: c(t.exigible), taxeImputee: c(t.imputee), taxeDeclaree: c(t.declaree), taxePayee: c(t.payee) });
  }
  const ids = [...parContrat.keys()];
  const q = (p.q ?? "").trim();
  const contrats = ids.length === 0 ? [] : await db.cptContrat.findMany({ where: { id: { in: ids }, ...(q ? { numPolice: { contains: q, mode: "insensitive" } } : {}) }, select: { id: true, numPolice: true, client: { select: { nom: true } } }, orderBy: { numPolice: "asc" } });
  const total = contrats.length;
  const nbPages = Math.max(1, Math.ceil(total / TAILLE_PAGE_SUIVI_TAXE_CPT));
  const page = Math.min(Math.max(1, p.page ?? 1), nbPages);
  const lignes = contrats.slice((page - 1) * TAILLE_PAGE_SUIVI_TAXE_CPT, page * TAILLE_PAGE_SUIVI_TAXE_CPT).map((c) => ({ ...ligneSuiviTaxeCpt(parContrat.get(c.id)!), numPolice: c.numPolice, clientNom: c.client.nom }));
  return { total, page, nbPages, lignes };
}

export interface AvancesNonImputeesCpt {
  /** Taxe déclarée au titre d'une avance et pas encore (entièrement) imputée sur un rattachement. */
  montant: bigint;
  nbAvances: number;
}

/** « Taxe payée d'avance non encore imputée » : avances DÉCLARÉES moins ce que les rattachements en ont déjà annulé (imputations). */
export async function chargerAvancesNonImputeesCpt(db: CptTaxeDb): Promise<AvancesNonImputeesCpt> {
  const lignes = await db.$queryRaw<{ restant: string; nb: number }[]>`
    SELECT coalesce(sum(a."montant" - coalesce(i."imputee", 0)), 0)::text AS restant,
           count(*) FILTER (WHERE a."montant" - coalesce(i."imputee", 0) > 0)::int AS nb
    FROM "CptLigneTaxe" a
    LEFT JOIN (SELECT "ligneAvanceId", sum(-"montant") AS imputee FROM "CptLigneTaxe" WHERE "origine" = 'IMPUTATION' GROUP BY "ligneAvanceId") i ON i."ligneAvanceId" = a."id"
    WHERE a."origine" = 'AVANCE' AND a."declarationId" IS NOT NULL`;
  const l = lignes[0];
  return { montant: centimes({ toFixed: () => Number(l?.restant ?? 0).toFixed(2) }), nbAvances: Number(l?.nb ?? 0) };
}
