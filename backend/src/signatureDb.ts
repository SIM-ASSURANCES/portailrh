// Lot L — couche base des signatures manuscrites : enrôlement (versions), enregistrement d'une action signée, titulaire d'une
// délégation, lecture pour l'historique / le parcours / le reporting / les PDF. Aucune écriture dans une table existante.

import type { Prisma } from "./generated/prisma/client";
import { CLE_MARQUEUR_SIGNATURES, rapprocherSignatures, type EtatSignatureEntree, type EntreeHistoriqueSignable } from "./signature";

type Db = Pick<
  Prisma.TransactionClient,
  | "signatureUtilisateur"
  | "actionSignee"
  | "marqueurUnique"
  | "permissionDelegation"
  | "ligneDemande"
  | "reglement"
  | "retourCaisse"
  | "remboursementRetour"
  | "retourExceptionnel"
>;

export interface SignatureCourante {
  id: string;
  version: number;
}

export async function signatureCourante(db: Pick<Db, "signatureUtilisateur">, userId: string): Promise<SignatureCourante | null> {
  return db.signatureUtilisateur.findFirst({ where: { userId }, orderBy: { version: "desc" }, select: { id: true, version: true } });
}

/** Ajoute une version de signature (jamais de modification d'une version existante). À appeler dans une transaction (verrou par compte). */
export async function ajouterVersionSignature(
  tx: Prisma.TransactionClient,
  userId: string,
  p: { png: Buffer; largeur: number; hauteur: number; empreinte: string }
): Promise<SignatureCourante> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"signature:" + userId}))`;
  const derniere = await tx.signatureUtilisateur.findFirst({ where: { userId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (derniere?.version ?? 0) + 1;
  const cree = await tx.signatureUtilisateur.create({
    data: { userId, version, image: new Uint8Array(p.png), largeur: p.largeur, hauteur: p.hauteur, empreinte: p.empreinte },
    select: { id: true, version: true },
  });
  return cree;
}

export type CibleSignature =
  | { type: "demande"; id: string }
  | { type: "ligne"; id: string }
  | { type: "reglement"; id: string }
  | { type: "retour"; id: string }
  | { type: "remboursement"; id: string }
  | { type: "retourExceptionnel"; id: string };

export interface CibleResolue {
  demandeId: string | null;
  ligneDemandeId: string | null;
  entite: string;
  entiteId: string;
}

/** Retrouve la demande (et l'article) d'une cible d'action ; `null` si introuvable. */
export async function resoudreCible(db: Db, cible: CibleSignature): Promise<CibleResolue | null> {
  switch (cible.type) {
    case "demande":
      return { demandeId: cible.id, ligneDemandeId: null, entite: "Demande", entiteId: cible.id };
    case "ligne": {
      const l = await db.ligneDemande.findUnique({ where: { id: cible.id }, select: { demandeId: true } });
      return l ? { demandeId: l.demandeId, ligneDemandeId: cible.id, entite: "LigneDemande", entiteId: cible.id } : null;
    }
    case "reglement": {
      const r = await db.reglement.findUnique({ where: { id: cible.id }, select: { demandeId: true, ligneDemandeId: true } });
      return r ? { demandeId: r.demandeId, ligneDemandeId: r.ligneDemandeId, entite: "Reglement", entiteId: cible.id } : null;
    }
    case "retour": {
      const r = await db.retourCaisse.findUnique({ where: { id: cible.id }, select: { reglement: { select: { demandeId: true, ligneDemandeId: true } } } });
      return r ? { demandeId: r.reglement.demandeId, ligneDemandeId: r.reglement.ligneDemandeId, entite: "RetourCaisse", entiteId: cible.id } : null;
    }
    case "remboursement": {
      const r = await db.remboursementRetour.findUnique({
        where: { id: cible.id },
        select: { retourCaisse: { select: { reglement: { select: { demandeId: true, ligneDemandeId: true } } } } },
      });
      return r
        ? { demandeId: r.retourCaisse.reglement.demandeId, ligneDemandeId: r.retourCaisse.reglement.ligneDemandeId, entite: "RemboursementRetour", entiteId: cible.id }
        : null;
    }
    case "retourExceptionnel": {
      const r = await db.retourExceptionnel.findUnique({ where: { id: cible.id }, select: { demandeId: true, ligneDemandeId: true } });
      return r ? { demandeId: r.demandeId, ligneDemandeId: r.ligneDemandeId, entite: "RetourExceptionnel", entiteId: cible.id } : null;
    }
  }
}

/**
 * Titulaire au nom duquel le compte agit : si la permission requise ne lui vient QUE d'une délégation active, le donneur (le plus ancien
 * donneur actif) ; sinon `null` (il agit en son nom propre). Les permissions de décision ne sont jamais délégables (inchangé).
 */
export async function titulaireDelegation(
  db: Pick<Db, "permissionDelegation">,
  p: { userId: string; permission: string | undefined; permissions: readonly string[]; rolePermissions: readonly string[] }
): Promise<string | null> {
  if (!p.permission) return null;
  if (!p.permissions.includes(p.permission) || p.rolePermissions.includes(p.permission)) return null;
  const d = await db.permissionDelegation.findFirst({
    where: { beneficiaireId: p.userId, estActive: true, permission: { key: p.permission }, donneur: { isActive: true } },
    orderBy: { createdAt: "asc" },
    select: { donneurId: true },
  });
  return d?.donneurId ?? null;
}

export async function enregistrerActionSignee(
  db: Pick<Db, "actionSignee">,
  p: {
    signatureId: string;
    signataireId: string;
    auNomDeId?: string | null;
    action: string;
    ip: string;
    cible?: CibleResolue | null;
    entite?: string | null;
    entiteId?: string | null;
  }
): Promise<string> {
  const a = await db.actionSignee.create({
    data: {
      signatureId: p.signatureId,
      signataireId: p.signataireId,
      auNomDeId: p.auNomDeId ?? null,
      action: p.action,
      demandeId: p.cible?.demandeId ?? null,
      ligneDemandeId: p.cible?.ligneDemandeId ?? null,
      entite: p.cible?.entite ?? p.entite ?? null,
      entiteId: p.cible?.entiteId ?? p.entiteId ?? null,
      ip: p.ip,
    },
    select: { id: true },
  });
  return a.id;
}

export async function lireMiseEnServiceSignatures(db: Pick<Db, "marqueurUnique">): Promise<Date | null> {
  const m = await db.marqueurUnique.findUnique({ where: { cle: CLE_MARQUEUR_SIGNATURES }, select: { creeAt: true } });
  return m?.creeAt ?? null;
}

export interface ActionSigneeLue {
  id: string;
  signataireId: string;
  creeAt: Date;
  action: string;
  demandeId: string | null;
  ligneDemandeId: string | null;
  entiteId: string | null;
  signatureId: string;
  version: number;
  signataire: string;
  fonction: string;
  auNomDeId: string | null;
  auNomDe: string | null;
  ip: string;
}

/** Actions signées des demandes données, de la plus ancienne à la plus récente (noms, fonction = nom du rôle, version utilisée). */
export async function lireActionsSignees(db: Pick<Db, "actionSignee">, demandeIds: readonly string[]): Promise<ActionSigneeLue[]> {
  if (demandeIds.length === 0) return [];
  const lignes = await db.actionSignee.findMany({
    where: { demandeId: { in: [...demandeIds] } },
    orderBy: { creeAt: "asc" },
    select: {
      id: true,
      signataireId: true,
      creeAt: true,
      action: true,
      demandeId: true,
      ligneDemandeId: true,
      entiteId: true,
      signatureId: true,
      ip: true,
      auNomDeId: true,
      auNomDe: { select: { fullName: true } },
      signature: { select: { version: true } },
      signataire: { select: { fullName: true, role: { select: { name: true } } } },
    },
  });
  return lignes.map((l) => ({
    id: l.id,
    signataireId: l.signataireId,
    creeAt: l.creeAt,
    action: l.action,
    demandeId: l.demandeId,
    ligneDemandeId: l.ligneDemandeId,
    entiteId: l.entiteId,
    signatureId: l.signatureId,
    version: l.signature.version,
    signataire: l.signataire.fullName,
    fonction: l.signataire.role.name,
    auNomDeId: l.auNomDeId,
    auNomDe: l.auNomDe?.fullName ?? null,
    ip: l.ip,
  }));
}

/** État de signature de chaque entrée d'historique signable (voir `rapprocherSignatures`). */
export async function etatsSignatureHistorique(
  db: Pick<Db, "actionSignee" | "marqueurUnique">,
  demandeId: string,
  entrees: readonly EntreeHistoriqueSignable[],
  actionsSignables: ReadonlySet<string>
): Promise<Map<string, EtatSignatureEntree<ActionSigneeLue>>> {
  const [signatures, mise] = await Promise.all([lireActionsSignees(db, [demandeId]), lireMiseEnServiceSignatures(db)]);
  return rapprocherSignatures(entrees, signatures, mise, actionsSignables);
}

/** Image PNG d'une version de signature (octets). */
export async function lireImageSignature(db: Pick<Db, "signatureUtilisateur">, id: string) {
  return db.signatureUtilisateur.findUnique({ where: { id }, select: { id: true, userId: true, image: true, version: true } });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Documents imprimés (reçu de règlement, reçu de retour de caisse) : la signature de chaque personne qui a validé une étape.
// ---------------------------------------------------------------------------------------------------------------------------

export interface SignatureDocument {
  /** Rang de l'étape dans le circuit (1 Service, 2 Finance, 3 DG, 4 exécution) : l'ordre d'impression. */
  rang: number;
  etape: string;
  nom: string;
  /** Fonction = nom du rôle du signataire. */
  fonction: string;
  date: Date;
  /** Version de signature utilisée ; `null` pour une action antérieure à la signature. */
  signatureId: string | null;
  auNomDe: string | null;
  anterieure: boolean;
}

const ETAPES_DOCUMENT: Record<string, { rang: number; etape: string }> = {
  validation_service: { rang: 1, etape: "Validation du responsable de service" },
  decision_lignes: { rang: 2, etape: "Validation de la Finance" },
  validation_depense_directe: { rang: 2, etape: "Validation de la Finance" },
  decision_ligne_dg: { rang: 3, etape: "Validation du DG" },
  validation_dg: { rang: 3, etape: "Validation du DG" },
  approbation_cloture: { rang: 3, etape: "Validation du DG" },
};

/** Actions d'historique d'avant la mise en service qui équivalent à une validation d'étape (demande entière). */
const HISTORIQUE_VALIDATION_ANTERIEURE: Record<string, { rang: number; etape: string }> = {
  validation_service: ETAPES_DOCUMENT.validation_service,
  decision_circuit: ETAPES_DOCUMENT.decision_lignes,
  validation: ETAPES_DOCUMENT.decision_lignes,
  validation_complementaire: ETAPES_DOCUMENT.decision_lignes,
  validation_dg: ETAPES_DOCUMENT.validation_dg,
  validation_complete_dg: ETAPES_DOCUMENT.validation_dg,
};

export async function chargerSignaturesDocument(
  db: Pick<Db, "actionSignee" | "marqueurUnique"> & Pick<Prisma.TransactionClient, "historiqueEntry">,
  demandeId: string,
  execution: {
    action: string;
    entiteId: string;
    etape: string;
    /** Auteur et date de l'action du document, pour la mentionner « Antérieur à la signature » quand elle précède la mise en service. */
    repli?: { nom: string; fonction: string; date: Date } | null;
  }
): Promise<SignatureDocument[]> {
  const [signees, mise] = await Promise.all([lireActionsSignees(db, [demandeId]), lireMiseEnServiceSignatures(db)]);
  const lignes: SignatureDocument[] = [];
  const dejaVu = new Set<string>();
  for (const a of signees) {
    const modele = a.action === execution.action ? { rang: 4, etape: execution.etape } : ETAPES_DOCUMENT[a.action];
    if (!modele) continue;
    // L'action du document : celle de CE règlement / CE retour seulement (pas celle d'un autre règlement de la demande).
    if (a.action === execution.action && a.entiteId !== execution.entiteId) continue;
    const cle = `${modele.rang}|${a.signataireId}|${a.auNomDeId ?? ""}`;
    if (dejaVu.has(cle)) continue;
    dejaVu.add(cle);
    lignes.push({ rang: modele.rang, etape: modele.etape, nom: a.signataire, fonction: a.fonction, date: a.creeAt, signatureId: a.signatureId, auNomDe: a.auNomDe, anterieure: false });
  }
  if (mise) {
    const rangsSignes = new Set(lignes.map((l) => l.rang));
    const anciennes = await db.historiqueEntry.findMany({
      where: { entity: "Demande", entityId: demandeId, action: { in: Object.keys(HISTORIQUE_VALIDATION_ANTERIEURE) }, createdAt: { lt: mise } },
      orderBy: { createdAt: "asc" },
      select: { action: true, createdAt: true, user: { select: { fullName: true, role: { select: { name: true } } } } },
    });
    for (const h of anciennes) {
      const modele = HISTORIQUE_VALIDATION_ANTERIEURE[h.action];
      if (rangsSignes.has(modele.rang)) continue;
      rangsSignes.add(modele.rang);
      lignes.push({ rang: modele.rang, etape: modele.etape, nom: h.user.fullName, fonction: h.user.role.name, date: h.createdAt, signatureId: null, auNomDe: null, anterieure: true });
    }
    if (!lignes.some((l) => l.rang === 4) && execution.repli && execution.repli.date.getTime() < mise.getTime()) {
      lignes.push({ rang: 4, etape: execution.etape, nom: execution.repli.nom, fonction: execution.repli.fonction, date: execution.repli.date, signatureId: null, auNomDe: null, anterieure: true });
    }
  }
  return lignes.sort((x, y) => x.rang - y.rang || x.date.getTime() - y.date.getTime());
}
