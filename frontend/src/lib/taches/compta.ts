import { messagePalierCpt, permissionsDestinatairesCpt, prioritePalierCpt, prisma, reserverRappelsTcaCpt, reserverRelancesCpt, reserverResumeHebdoCpt, utilisateursAvecPermission } from "backend";
import { notify } from "@/lib/notifications";
import { journaliserIncident } from "@/lib/journalTechnique";

/**
 * Gestion Compta, tâches planifiées (W9). État :
 *  - `COMPTA_RELANCES` (lundi à vendredi 08:00) : relance 7 jours, alerte 30, escalade 60 — lot GC-6b (cette page) ;
 *  - `COMPTA_CONTROLE_HEBDO` (lundi 07:30) : résumé de la semaine au commercial et à la production — lot GC-6b. Écart avec
 *    le commentaire d'origine de GC-1e, qui l'attribuait à GC-9 : le plan (§GC-6) et la conception §9 le mettent en GC-6, c'est
 *    ce qui est suivi ici ;
 *  - `COMPTA_RAPPEL_TCA` (les 10 et 17) : rappel de déclarer puis de payer la taxe du mois précédent avant le jour limite — lot GC-8f (voir
 *    `backend/src/cptRappelTcaDb.ts` : module hors service = rien, premier passage = aucun envoi, un rappel réservé avant d'être envoyé).
 *
 * RÈGLE (conservée) : une tâche jamais exécutée est « due » dès le premier passage du planificateur. Les trois tâches remplies ici
 * ne font donc RIEN tant que le module n'est pas mis en service (`CptMiseEnService`), et au premier passage après la mise en
 * service l'arriéré est réservé SANS envoi (règles complètes : `backend/src/cptRelancesDb.ts`, registre C-18).
 *
 * Destinataires : les porteurs de la permission du palier (`permissionsDestinatairesCpt`), délégués actifs compris. Aucune
 * ligne ne « concerne » personnellement un destinataire (l'auteur d'un import n'est pas le sujet d'une ligne) : aucune exclusion
 * n'est donc nécessaire. Notifications groupées : une par destinataire et par (objet, palier), jamais une par ligne. Catégorie
 * `SYSTEME` : aucune catégorie nouvelle (conception §9) et non purgée par la remise à zéro globale.
 */

export interface BilanTacheCompta {
  /** Lignes pour lesquelles un palier a été notifié. */
  traites: number;
  /** Notifications effectivement créées (une par destinataire et par palier). */
  notifications: number;
  /** Paliers réservés sans envoi (arriéré du premier passage, paliers inférieurs franchis d'un coup). */
  silencieuses: number;
  /** Lignes examinées (ayant atteint au moins le premier palier). */
  examinees: number;
  erreurs: number;
  premierPassage: boolean;
  /** Palier réservé mais aucun compte ne porte la permission : compté aussi dans `erreurs` (anomalie de configuration). */
  sansDestinataire: number;
  /** Module non mis en service : rien n'a été lu ni envoyé. */
  enAttenteDuModule?: true;
  moduleNonMisEnService?: true;
}

const BILAN_MODULE_NON_MIS_EN_SERVICE: BilanTacheCompta = {
  traites: 0,
  notifications: 0,
  silencieuses: 0,
  examinees: 0,
  erreurs: 0,
  premierPassage: false,
  sansDestinataire: 0,
  enAttenteDuModule: true,
  moduleNonMisEnService: true,
};

async function destinatairesDe(permissions: readonly string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const permission of permissions) {
    for (const id of await utilisateursAvecPermission(prisma, permission)) ids.add(id);
  }
  return [...ids];
}

/** Envoie un message à chaque destinataire ; une erreur sur l'un n'empêche pas les autres. Renvoie (envoyés, erreurs). */
async function notifierTous(userIds: readonly string[], message: { titre: string; message: string }, priority: "INFO" | "IMPORTANT", lien: string = LIEN_CONTROLE): Promise<{ envoyes: number; erreurs: number }> {
  let envoyes = 0;
  let erreurs = 0;
  for (const userId of userIds) {
    try {
      await notify({ userId, titre: message.titre, message: message.message, lien, priority, category: "SYSTEME" });
      envoyes++;
    } catch (e) {
      erreurs++;
      console.error("[Compta] Notification en échec :", e instanceof Error ? e.message : e);
    }
  }
  return { envoyes, erreurs };
}

const LIEN_CONTROLE = "/compta/controle";
const LIEN_TCA = "/compta/tca";

/**
 * Palier (ou résumé) réservé sans aucun destinataire : la réservation reste (jamais renvoyé), mais l'anomalie de configuration est
 * tracée au journal technique. Contexte sans donnée personnelle : type d'objet, palier, permissions attendues. Anti-inondation du
 * journal : au plus une ligne par code et par minute.
 */
