/**
 * CLASSIFICATION de TOUTES les tables du schéma Prisma pour la réinitialisation avant mise en production (lot N,
 * 2026-10-30). Source unique : le test `reinitialisationClassification.test.ts` lit `schema.prisma` et échoue si un modèle
 * n'est pas classé ici (ou si un modèle classé n'existe plus) — aucune table de données métier ne peut plus être oubliée
 * quand un lot en ajoute une. Le même tableau est repris dans `docs/mise-en-production.md`.
 *
 * - PURGEE    : donnée de test, supprimée en entier.
 * - PARTIELLE : une partie seulement est supprimée (le critère est dans `note`).
 * - CONSERVEE : configuration, comptes, verrous et audit permanents : jamais touchés.
 */

export type StatutTable = "PURGEE" | "PARTIELLE" | "CONSERVEE";

export interface ClassementTable {
  statut: StatutTable;
  note: string;
}

const P = (note: string): ClassementTable => ({ statut: "PURGEE", note });
const PP = (note: string): ClassementTable => ({ statut: "PARTIELLE", note });
const C = (note: string): ClassementTable => ({ statut: "CONSERVEE", note });

export const CLASSIFICATION_TABLES: Record<string, ClassementTable> = {
  // ---- Socle
  User: C("comptes (les comptes de test se désactivent à la main après la purge)"),
  Role: C("rôles et leurs champs (estAdmin, peutEtreBeneficiaireDelegation, peutRecevoirFeedback)"),
  Module: C("modules activés"),
  Permission: C("catalogue des permissions"),
  RolePermission: C("permissions de chaque rôle"),
  PermissionDelegation: C("délégations (lignes de configuration d'accès, révocations comprises)"),
  Service: C("services et leurs responsables"),
  FcmToken: C("jetons push des appareils"),
  HistoriqueEntry: PP(
    "supprimées : entités Demande, LigneDemande, JournalCaisse, RetourExterne, Pointage, PointageQR, PointageGeo, JustificationPointage, DemandeConge ; " +
      "conservées : audit Admin/Auth/User/Service/Role/Module/Categorie/Objet/PermissionDelegation, budgets (BudgetParametrage, ParametreTresorerie), signatures enrôlées, verrous"
  ),
  Notification: PP("supprimées : catégories TRESORERIE, RH, POINTAGE ; conservées : ADMIN, SYSTEME"),
  // ---- Trésorerie : configuration
  Categorie: C("catalogue des catégories"),
  Objet: C("catalogue des objets"),
  ParametreTresorerie: C("paramètres (date « catégorisation obligatoire »)"),
  BudgetParametrage: C("budgets validés ou en attente du DG, seuils, historique de validation"),
  // ---- Trésorerie : données de test
  Demande: P("demandes (avec chronomètres, motifs d'échange, circuit)"),
  LigneDemande: P("articles"),
  PieceJointe: P("pièces jointes (fichiers de uploads/ supprimés après le commit)"),
  Reglement: P("règlements"),
  ReglementCategorieAllocation: P("allocations budgétaires des règlements"),
  RetourCaisse: P("retours de caisse"),
  DepenseLigne: P("dépenses détaillées"),
  SignalementRetour: P("signalements d'erreur sur un retour"),
  RemboursementRetour: P("remboursements de retour"),
  RetourExceptionnel: P("retours exceptionnels post-clôture"),
  RetourExterne: P("retours externes (rattachés ou non)"),
  JournalCaisse: P("grand livre de caisse — SEULE exception à « jamais modifié » : la remise à zéro des données de test vide aussi le solde d'ouverture, à ressaisir ensuite"),
  JournalBanque: P("traçabilité des mouvements banque"),
  BudgetDepassement: P("confirmations de dépassement de budget (liées à des demandes de test)"),
  ActionSignee: PP(
    "supprimées : actions signées sans ligne d'historique conservée ; conservées : celles dont une ligne d'historique conservée dépend (budgets), pour que l'historique ne passe pas en « Signature non rattachée »"
  ),
  SignatureUtilisateur: C("signatures enrôlées dans le profil, toutes versions"),
  // ---- Pointage / FeedbackApp
  ParametrageHoraire: C("horaires et GPS"),
  JourFerie: C("jours fériés"),
  Pointage: P("pointages"),
  JustificationPointage: P("justifications"),
  CorrectionPointage: P("corrections"),
  Absence: P("absences détectées"),
  PlageAbsenceAutorisee: P("absences déclarées (congés, permissions), y compris celles posées par une demande de congé"),
  DemandeConge: P(
    "demandes de congé et de permission (données de test), avec leurs plages d'absence, leur historique (entité DemandeConge) et leurs notifications (catégorie RH). " +
      "Les paramètres de congés ne sont pas dans cette table : le module n'a ni solde ni nombre de jours par an ; les jours fériés (JourFerie) sont conservés"
  ),
  Feedback: P("avis FeedbackApp"),
  // ---- Techniques
  ExecutionTache: P("historique d'exécution du planificateur (hors empreinte : réécrit en continu)"),
  JournalTechnique: P("incidents techniques (hors empreinte : réécrit en continu)"),
  MarqueurUnique: C("repères uniques (signatures.mise_en_service, pointage.cloture_initiale…)"),
  ReinitialisationSysteme: C("verrou et audit de la réinitialisation globale"),
  ReinitialisationPointage: C("audit des purges du Pointage seul"),
  PointageMiseEnService: C("verrou de mise en service du Pointage"),
  // ---- Encaissements
  EncMiseEnService: C("verrou de mise en service du module : s'il existe, TOUT le module est conservé (triggers d'immuabilité)"),
  EncParametre: C("paramètres du module"),
  EncBranche: C("branches"),
  EncBeneficiaireHonoraires: C("bénéficiaire des honoraires daté"),
  EncPartenaire: C("partenaires et parts d'accessoires (configuration ; ceux créés par un import de test sont à contrôler à la main)"),
  EncTauxControle: C("taux de contrôle"),
  EncSequence: P("compteurs PAI : remis à zéro (recréés à la demande) — seulement avant la mise en service d'Encaissements"),
  EncAudit: P("audit du module — supprimable seulement avant la mise en service d'Encaissements"),
  EncPieceJointe: P("fichiers déposés (imports de test) — seulement avant la mise en service d'Encaissements"),
  EncImport: P("imports de test — seulement avant la mise en service d'Encaissements"),
  EncContrat: P("contrats importés pour test — seulement avant la mise en service d'Encaissements"),
  EncContratMot: P("index de recherche des contrats (supprimé avec eux)"),
  EncEncaissement: P("encaissements de test — seulement avant la mise en service d'Encaissements"),
  EncSignalement: P("signalements d'import de test — seulement avant la mise en service d'Encaissements"),
};

