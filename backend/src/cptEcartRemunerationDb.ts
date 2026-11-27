import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { cleEcartRemunerationCpt, detecterEcartsRemunerationCpt, type NatureBordereauCpt } from "./cptEcartRemuneration";
import { texteDepuisCentimes } from "./cptEcheancier";
import { chargerParametresCpt } from "./cptParametres";
import type { NatureRemunerationCpt } from "./cptReferentiels";
import {
  centimesSignesRemunerationCpt,
  chargerConventionsRemunerationCpt,
  SELECT_CONTRAT_REMUNERATION_CPT,
  versContratRemunerationCpt,
} from "./cptRemunerationDb";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

export type EcartRemunerationDbCpt = Pick<PrismaClient, "cptContrat" | "cptConvention" | "cptLigneRemuneration" | "cptAlerteControle" | "cptParametre">;

const LOT = 1000;

/** Détail enregistré avec l'alerte : montants en texte, tels qu'ils étaient à la détection. */
export interface DetailEcartRemunerationCpt {
  contratId: string;
  numPolice: string;
  nature: NatureBordereauCpt;
  declare: string;
  attendu: string;
  ecart: string;
  conventionIds: string[];
  importId: string;
}

/**
 * Contrôle les contrats d'un import qui portent une valeur de bordereau et crée les alertes manquantes (dans la transaction de
 * l'import). La clé unique de `CptAlerteControle` rend l'opération rejouable : un second import ne double jamais une alerte.
 * Aucun envoi : l'alerte se lit sur `/compta/controle`. Renvoie le nombre d'alertes créées.
 */
export async function alerterEcartsRemunerationCpt(db: EcartRemunerationDbCpt, contratIds: readonly string[], importId: string): Promise<number> {
  if (contratIds.length === 0) return 0;
  const tolerance = BigInt(Math.round((await chargerParametresCpt(db))["remuneration.tolerance_ecart_fcfa"] * 100));
  const conventions = await chargerConventionsRemunerationCpt(db);
  const alertes: Prisma.CptAlerteControleCreateManyInput[] = [];
  for (let i = 0; i < contratIds.length; i += LOT) {
    const contrats = await db.cptContrat.findMany({
      where: { id: { in: contratIds.slice(i, i + LOT) }, OR: [{ commissionDeclaree: { not: null } }, { gestionDeclaree: { not: null } }] },
      select: { ...SELECT_CONTRAT_REMUNERATION_CPT, commissionDeclaree: true, gestionDeclaree: true },
    });
    if (contrats.length === 0) continue;
    const figees = await db.cptLigneRemuneration.findMany({
      where: { contratId: { in: contrats.map((c) => c.id) } },
      select: { id: true, contratId: true, echeanceId: true, partenaireBeneficiaireId: true, nature: true, conventionId: true, du: true },
    });
    for (const c of contrats) {
      const ecarts = detecterEcartsRemunerationCpt({
        contrat: versContratRemunerationCpt(c),
        declares: {
          COMMISSION: c.commissionDeclaree === null ? null : centimesSignesRemunerationCpt(c.commissionDeclaree),
          HONORAIRES: c.gestionDeclaree === null ? null : centimesSignesRemunerationCpt(c.gestionDeclaree),
        },
        conventions,
        // Seuls la convention et le dû figés comptent ici ; le payé n'intervient pas dans le dû.
        enregistrees: figees
          .filter((l) => l.contratId === c.id)
          .map((l) => ({
            id: l.id,
            contratId: l.contratId,
            echeanceId: l.echeanceId,
            beneficiaireId: l.partenaireBeneficiaireId,
            nature: l.nature as NatureRemunerationCpt,
            conventionId: l.conventionId,
            du: centimesSignesRemunerationCpt(l.du),
            paye: BigInt(0),
            payeEnUneFois: BigInt(0),
          })),
        toleranceCentimes: tolerance,
      });
      for (const e of ecarts) {
        const detail: DetailEcartRemunerationCpt = {
          contratId: c.id,
          numPolice: c.numPolice,
          nature: e.nature,
          declare: texteDepuisCentimes(e.declare),
          attendu: texteDepuisCentimes(e.attendu),
          ecart: texteDepuisCentimes(e.ecart),
          conventionIds: e.conventionIds,
          importId,
        };
        alertes.push({ objet: "ECART_REMUNERATION", objetId: cleEcartRemunerationCpt(c.id, e.nature, e.ecart), palier: "ALERTE", detail: detail as unknown as Prisma.InputJsonValue });
      }
    }
  }
  if (alertes.length === 0) return 0;
  return (await db.cptAlerteControle.createMany({ data: alertes, skipDuplicates: true })).count;
}

export interface LigneEcartRemunerationCpt extends DetailEcartRemunerationCpt {
  id: string;
  detecteLe: Date;
}

export const TAILLE_LISTE_ECARTS_CPT = 100;

/** Les alertes d'écart les plus récentes (écran de contrôle). Montre des montants de rémunération : lecture C-36 exigée par l'écran. */
export async function listerEcartsRemunerationCpt(db: Pick<PrismaClient, "cptAlerteControle">): Promise<{ lignes: LigneEcartRemunerationCpt[]; total: number }> {
  const where = { objet: "ECART_REMUNERATION" } as const;
  const [lues, total] = await Promise.all([
    db.cptAlerteControle.findMany({ where, orderBy: [{ creeAt: "desc" }, { objetId: "asc" }], take: TAILLE_LISTE_ECARTS_CPT }),
    db.cptAlerteControle.count({ where }),
  ]);
  return { total, lignes: lues.map((a) => ({ ...(a.detail as unknown as DetailEcartRemunerationCpt), id: a.id, detecteLe: a.creeAt })) };
}
