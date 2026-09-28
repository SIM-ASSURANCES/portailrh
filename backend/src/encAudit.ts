// Journal d'audit du module Encaissements (docs/encaissements-conception.md §6.3, modèle `EncAudit`).
//
// SEULE voie d'écriture de `EncAudit`, toujours dans la transaction de l'opération auditée (passer `tx`) : l'audit
// réussit ou échoue avec elle. La table est en ajout seul, garantie par trigger SQL (UPDATE toujours interdit,
// DELETE/TRUNCATE interdits dès la mise en service) — ce module n'expose donc aucune modification ni suppression.

import type { Prisma, PrismaClient } from "./generated/prisma/client";

export type EncAuditDb = Pick<PrismaClient, "encAudit">;

export interface EncAuditEntree {
  /** Modèle concerné, ex. « EncContrat ». */
  entite: string;
  entiteId: string;
  /** Verbe métier, ex. « creation », « modification », « annulation ». */
  action: string;
  /** État avant / après (objets sérialisables : Decimal → texte, Date → ISO, BigInt → texte). */
  avant?: unknown;
  apres?: unknown;
  motif?: string | null;
  /** Mois de rattachement (ramené au 1er du mois, UTC) pour le rapport « changements depuis la clôture ». */
  mois?: Date | null;
  userId: string;
  ip?: string | null;
}

export class EncAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncAuditError";
  }
}

/** Convertit une valeur en JSON stockable : Decimal (toJSON), Date (ISO), BigInt (texte) ; undefined → absent. */
export function versJsonAudit(valeur: unknown): Prisma.InputJsonValue | undefined {
  if (valeur === undefined || valeur === null) return undefined;
  return JSON.parse(JSON.stringify(valeur, (_cle, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** 1er du mois en UTC (même convention que les colonnes `mois` du module, stockées en DATE). */
export function premierDuMois(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw new EncAuditError("Mois de rattachement invalide.");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Prépare les données d'une ligne d'audit (fonction pure, testée sans base). */
export function preparerAudit(entree: EncAuditEntree): Prisma.EncAuditUncheckedCreateInput {
  const entite = entree.entite.trim();
  const entiteId = entree.entiteId.trim();
  const action = entree.action.trim();
  if (!entite || !entiteId || !action) throw new EncAuditError("Audit incomplet : entité, identifiant et action sont obligatoires.");
  if (!entree.userId) throw new EncAuditError("Audit incomplet : auteur obligatoire.");
  const motif = entree.motif?.trim();
  return {
    entite,
    entiteId,
    action,
    avant: versJsonAudit(entree.avant),
    apres: versJsonAudit(entree.apres),
    motif: motif ? motif : null,
    mois: entree.mois ? premierDuMois(entree.mois) : null,
    userId: entree.userId,
    ip: entree.ip ?? null,
  };
}

/** Écrit une ligne d'audit. À appeler avec le client de transaction de l'opération auditée. */
export async function ecrireAudit(db: EncAuditDb, entree: EncAuditEntree) {
  return db.encAudit.create({ data: preparerAudit(entree) });
}
