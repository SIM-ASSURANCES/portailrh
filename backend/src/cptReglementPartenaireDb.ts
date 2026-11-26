import type { Prisma } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";
import { texteDepuisCentimes } from "./cptEcheancier";
import { cleSequenceAnnuelle, prochainNumero } from "./cptSequence";
import type { ModeReglementCpt, NatureRemunerationCpt } from "./cptReferentiels";
import { MODES_REGLEMENT_CPT, NATURES_REMUNERATION_CPT } from "./cptReferentiels";
import type { LigneRemunerationCalculeeCpt } from "./cptRemuneration";
import { chargerRemunerationPartenaireCpt } from "./cptRemunerationDb";
import { lireMotifRemunerationCpt, planifierReglementCpt, validerSaisieReglementCpt } from "./cptReglementPartenaire";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Écritures de la rémunération (lot GC-9e), toujours dans la transaction de l'appelant. Un verrou par partenaire
 * (`cpt:remuneration:<id>`) sérialise règlements, décisions et compensations : le calcul est refait SOUS le verrou, aucun montant ne
 * peut être affecté deux fois. La base rejoue les contrôles (Σ affectations = montant, payé d'une ligne ≤ dû).
 * Signature manuscrite (D5) non branchée : tout est tracé dans `CptAudit`.
 */
export type RemunerationEcritureDbCpt = Prisma.TransactionClient;

export interface ParametresRemunerationCpt {
  userId: string;
  ip?: string | null;
  maintenant?: Date;
}

export async function verrouillerRemunerationCpt(db: RemunerationEcritureDbCpt, partenaireId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpt:remuneration:' || ${partenaireId}))`;
}

const dateUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Une période clôturée refuse toute écriture datée dans son mois (RG-08). */
export async function moisCloturePourCpt(db: RemunerationEcritureDbCpt, date: string): Promise<boolean> {
  const cloture = await db.cptPeriode.findFirst({ where: { mois: dateUtc(`${date.slice(0, 7)}-01`), statut: "CLOTUREE" }, select: { mois: true } });
  return cloture !== null;
}

/**
 * Enregistre (une fois pour toutes) les lignes des couples (contrat, bénéficiaire, nature) touchés : TOUTES les échéances du couple
 * avec la même convention, pour que le dû figé garde le reliquat exact. Renvoie l'identifiant de chaque clé.
 */
export async function enregistrerLignesRemunerationCpt(
  db: RemunerationEcritureDbCpt,
  lignes: readonly LigneRemunerationCalculeeCpt[],
  cles: ReadonlySet<string>,
  p: ParametresRemunerationCpt,
): Promise<Map<string, string>> {
  const touches = new Set(lignes.filter((l) => cles.has(l.cle)).map((l) => `${l.contratId}|${l.beneficiaireId}|${l.nature}`));
  const concernees = lignes.filter((l) => touches.has(`${l.contratId}|${l.beneficiaireId}|${l.nature}`));
  const nouvelles = concernees.filter((l) => l.ligneId === null);
  if (nouvelles.length > 0) {
    await db.cptLigneRemuneration.createMany({
      data: nouvelles.map((l) => ({
        contratId: l.contratId,
        echeanceId: l.echeanceId,
        partenaireBeneficiaireId: l.beneficiaireId,
        nature: l.nature,
        conventionId: l.conventionId,
        du: texteDepuisCentimes(l.duInitial),
        creeParId: p.userId,
      })),
    });
  }
  const enBase = await db.cptLigneRemuneration.findMany({
    where: { OR: concernees.map((l) => ({ contratId: l.contratId, echeanceId: l.echeanceId, partenaireBeneficiaireId: l.beneficiaireId, nature: l.nature })) },
    select: { id: true, contratId: true, echeanceId: true, partenaireBeneficiaireId: true, nature: true },
  });
  return new Map(enBase.map((l) => [`${l.contratId}|${l.echeanceId}|${l.partenaireBeneficiaireId}|${l.nature}`, l.id]));
}

export type ResultatReglementPartenaireCpt =
  | { ok: true; reference: string; reglementId: string; montantAvance: string; nbAffectations: number }
  | { ok: false; message: string; erreurs?: Record<string, string> };

export async function enregistrerReglementPartenaireCpt(
  db: RemunerationEcritureDbCpt,
  saisie: Record<string, unknown>,
  p: ParametresRemunerationCpt,
): Promise<ResultatReglementPartenaireCpt> {
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const v = validerSaisieReglementCpt(saisie, aujourdhui);
  if (!v.ok) return { ok: false, message: Object.values(v.erreurs)[0], erreurs: v.erreurs };
  const s = v.valeur;
  await verrouillerRemunerationCpt(db, s.partenaireId);
  if (await moisCloturePourCpt(db, s.date)) return { ok: false, message: "Le mois de cette date est clôturé : aucune écriture ne peut y être datée.", erreurs: { date: "Mois clôturé." } };
  const r = await chargerRemunerationPartenaireCpt(db, s.partenaireId, aujourdhui);
  if (!r) return { ok: false, message: "Partenaire introuvable." };
  const lignes = r.lignes.filter((l) => l.nature === s.nature);
  const plan = planifierReglementCpt(lignes, s.montant, { accepterAvance: s.accepterAvance, modeDerogation: s.modeDerogation });
  if (!plan.ok) return { ok: false, message: plan.message, erreurs: { montant: plan.message } };
  if (plan.montantAvance > BigInt(0)) {
    const m = lireMotifRemunerationCpt(s.motif);
    if (!m.ok) return { ok: false, message: `Avance : ${m.message}`, erreurs: { motif: m.message } };
  }

  const ids = await enregistrerLignesRemunerationCpt(db, lignes, new Set(plan.parts.map((x) => x.cle)), p);
  const reference = await prochainNumero(db, cleSequenceAnnuelle("CPR", Number(s.date.slice(0, 4))));
  const reglement = await db.cptReglementPartenaire.create({
    data: {
      reference,
      partenaireId: s.partenaireId,
      nature: s.nature,
      montant: texteDepuisCentimes(s.montant),
      date: dateUtc(s.date),
      mode: s.mode,
      referenceReglement: s.referenceReglement,
      pieceOdoo: s.pieceOdoo,
      modeDerogation: s.modeDerogation,
      montantAvance: texteDepuisCentimes(plan.montantAvance),
      motif: s.motif,
      creeParId: p.userId,
    },
    select: { id: true },
  });
  await db.cptAffectationReglement.createMany({
    data: plan.parts.map((x) => ({ reglementId: reglement.id, ligneRemunerationId: ids.get(x.cle)!, montant: texteDepuisCentimes(x.montant) })),
  });
  await ecrireAudit(db, {
    entite: "CptReglementPartenaire",
    entiteId: reglement.id,
    action: "reglement_partenaire",
    apres: {
      reference,
      partenaire: r.partenaire.nom,
      nature: s.nature,
      montant: texteDepuisCentimes(s.montant),
      date: s.date,
      mode: s.mode,
      referenceReglement: s.referenceReglement,
      modeDerogation: s.modeDerogation,
      montantAvance: texteDepuisCentimes(plan.montantAvance),
      affectations: plan.parts.map((x) => ({ police: x.numPolice, echeance: x.rang, montant: texteDepuisCentimes(x.montant) })),
    },
    motif: s.motif,
    mois: dateUtc(s.date),
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, reference, reglementId: reglement.id, montantAvance: texteDepuisCentimes(plan.montantAvance), nbAffectations: plan.parts.length };
}

export type ResultatDecisionModeCpt = { ok: true } | { ok: false; message: string };

/** Décision du RFCRH « en une fois / au prorata » sur un contrat, pour un bénéficiaire et une nature, avec motif. Ajout seul. */
export async function deciderModeRemunerationCpt(
  db: RemunerationEcritureDbCpt,
  saisie: { partenaireId: unknown; contratId: unknown; nature: unknown; mode: unknown; motif: unknown },
  p: ParametresRemunerationCpt,
): Promise<ResultatDecisionModeCpt> {
  const partenaireId = String(saisie.partenaireId ?? "");
  const contratId = String(saisie.contratId ?? "");
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === saisie.nature) as NatureRemunerationCpt | undefined;
  const mode = MODES_REGLEMENT_CPT.find((m) => m === saisie.mode) as ModeReglementCpt | undefined;
  if (!partenaireId || !contratId || !nature || !mode) return { ok: false, message: "Choisissez le contrat, la nature et le mode de règlement." };
  const motif = lireMotifRemunerationCpt(saisie.motif);
  if (!motif.ok) return motif;
  await verrouillerRemunerationCpt(db, partenaireId);
  const maintenant = p.maintenant ?? new Date();
  const r = await chargerRemunerationPartenaireCpt(db, partenaireId, maintenant.toISOString().slice(0, 10));
  const ligne = r?.lignes.find((l) => l.contratId === contratId && l.nature === nature);
  if (!r || !ligne) return { ok: false, message: "Ce partenaire n'a aucune rémunération de cette nature sur ce contrat." };
  if (ligne.mode === mode) return { ok: false, message: "Ce contrat suit déjà ce mode de règlement." };
  const decision = await db.cptDecisionModeRemuneration.create({
    data: { contratId, partenaireId, nature, mode, motif: motif.motif, creeParId: p.userId, creeAt: maintenant },
    select: { id: true },
  });
  await ecrireAudit(db, {
    entite: "CptDecisionModeRemuneration",
    entiteId: decision.id,
    action: "decision_mode_remuneration",
    avant: { mode: ligne.mode },
    apres: { partenaire: r.partenaire.nom, police: ligne.numPolice, nature, mode },
    motif: motif.motif,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true };
}
