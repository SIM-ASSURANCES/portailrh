import { prisma, rechercherContratIds, type Prisma } from "backend";

/**
 * Filtres de l'écran « À confirmer » (F5, commit 6b), partagés par la page et l'export des « non reçus » : statut
 * (à confirmer par défaut, ou non reçus), période de paiement, mode, partenaire, branche et recherche (n° de police,
 * client, partenaire, produit, branche, référence — même recherche que la barre du module, D20-D22).
 */
export type StatutFiltre = "A_CONFIRMER" | "NON_RECU";

export interface FiltresAConfirmer {
  statut: StatutFiltre;
  du: string;
  au: string;
  mode: string;
  partenaire: string;
  branche: string;
  q: string;
}

type Brut = Record<string, string | string[] | undefined>;
const premier = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function lireFiltres(sp: Brut, statutImpose?: StatutFiltre): FiltresAConfirmer {
  const statut = statutImpose ?? (premier(sp.statut) === "NON_RECU" ? "NON_RECU" : "A_CONFIRMER");
  const date = (v: string) => (DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");
  return {
    statut,
    du: date(premier(sp.du)),
    au: date(premier(sp.au)),
    mode: premier(sp.mode),
    partenaire: premier(sp.partenaire),
    branche: premier(sp.branche),
    q: premier(sp.q).slice(0, 120),
  };
}

/** Paramètres GET des filtres (sans la page), pour les liens de pagination et d'export. */
export function versRecherche(f: FiltresAConfirmer, sansStatut = false): URLSearchParams {
  const q = new URLSearchParams();
  if (!sansStatut && f.statut !== "A_CONFIRMER") q.set("statut", f.statut);
  for (const cle of ["du", "au", "mode", "partenaire", "branche", "q"] as const) if (f[cle]) q.set(cle, f[cle]);
  return q;
}

/** Clause Prisma ; `null` si la recherche ne trouve aucun contrat (liste vide sans autre requête). */
export async function clauseFiltres(f: FiltresAConfirmer): Promise<Prisma.EncEncaissementWhereInput | null> {
  const where: Prisma.EncEncaissementWhereInput = { statut: f.statut };
  if (f.du || f.au) {
    where.datePaiement = { ...(f.du ? { gte: new Date(`${f.du}T00:00:00Z`) } : {}), ...(f.au ? { lte: new Date(`${f.au}T00:00:00Z`) } : {}) };
  }
  if (f.mode) where.mode = f.mode;
  if (f.branche) where.brancheId = f.branche;
  if (f.partenaire) where.contrat = { partenaireId: f.partenaire };
  if (f.q) {
    const ids = await rechercherContratIds(prisma, f.q, 1000);
    if (ids.length === 0) return null;
    where.contratId = { in: ids };
  }
  return where;
}
