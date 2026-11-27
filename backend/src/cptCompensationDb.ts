import { ecrireAudit } from "./cptAudit";
import { planifierCompensationCpt, validerSaisieCompensationCpt } from "./cptCompensation";
import { texteDepuisCentimes } from "./cptEcheancier";
import {
  enregistrerLignesRemunerationCpt,
  moisCloturePourCpt,
  verrouillerRemunerationCpt,
  type ParametresRemunerationCpt,
  type RemunerationEcritureDbCpt,
} from "./cptReglementPartenaireDb";
import { chargerRemunerationPartenaireCpt } from "./cptRemunerationDb";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

export type ResultatCompensationCpt = { ok: true; compensationId: string } | { ok: false; message: string; erreurs?: Record<string, string> };

/**
 * Compensation explicite (lot GC-9f), dans la transaction de l'appelant, sous le verrou du partenaire (le même que les règlements :
 * une avance ne peut pas être reprise deux fois). Signature (D5) non branchée : tracée dans `CptAudit` avec son motif.
 */
export async function enregistrerCompensationCpt(
  db: RemunerationEcritureDbCpt,
  saisie: Record<string, unknown>,
  p: ParametresRemunerationCpt,
): Promise<ResultatCompensationCpt> {
  const v = validerSaisieCompensationCpt(saisie);
  if (!v.ok) return { ok: false, message: Object.values(v.erreurs)[0], erreurs: v.erreurs };
  const s = v.valeur;
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  await verrouillerRemunerationCpt(db, s.partenaireId);
  if (await moisCloturePourCpt(db, aujourdhui)) return { ok: false, message: "Le mois en cours est clôturé : aucune écriture ne peut y être datée." };
  const r = await chargerRemunerationPartenaireCpt(db, s.partenaireId, aujourdhui);
  if (!r) return { ok: false, message: "Partenaire introuvable." };
  const plan = planifierCompensationCpt(r.lignes, s.natureSource, s.natureCible, s.montant);
  if (!plan.ok) return { ok: false, message: plan.message, erreurs: { montant: plan.message } };

  const cles = new Set([...plan.reprises, ...plan.ajouts].map((x) => x.cle));
  const lignes = r.lignes.filter((l) => l.nature === s.natureSource || l.nature === s.natureCible);
  const ids = await enregistrerLignesRemunerationCpt(db, lignes, cles, p);
  const compensation = await db.cptCompensation.create({
    data: {
      partenaireId: s.partenaireId,
      natureSource: s.natureSource,
      natureCible: s.natureCible,
      montant: texteDepuisCentimes(s.montant),
      motif: s.motif,
      valideeParId: p.userId,
      creeAt: maintenant,
    },
    select: { id: true },
  });
  await db.cptAffectationCompensation.createMany({
    data: [
      ...plan.reprises.map((x) => ({ compensationId: compensation.id, ligneRemunerationId: ids.get(x.cle)!, montant: texteDepuisCentimes(-x.montant) })),
      ...plan.ajouts.map((x) => ({ compensationId: compensation.id, ligneRemunerationId: ids.get(x.cle)!, montant: texteDepuisCentimes(x.montant) })),
    ],
  });
  const resume = (parts: typeof plan.reprises) => parts.map((x) => ({ police: x.numPolice, echeance: x.rang, montant: texteDepuisCentimes(x.montant) }));
  await ecrireAudit(db, {
    entite: "CptCompensation",
    entiteId: compensation.id,
    action: "compensation",
    avant: { avanceSource: texteDepuisCentimes(plan.capacite.avanceSource), aVerserCible: texteDepuisCentimes(plan.capacite.aVerserCible) },
    apres: {
      partenaire: r.partenaire.nom,
      natureSource: s.natureSource,
      natureCible: s.natureCible,
      montant: texteDepuisCentimes(s.montant),
      reprises: resume(plan.reprises),
      ajouts: resume(plan.ajouts),
    },
    motif: s.motif,
    mois: maintenant,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, compensationId: compensation.id };
}
