/**
 * Couche base des étapes de la remise à zéro depuis l'application (lot R) : trace d'audit de chaque étape, lecture de
 * l'état des étapes, simulation détaillée, comptes de test. AUCUNE levée de verrou ici (lot S) : le verrou ne se lève que par SQL. Les règles sont dans
 * `reinitialisationEtapes.ts` et `comptesDeTest.ts` (purs, testés). La PURGE elle-même reste `executerReinitialisation`
 * (`reinitialisation.ts`), le même code que la ligne de commande.
 *
 * Audit : toutes les étapes s'écrivent dans `HistoriqueEntry` (entité `ReinitialisationSysteme`, conservée par la purge),
 * avec l'auteur et la date. Une étape tracée n'est jamais modifiée.
 */
import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import {
  VERROU_REINITIALISATION,
  exigerVerrouLibre,
  getReinitialisationInfo,
  calculerEmpreinte,
  chargerJeuxReinitialisation,
  decompterJeux,
  reinitialisationEffectuee,
  urlsFichiersAPurger,
} from "./reinitialisation";
import { CLASSIFICATION_TABLES, ENTITES_HISTORIQUE_PURGEES, CATEGORIES_NOTIFICATION_PURGEES } from "./reinitialisationClassification";
import { debutFenetre, type EtatEtapes, type InfoVerrou } from "./reinitialisationEtapes";
import { estCompteDeTest, planifierDesactivation, SUFFIXE_EMAIL_TEST, type CompteTest, type RefusDesactivation } from "./comptesDeTest";
import { getSoldeCaisse } from "./tresorerie";

export const ENTITE_AUDIT_REINITIALISATION = "ReinitialisationSysteme";
/** Identifiant des traces d'étape qui ne portent pas sur une ligne précise. */
export const ID_AUDIT_ETAPES = "etapes";

export const ACTION_SIMULATION = "simulation_reinitialisation";
export const ACTION_SAUVEGARDE = "sauvegarde_reinitialisation";
export const ACTION_COMPTES_TEST = "desactivation_comptes_test";

type Db = Pick<Prisma.TransactionClient, "historiqueEntry">;

export async function tracerEtapeReinitialisation(
  userId: string,
  action: string,
  detail: string,
  entityId: string = ID_AUDIT_ETAPES,
  db: Db = prisma
) {
  await db.historiqueEntry.create({ data: { entity: ENTITE_AUDIT_REINITIALISATION, entityId, action, detail, userId } });
}

/** Le verrou actif (date et auteur de la remise à zéro qui l'a posé), ou `null` s'il n'y en a pas. */
export async function lireInfoVerrou(): Promise<InfoVerrou | null> {
  const info = await getReinitialisationInfo();
  return info ? { effectueeAt: info.effectueeAt, par: info.effectueePar.fullName } : null;
}

const REGEX_EMPREINTE = /empreinte ([0-9a-f]{64})/;

export interface LectureEtapes {
  etat: EtatEtapes;
  /** Empreinte de la dernière sauvegarde générée par ce compte dans la fenêtre (null si aucune). */
  empreinteSauvegarde: string | null;
  depuis: Date;
}

/** Lit dans l'audit ce que CE compte a déjà fait, dans la fenêtre de validité (voir `debutFenetre`). */
export async function lireEtatEtapes(userId: string, maintenant: Date = new Date()): Promise<LectureEtapes> {
  const [verrouActif, dernierePurge] = await Promise.all([
    reinitialisationEffectuee(),
    prisma.reinitialisationSysteme.findFirst({ orderBy: { effectueeAt: "desc" }, select: { effectueeAt: true } }),
  ]);
  const depuis = debutFenetre(maintenant, dernierePurge?.effectueeAt ?? null);
  const traces = await prisma.historiqueEntry.findMany({
    where: {
      entity: ENTITE_AUDIT_REINITIALISATION,
      userId,
      action: { in: [ACTION_SIMULATION, ACTION_SAUVEGARDE] },
      createdAt: { gte: depuis },
    },
    orderBy: { createdAt: "desc" },
    select: { action: true, detail: true },
  });
  const derniereSauvegarde = traces.find((t) => t.action === ACTION_SAUVEGARDE);
  const empreinteSauvegarde = derniereSauvegarde ? (REGEX_EMPREINTE.exec(derniereSauvegarde.detail ?? "")?.[1] ?? null) : null;
  return {
    etat: {
      verrouActif,
      simulationFaite: traces.some((t) => t.action === ACTION_SIMULATION),
      sauvegardeFaite: empreinteSauvegarde !== null,
    },
    empreinteSauvegarde,
    depuis,
  };
}

