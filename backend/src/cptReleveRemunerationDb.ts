import type { PrismaClient } from "./generated/prisma/client";
import type { NatureRemunerationCpt } from "./cptReferentiels";
import type { ModePaiementPartenaireCpt } from "./cptReglementPartenaire";
import { construireReleveRemunerationCpt, type ReleveRemunerationCpt } from "./cptReleveRemuneration";
import { centimesSignesRemunerationCpt, chargerRemunerationPartenaireCpt, type RemunerationDbCpt, type RemunerationPartenaireCpt } from "./cptRemunerationDb";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

export type ReleveRemunerationDbCpt = RemunerationDbCpt & Pick<PrismaClient, "cptReglementPartenaire" | "cptCompensation">;

const jour = (d: Date) => d.toISOString().slice(0, 10);
const ANNULATION = { select: { date: true, creeAt: true, motif: true } } as const;
const versAnnulation = (a: { date: Date; creeAt: Date; motif: string } | null) => (a ? { date: jour(a.date), creeAt: a.creeAt.toISOString(), motif: a.motif } : null);

/** Relevé d'un partenaire pour une nature (écran, export, PDF) : LECTURE SEULE. `null` si le partenaire n'existe pas. */
export async function chargerReleveRemunerationCpt(
  db: ReleveRemunerationDbCpt,
  partenaireId: string,
  nature: NatureRemunerationCpt,
  aujourdhui: string,
): Promise<{ partenaire: RemunerationPartenaireCpt["partenaire"]; releve: ReleveRemunerationCpt } | null> {
  const etat = await chargerRemunerationPartenaireCpt(db, partenaireId, aujourdhui);
  if (!etat) return null;
  const [reglements, compensations] = await Promise.all([
    db.cptReglementPartenaire.findMany({
      where: { partenaireId, nature },
      select: { reference: true, date: true, montant: true, montantAvance: true, mode: true, referenceReglement: true, creeAt: true, annulation: ANNULATION },
    }),
    db.cptCompensation.findMany({
      where: { partenaireId, OR: [{ natureSource: nature }, { natureCible: nature }] },
      select: { creeAt: true, natureSource: true, natureCible: true, montant: true, motif: true, annulation: ANNULATION },
    }),
  ]);
  const releve = construireReleveRemunerationCpt({
    nature,
    lignes: etat.lignes,
    clients: etat.contrats,
    reglements: reglements.map((r) => ({
      reference: r.reference,
      date: jour(r.date),
      montant: centimesSignesRemunerationCpt(r.montant),
      montantAvance: centimesSignesRemunerationCpt(r.montantAvance),
      mode: r.mode as ModePaiementPartenaireCpt,
      referenceReglement: r.referenceReglement,
      creeAt: r.creeAt.toISOString(),
      annulation: versAnnulation(r.annulation),
    })),
    compensations: compensations.map((c) => ({
      date: jour(c.creeAt),
      natureSource: c.natureSource as NatureRemunerationCpt,
      natureCible: c.natureCible as NatureRemunerationCpt,
      montant: centimesSignesRemunerationCpt(c.montant),
      motif: c.motif,
      creeAt: c.creeAt.toISOString(),
      annulation: versAnnulation(c.annulation),
    })),
  });
  return { partenaire: etat.partenaire, releve };
}
