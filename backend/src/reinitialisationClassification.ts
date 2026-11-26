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
  FeedbackQuota: C("traces chiffrées de la limite d'un avis par jour : ni purgées ni sauvegardées ici, la purge quotidienne les vide chaque nuit"),
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
  // ---- Gestion Compta (docs/compta-conception.md §8.3) : TOUTES conservées par la purge globale. Le module est indépendant
  // et a sa propre remise à zéro avant sa mise en service (lot GC-11, même précédent que la purge du Pointage seul) ;
  // la purge globale n'est donc jamais modifiée pour lui.
  CptMiseEnService: C("verrou de mise en service de Gestion Compta : s'il existe, TOUT le module est conservé (triggers d'immuabilité)"),
  CptSequence: C("compteurs de numérotation de Gestion Compta : remise à zéro propre au module (lot GC-11)"),
  CptParametre: C("paramètres de Gestion Compta"),
  CptAudit: C("audit de Gestion Compta : remise à zéro propre au module avant sa mise en service (lot GC-11)"),
  CptPieceJointe: C("pièces jointes de Gestion Compta : remise à zéro propre au module (lot GC-11)"),
  CptPeriode: C("périodes comptables de Gestion Compta : une période clôturée est définitive (trigger)"),
  CptFormatImport: C("formats d'import de Gestion Compta : paramétrage, jamais des données de test"),
  // GC-2 : référentiels. Conservés par la purge globale ; le module a sa propre remise à zéro (lot GC-11).
  CptPartenaire: C("partenaires de Gestion Compta : référentiel, remise à zéro propre au module (lot GC-11)"),
  CptClient: C("clients de Gestion Compta : référentiel, remise à zéro propre au module (lot GC-11)"),
  CptProduit: C("produits de Gestion Compta : référentiel, remise à zéro propre au module (lot GC-11)"),
  CptTauxTca: C("taux de TCA datés : jamais modifiés (trigger), remise à zéro propre au module (lot GC-11)"),
  CptCompte: C("comptes d'encaissement de Gestion Compta : référentiel, remise à zéro propre au module (lot GC-11)"),
  CptConvention: C("conventions de rémunération : seule la date de fin change (trigger), remise à zéro propre au module (lot GC-11)"),
  CptMot: C("index de recherche des référentiels de Gestion Compta (dérivé des fiches), remise à zéro propre au module (lot GC-11)"),
  // GC-3 : production. Conservée par la purge globale ; le module a sa propre remise à zéro (lot GC-11).
  CptContrat: C("contrats de Gestion Compta : remise à zéro propre au module (lot GC-11), jamais supprimés après la mise en service (trigger)"),
  CptActe: C("actes sur les contrats : ajout seul (trigger), remise à zéro propre au module (lot GC-11)"),
  CptEcheance: C("échéances des contrats : remise à zéro propre au module (lot GC-11), jamais supprimées après la mise en service (trigger)"),
  CptImport: C("imports de fichiers de Gestion Compta (empreinte anti-doublon) : remise à zéro propre au module (lot GC-11)"),
  CptAnomalie: C("anomalies d'import et de saisie de Gestion Compta : remise à zéro propre au module (lot GC-11)"),
  // GC-4 : encaissements et relevés. Conservés par la purge globale ; le module a sa propre remise à zéro (lot GC-11).
  CptEncaissement: C("lignes d'encaissement de Gestion Compta : champs jamais modifiés (trigger), remise à zéro propre au module (lot GC-11)"),
  CptReleve: C("relevés importés de Gestion Compta : jamais modifiés (trigger), remise à zéro propre au module (lot GC-11)"),
  CptTransfertInterne: C("virements internes entre comptes de Gestion Compta : jamais modifiés (trigger), remise à zéro propre au module (lot GC-11)"),
  CptCheque: C("chèques reçus de Gestion Compta : remise à zéro propre au module (lot GC-11), jamais supprimés après la mise en service (trigger)"),
  // GC-5 : rattachements (proposition du moteur, confirmation du commercial, validation du RFCRH).
  CptRattachement: C("rattachements encaissement ↔ échéance de Gestion Compta : statut définitif une fois validé ou rejeté (trigger), remise à zéro propre au module (lot GC-11)"),
  CptAlerteControle: C("paliers de relance du contrôle hebdomadaire de Gestion Compta (une ligne par palier réservé) : remise à zéro propre au module (lot GC-11)"),
  // GC-7d : relances faites hors de l'application et promesses de paiement.
  CptRelance: C("relances de clients enregistrées dans Gestion Compta (ajout seul, jamais modifiées) : remise à zéro propre au module (lot GC-11), jamais supprimées après la mise en service (trigger)"),
  CptPromesse: C("promesses de paiement de clients de Gestion Compta : statut final posé par la règle d'évaluation, remise à zéro propre au module (lot GC-11), jamais supprimées après la mise en service (trigger)"),
  // GC-8 : taxe sur les contrats.
  CptLigneTaxe: C("lignes de taxe (TCA) de Gestion Compta : ajout seul, verrouillées une fois déclarées (trigger), remise à zéro propre au module (lot GC-11), jamais supprimées après la mise en service (trigger)"),
  CptDeclarationTca: C("déclarations mensuelles de TCA de Gestion Compta : montants figés, seul le paiement s'ajoute (trigger), remise à zéro propre au module (lot GC-11)"),
  CptCreditTaxe: C("crédits de taxe (trop-payé reporté) de Gestion Compta : remise à zéro propre au module (lot GC-11)"),
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