export interface LigneDecompte {
  table: string;
  nombre: number;
  note: string | null;
}

export interface SimulationDetaillee {
  /** Lignes qui seront supprimées, par table (tableaux vides compris). */
  supprime: LigneDecompte[];
  /** Lignes qui seront conservées, par table de configuration ou d'audit. */
  conserve: LigneDecompte[];
  totalSupprime: number;
  fichiers: number;
  /** Avertissement caisse : lignes du journal de caisse supprimées et solde actuel (rouge à l'écran). */
  caisse: { lignes: number; solde: number };
  encEnService: boolean;
  verrouActif: boolean;
  empreinte: string;
}

const enMinuscule = (modele: string) => modele.charAt(0).toLowerCase() + modele.slice(1);
const enMajuscule = (cle: string) => cle.charAt(0).toUpperCase() + cle.slice(1);

/** Nombre de lignes conservées d'une table (les tables « partielles » sont comptées par leur critère de conservation). */
async function compterConserve(modele: string, encEnService: boolean): Promise<number | null> {
  const delegue = (prisma as unknown as Record<string, { count: (a?: unknown) => Promise<number> } | undefined>)[enMinuscule(modele)];
  if (!delegue || typeof delegue.count !== "function") return null;
  switch (modele) {
    case "HistoriqueEntry":
      return delegue.count({ where: { entity: { notIn: ENTITES_HISTORIQUE_PURGEES } } });
    case "Notification":
      return delegue.count({ where: { category: { notIn: [...CATEGORIES_NOTIFICATION_PURGEES] } } });
    case "ActionSignee":
      return delegue.count({ where: { historique: { some: {} } } });
    default:
      break;
  }
  const statut = CLASSIFICATION_TABLES[modele]?.statut;
  if (statut === "CONSERVEE") return delegue.count();
  // Table d'Encaissements « purgée » seulement avant la mise en service : conservée en entier ensuite.
  if (encEnService && modele.startsWith("Enc")) return delegue.count();
  return null;
}

/** Simulation SANS écriture : ce qu'une purge supprimerait et conserverait, table par table, plus l'avertissement de caisse. */
export async function simulerReinitialisationDetaillee(): Promise<SimulationDetaillee> {
  await exigerVerrouLibre(); // verrou définitif (lot S) : refusée côté serveur tant qu'il existe
  const jeux = await chargerJeuxReinitialisation(prisma);
  const decompte = decompterJeux(jeux);
  const encEnService = (await prisma.encMiseEnService.count()) > 0;
  const supprime: LigneDecompte[] = Object.entries(decompte).map(([table, nombre]) => ({
    table,
    nombre,
    note: CLASSIFICATION_TABLES[enMajuscule(table)]?.note ?? null,
  }));

  const conserve: LigneDecompte[] = [];
  for (const [modele, classement] of Object.entries(CLASSIFICATION_TABLES)) {
    if (classement.statut === "PURGEE" && !(encEnService && modele.startsWith("Enc"))) continue;
    const n = await compterConserve(modele, encEnService);
    if (n !== null) conserve.push({ table: modele, nombre: n, note: classement.note });
  }

  return {
    supprime,
    conserve,
    totalSupprime: supprime.reduce((a, l) => a + l.nombre, 0),
    fichiers: urlsFichiersAPurger(jeux).length,
    caisse: { lignes: jeux.journalCaisse.length, solde: await getSoldeCaisse() },
    encEnService,
    verrouActif: false, // le verrou actif a été refusé plus haut
    empreinte: calculerEmpreinte(jeux),
  };
}

/** Toutes les remises à zéro enregistrées (verrou actif ou levé par SQL), la plus récente d'abord. */
export async function listerReinitialisations() {
  const lignes = await prisma.reinitialisationSysteme.findMany({
    orderBy: { effectueeAt: "desc" },
    include: { effectueePar: { select: { fullName: true } } },
  });
  return lignes.map((l) => {
    return {
      id: l.id,
      effectueeAt: l.effectueeAt,
      effectueePar: l.effectueePar.fullName,
      sauvegardeSha256: l.sauvegardeSha256,
      fichiersSupprimes: l.fichiersSupprimes,
      fichiersEchecs: l.fichiersEchecs,
      decompte: l.decompte as Record<string, number>,
      verrouActif: l.verrou === VERROU_REINITIALISATION,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Comptes de test
// ---------------------------------------------------------------------------------------------------------------

const PERMISSION_REINITIALISATION = "systeme.reinitialiser";

/** Comptes de test encore ACTIFS (`*@simassurances.test`), avec ce qui décide s'ils peuvent être désactivés. */
export async function listerComptesDeTestActifs(): Promise<CompteTest[]> {
  return listerComptesDeTestActifsDans(prisma);
}

/** Identifiants de TOUS les comptes actifs dont le rôle porte `systeme.reinitialiser` (test ou non). */
export async function porteursReinitialisationActifs(db: Pick<Prisma.TransactionClient, "user"> = prisma): Promise<string[]> {
  const lignes = await db.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { key: PERMISSION_REINITIALISATION } } } } },
    select: { id: true },
  });
  return lignes.map((l) => l.id);
}