async function tracerSansDestinataire(typeObjet: string, palier: string, permissions: readonly string[], tache = "COMPTA_RELANCES"): Promise<void> {
  await journaliserIncident({
    niveau: "AVERTISSEMENT",
    source: "TACHE",
    code: "COMPTA_PALIER_SANS_DESTINATAIRE",
    message: "Gestion Compta : palier de relance sans destinataire (aucun compte actif ne porte la permission attendue).",
    contexte: { tache, typeObjet, palier, permissionAttendue: permissions.join(", ") },
  });
}

/** Relance 7 / 30 / 60 jours. Les horloges et le client sont injectables pour les tests d'intégration. */
export async function executerComptaRelances(maintenant: Date = new Date()): Promise<BilanTacheCompta> {
  const r = await reserverRelancesCpt(prisma, maintenant);
  if (!r.moduleMisEnService) return { ...BILAN_MODULE_NON_MIS_EN_SERVICE };
  const bilan: BilanTacheCompta = {
    traites: 0,
    notifications: 0,
    silencieuses: r.silencieuses,
    examinees: r.examinees,
    erreurs: 0,
    premierPassage: r.premierPassage,
    sansDestinataire: 0,
  };
  if (!r.seuils) return bilan;
  for (const groupe of r.aEnvoyer) {
    const message = messagePalierCpt({ objet: groupe.objet, palier: groupe.palier, seuils: r.seuils, references: groupe.references });
    const destinataires = await destinatairesDe(permissionsDestinatairesCpt(groupe.objet, groupe.palier));
    if (destinataires.length === 0) {
      bilan.sansDestinataire++;
      bilan.erreurs++;
      await tracerSansDestinataire(groupe.objet, groupe.palier, permissionsDestinatairesCpt(groupe.objet, groupe.palier));
      continue;
    }
    const { envoyes, erreurs } = await notifierTous(destinataires, message, prioritePalierCpt(groupe.palier));
    bilan.notifications += envoyes;
    bilan.erreurs += erreurs;
    if (envoyes > 0) bilan.traites += groupe.references.length;
  }
  return bilan;
}

/** Résumé du lundi : une notification au commercial et une à la production, une seule fois par semaine. */
export async function executerComptaControleHebdo(maintenant: Date = new Date()): Promise<BilanTacheCompta> {
  const r = await reserverResumeHebdoCpt(prisma, maintenant);
  if (!r.moduleMisEnService) return { ...BILAN_MODULE_NON_MIS_EN_SERVICE };
  const bilan: BilanTacheCompta = { traites: 0, notifications: 0, silencieuses: 0, examinees: 0, erreurs: 0, premierPassage: false, sansDestinataire: 0 };
  const envois: [string[], { titre: string; message: string } | null][] = [
    [permissionsDestinatairesCpt("ENCAISSEMENT", "RELANCE"), r.encaissements],
    [permissionsDestinatairesCpt("CONTRAT", "RELANCE"), r.contrats],
  ];
  for (const [permissions, message] of envois) {
    if (!message) continue;
    const destinataires = await destinatairesDe(permissions);
    if (destinataires.length === 0) {
      bilan.sansDestinataire++;
      bilan.erreurs++;
      await tracerSansDestinataire("RESUME", "RELANCE", permissions);
      continue;
    }
    const { envoyes, erreurs } = await notifierTous(destinataires, message, "INFO");
    bilan.notifications += envoyes;
    bilan.erreurs += erreurs;
    if (envoyes > 0) bilan.traites++;
  }
  return bilan;
}

/**
 * Rappel de la taxe (les 10 et 17) : « déclarer » tant que le mois précédent n'est pas déclaré, « payer » une fois déclaré. Destinataires = les
 * porteurs de `cpt.declarer_tca` / `cpt.payer_tca` (délégués actifs compris). Un rappel est réservé avant d'être envoyé ; un rappel sans
 * destinataire reste réservé et est tracé au journal technique. L'horloge est injectable pour les tests.
 */
export async function executerComptaRappelTca(maintenant: Date = new Date()): Promise<BilanTacheCompta> {
  const r = await reserverRappelsTcaCpt(prisma, maintenant);
  if (!r.moduleMisEnService) return { ...BILAN_MODULE_NON_MIS_EN_SERVICE };
  const bilan: BilanTacheCompta = { traites: 0, notifications: 0, silencieuses: r.silencieux, examinees: r.mois ? 1 : 0, erreurs: 0, premierPassage: r.premierPassage, sansDestinataire: 0 };
  for (const rappel of r.aEnvoyer) {
    const destinataires = await destinatairesDe([rappel.permission]);
    if (destinataires.length === 0) {
      bilan.sansDestinataire++;
      bilan.erreurs++;
      await tracerSansDestinataire("TCA", rappel.type, [rappel.permission], "COMPTA_RAPPEL_TCA");
      continue;
    }
    const { envoyes, erreurs } = await notifierTous(destinataires, rappel.message, rappel.message.joursRestants <= 3 ? "IMPORTANT" : "INFO", LIEN_TCA);
    bilan.notifications += envoyes;
    bilan.erreurs += erreurs;
    if (envoyes > 0) bilan.traites++;
  }
  return bilan;
}