/** Entités de `HistoriqueEntry` supprimées (Trésorerie puis Pointage). */
export const ENTITES_HISTORIQUE_TRESORERIE: string[] = ["Demande", "LigneDemande", "JournalCaisse", "RetourExterne"];
export const ENTITES_HISTORIQUE_POINTAGE: string[] = ["Pointage", "PointageQR", "PointageGeo", "JustificationPointage"];
/**
 * Congés : volontairement SÉPARÉ de `ENTITES_HISTORIQUE_POINTAGE` — la purge du Pointage seul ne touche jamais aux congés
 * (elle est même refusée dès qu'une demande de congé existe, `refusPurgePointageAbsences`) ; seule la réinitialisation globale les efface.
 */
export const ENTITES_HISTORIQUE_CONGES: string[] = ["DemandeConge"];
export const ENTITES_HISTORIQUE_PURGEES: string[] = [...ENTITES_HISTORIQUE_TRESORERIE, ...ENTITES_HISTORIQUE_POINTAGE, ...ENTITES_HISTORIQUE_CONGES];

/**
 * Entités de `HistoriqueEntry` conservées (audit et configuration). Le test de classification vérifie que TOUTE entité écrite
 * dans le code (`entity: "X"` et constantes `ENTITE_*`) figure dans l'une des deux listes.
 */
export const ENTITES_HISTORIQUE_CONSERVEES: string[] = [
  "User",
  "Service",
  "Auth",
  "Objet",
  "Categorie",
  "Role",
  "RolePermission",
  "PermissionDelegation",
  "Module",
  "ReinitialisationSysteme",
  "ReinitialisationPointage",
  "PointageMiseEnService",
  "BudgetParametrage",
  "ParametreTresorerie",
  "SignatureUtilisateur",
];

/** Catégories de notifications supprimées / conservées. */
export const CATEGORIES_NOTIFICATION_PURGEES: Array<"TRESORERIE" | "RH" | "POINTAGE"> = ["TRESORERIE", "RH", "POINTAGE"];
export const CATEGORIES_NOTIFICATION_CONSERVEES: Array<"ADMIN" | "SYSTEME"> = ["ADMIN", "SYSTEME"];