/** Plan de désactivation de tous les comptes de test actifs (affichage : qui peut l'être, qui est refusé et pourquoi). */
export async function planDesactivationComptesDeTest(connecteId: string) {
  const comptes = await listerComptesDeTestActifs();
  const porteurs = await porteursReinitialisationActifs();
  return { comptes, plan: planifierDesactivation(comptes, porteurs, connecteId) };
}

export interface ResultatDesactivation {
  desactives: Array<{ id: string; email: string }>;
  refuses: RefusDesactivation[];
}

/**
 * DÉSACTIVE (jamais ne supprime) les comptes de test choisis, dans une transaction. Le plan est recalculé ici d'après
 * l'état courant de la base (jamais d'après la liste affichée) ; seuls des comptes de test ACTIFS sont atteints.
 * Chaque compte désactivé reçoit `tokenVersion + 1` (ses sessions en cours sont coupées) et une trace `DEACTIVATE` ; une
 * trace de synthèse est écrite dans l'audit de la réinitialisation. Aucun e-mail ni notification n'est envoyé.
 */
export async function desactiverComptesDeTest({ acteurId, ids }: { acteurId: string; ids: readonly string[] }): Promise<ResultatDesactivation> {
  return prisma.$transaction(
    async (tx) => {
      const demandes = new Set(ids);
      const tous = await listerComptesDeTestActifsDans(tx);
      const selection = tous.filter((c) => demandes.has(c.id));
      const porteurs = await porteursReinitialisationActifs(tx);
      const plan = planifierDesactivation(selection, porteurs, acteurId);
      for (const c of plan.aDesactiver) {
        await tx.user.update({ where: { id: c.id }, data: { isActive: false, tokenVersion: { increment: 1 } } });
        await tx.historiqueEntry.create({
          data: {
            entity: "User",
            entityId: c.id,
            action: "DEACTIVATE",
            detail: `Compte de test désactivé : ${c.email} (remise à zéro de mise en production)`,
            userId: acteurId,
          },
        });
      }
      await tracerEtapeReinitialisation(
        acteurId,
        ACTION_COMPTES_TEST,
        `${plan.aDesactiver.length} compte(s) de test désactivé(s)${plan.aDesactiver.length ? ` : ${plan.aDesactiver.map((c) => c.email).join(", ")}` : ""}${
          plan.refuses.length ? ` ; ${plan.refuses.length} non désactivé(s) : ${plan.refuses.map((r) => r.compte.email).join(", ")}` : ""
        }.`,
        ID_AUDIT_ETAPES,
        tx
      );
      return { desactives: plan.aDesactiver.map((c) => ({ id: c.id, email: c.email })), refuses: plan.refuses };
    },
    { timeout: 30_000 }
  );
}

async function listerComptesDeTestActifsDans(tx: Pick<Prisma.TransactionClient, "user">): Promise<CompteTest[]> {
  const comptes = await tx.user.findMany({
    where: { isActive: true, email: { endsWith: SUFFIXE_EMAIL_TEST, mode: "insensitive" } },
    orderBy: { email: "asc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true, permissions: { where: { permission: { key: PERMISSION_REINITIALISATION } }, select: { roleId: true } } } },
      servicesResponsable: { select: { name: true }, orderBy: { name: "asc" } },
    },
  });
  return comptes
    .filter((c) => estCompteDeTest(c.email))
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      roleName: c.role.name,
      porteReinitialisation: c.role.permissions.length > 0,
      servicesResponsable: c.servicesResponsable.map((s) => s.name),
    }));
}

/**
 * Le lien « Réinitialisation » du menu pour un Admin qui ne porte pas `systeme.reinitialiser` : seulement s'il reste des
 * comptes de test actifs APRÈS une remise à zéro enregistrée (il n'y voit que le panneau de désactivation).
 */
export async function panneauComptesDeTestAVoir(): Promise<boolean> {
  if ((await prisma.reinitialisationSysteme.count()) === 0) return false;
  return (await prisma.user.count({ where: { isActive: true, email: { endsWith: SUFFIXE_EMAIL_TEST, mode: "insensitive" } } })) > 0;
}
