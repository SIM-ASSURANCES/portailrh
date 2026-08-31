import { prisma } from "@/lib/prisma";

const PREFIX = "DEM";
const COUNTER_DIGITS = 6;

/**
 * Génère une référence de demande lisible et unique, ex: "DEM-2026-000123"
 * (préfixe + année + compteur incrémental sur 6 chiffres, remis à zéro
 * chaque année).
 *
 * V1 volontairement simple : compte les demandes déjà créées pour l'année
 * en cours (par préfixe de référence) et incrémente. Deux appels
 * concurrents peuvent proposer la même référence dans de rares cas — c'est
 * la contrainte `@unique` sur `Demande.reference` qui protège la base ;
 * l'appelant doit retenter avec une nouvelle référence si la création
 * échoue sur ce conflit plutôt que d'imposer un verrou ou une table de
 * séquence dédiée (voir `treso/demandes/nouvelle/actions.ts` pour
 * l'exemple de retry).
 */
export async function generateDemandeReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${PREFIX}-${year}-`;

  const count = await prisma.demande.count({
    where: { reference: { startsWith: prefix } },
  });

  return `${prefix}${String(count + 1).padStart(COUNTER_DIGITS, "0")}`;
}
