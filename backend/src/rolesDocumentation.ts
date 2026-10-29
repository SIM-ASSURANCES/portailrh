/**
 * Génération de `docs/roles-et-permissions.md` (lot R) : document destiné à la personne qui règle à la main les rôles de la
 * production dans /admin/roles. Tout vient de `rolesCibles.ts` (rôles, permissions, modules) ; ce fichier n'ajoute que le
 * texte lisible (ce que permet chaque permission, lu dans le code qui l'utilise), les mises en garde et les points
 * « À VALIDER PAR LE DG ».
 *
 * Le document est généré (`npx tsx prisma/generer-doc-roles.ts`) et un test (`rolesDocumentation.test.ts`) échoue s'il
 * n'est plus à jour : on ne modifie jamais le .md à la main.
 */
import {
  MODULES_CATALOGUE,
  PERMISSIONS_CATALOGUE,
  ROLES_CIBLES,
  permissionsNonCochables,
  type CleModule,
  type PermissionCatalogue,
  type RoleCible,
} from "./rolesCibles";

/** Ce que permet chaque permission, en une phrase simple, d'après le code qui la lit (état au 2026-10-22). */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  // Trésorerie
  "treso.creer_demande": "Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes.",
  "treso.categoriser_demande": "Choisir la catégorie et l'objet de chaque article d'une demande (et en créer à la volée).",
  "treso.valider_demande":
    "Ouvre les écrans Finance des demandes (liste « Toutes les demandes », reçus, pièces jointes, retours en lecture seule) et permet de valider ou rejeter une dépense directe. La décision sur les articles d'une demande passe par `treso.decider_finance`.",
  "treso.effectuer_reglement": "Créer, modifier, confirmer (décaisser) un règlement, Caisse ou Banque. Jamais sur sa propre demande.",
  "treso.declarer_retour": "Déclarer un retour de caisse sur ses propres demandes réglées (date et montant).",
  "treso.receptionner_retour":
    "Réceptionner un retour de caisse, détailler les dépenses d'un fonds remis, marquer une dépense « sans pièce formelle », déclarer à la place du collaborateur, saisir un retour exceptionnel après clôture.",
  "treso.cloturer_demande": "Clôturer une demande (totale, partielle ou forcée) une fois tous les articles terminés et le DG ayant approuvé.",
  "treso.approuver_validation_complete":
    "Approuver la validation complète d'une demande (verrou de clôture) ; le rejeter ou l'annuler. Réservée au DG.",
  "treso.saisir_depense_directe": "Créer une dépense directe (prime, dotation carburant…) pour un bénéficiaire qui n'intervient pas.",
  "treso.alimenter_caisse": "Enregistrer une alimentation de caisse (apport d'argent physique, pièce justificative obligatoire).",
  "treso.corriger_solde_ouverture": "Définir puis corriger le solde d'ouverture de la caisse (pièce justificative et motif).",
  "treso.voir_dashboard_finance": "Voir l'Accueil Finance (indicateurs, graphiques, solde de caisse) et consulter les listes Finance.",
  "treso.voir_reporting": "Voir et exporter le reporting Trésorerie (tableau unique et fichier Excel).",
  "treso.gerer_categories":
    "Créer et supprimer des catégories et des objets d'achat, les désactiver ou réactiver, régler la date de catégorisation obligatoire.",
  "treso.decider_finance": "Décider à l'étape Finance : valider ou rejeter chaque article d'une demande. Non délégable.",
  "treso.soumettre_dg": "Soumettre (ou resoumettre) un article ou une demande au DG, avec le motif. Non délégable.",
  "treso.annuler_reglement": "Annuler un règlement confirmé (écriture compensatoire dans la caisse).",
  "treso.ajuster_retour": "Ajuster le total déclaré d'un retour de caisse.",
  "treso.valider_remboursement": "Valider ou rejeter un remboursement de retour (correction d'un retour déjà réceptionné).",
  "treso.valider_retour_exceptionnel": "Valider ou rejeter un retour exceptionnel après clôture (entrée en caisse à la validation).",
  "treso.creer_retour_externe": "Enregistrer un retour externe (argent revenu hors demande, ex. chèque), rattaché ou non à une demande.",
  "treso.modifier_budget_categorie":
    "Paramétrer les budgets de catégorie et les seuils du budget de caisse (soumis ensuite à la validation du DG).",
  "treso.deleguer_acces": "Ouvrir l'écran « Déléguer des accès » et déléguer certaines permissions à un autre compte.",
  "treso.decider_dg":
    "Décider à l'étape DG : valider ou rejeter les articles soumis, confirmer un dépassement de budget, renvoyer à la Finance. Non délégable.",
  "treso.reorienter_demande": "Réorienter l'étape Service d'une demande vers un autre responsable (le demandeur peut réorienter la sienne sans cette permission).",
  "treso.valider_budget": "Valider ou rejeter un paramétrage de budget (catégories et seuils de caisse). Réservée au DG.",
  "treso.modifier_description": "Modifier la description d'une demande et le libellé de ses articles (les deux versions restent visibles).",
  // Pointage
  "pointage.pointer": "Pointer son arrivée et son départ (QR code, ordinateur, géolocalisation).",
  "pointage.consulter_historique": "Consulter son propre historique de pointage.",
  "pointage.consulter_tous": "Consulter les pointages de tous les employés (présence du jour).",
  "pointage.pointage_exceptionnel": "Pointer à la place d'un collaborateur (régularisation exceptionnelle).",
  "pointage.corriger_pointage":
    "Corriger un pointage (registre tracé), traiter les absences, décider les justifications en repli du responsable de service.",
  "pointage.gerer_horaires": "Régler les horaires de référence, la tolérance et la géolocalisation du bureau.",
  "pointage.voir_dashboard_rh": "Voir le tableau de bord RH (présences, retards, absences).",
  "pointage.voir_reporting": "Voir et exporter le reporting RH du pointage.",
  "pointage.reinitialiser": "Purger les données du Pointage avant sa mise en service, puis le mettre en service. Jamais délégable.",
  // Congés
  "conges.soumettre": "Demander un congé et consulter les siens.",
  "conges.valider_rh": "Valider un congé à l'étape RH et enregistrer un congé pour un salarié. Non délégable, lue sur le rôle.",
  "conges.annuler": "Annuler un congé, même déjà commencé (demandeur : seulement avant le début, sans cette permission).",
  "conges.consulter_tous": "Consulter les congés de tous les employés et les exporter.",
  // Encaissements
  "enc.consulter": "Encaissements : consulter les polices, le registre, les signalements et exporter.",
  "enc.importer_production": "Encaissements : déposer le fichier de production et la reprise ; télécharger les fichiers importés.",
  "enc.annuler_contrat": "Encaissements : annuler un contrat. Sert aussi à reconnaître un import de l'Équipe technique.",
  "enc.saisir_encaissement": "Encaissements : saisir un versement depuis la fiche d'une police.",
  "enc.confirmer_paiement": "Encaissements : confirmer ou marquer « non reçu » les paiements, ligne par ligne ou par lot ; importer un relevé.",
  "enc.corriger_encaissement":
    "Encaissements : corriger ou contre-passer un encaissement. Aucun écran ne l'utilise encore (prévu au lot 4 du module).",
  "enc.gerer_non_identifie":
    "Encaissements : gérer l'argent non identifié (affecter, classer hors prime). Aucun écran ne l'utilise encore.",
  "enc.marquer_paye":
    "Encaissements : marquer payés taxes, commissions, honoraires et accessoires. Aucun écran ne l'utilise encore (prévu au lot 4).",
  "enc.parametrer": "Encaissements : paramétrer branches, honoraires, partage des accessoires et taux de contrôle.",
  "enc.mettre_en_service":
    "Encaissements : mettre le module en service (remise à zéro à usage unique). Aucun écran ne l'utilise encore. DG seul.",
  // Autres
  "feedback.moderer": "Modérer les messages de FeedbackApp (masquer, rétablir) et exporter.",
  "systeme.reinitialiser":
    "Remise à zéro globale de mise en production (écran « Réinitialisation »), usage unique. DG seul, jamais déléguée, jamais cochable dans /admin/roles.",
};

/** Permissions qui ne doivent être portées que par le DG. */
export const PERMISSIONS_DG_SEUL: readonly { cle: string; raison: string }[] = [
  { cle: "treso.valider_budget", raison: "le DG valide les budgets et les seuils ; la Finance les paramètre sans pouvoir les valider (séparation des tâches)" },
  { cle: "treso.approuver_validation_complete", raison: "verrou de clôture : si la Finance la porte, elle approuve ce qu'elle clôture" },
  { cle: "treso.decider_dg", raison: "étape DG du circuit de validation" },
  { cle: "systeme.reinitialiser", raison: "remise à zéro globale à usage unique" },
  { cle: "enc.mettre_en_service", raison: "mise en service du module Encaissements (usage unique)" },
];

/** Couples INTERDITS connus (jamais sur un même rôle). */
export const COUPLES_INTERDITS: readonly { roles: string; cle: string; raison: string }[] = [
  { roles: "Finance", cle: "treso.approuver_validation_complete", raison: "la Finance clôture : elle ne doit pas aussi approuver la clôture" },
  { roles: "Admin", cle: "treso.approuver_validation_complete", raison: "compte technique : aucun pouvoir de décision métier" },
  { roles: "Finance", cle: "treso.decider_dg", raison: "la Finance décide à l'étape Finance, le DG à l'étape DG" },
  { roles: "Finance", cle: "treso.valider_budget", raison: "la Finance paramètre les budgets, le DG les valide" },
  { roles: "DG", cle: "treso.valider_demande", raison: "retirée du DG depuis le 2026-10-08 (le DG décide par `treso.decider_dg`)" },
  { roles: "DG", cle: "conges.valider_rh", raison: "l'étape RH des congés est celle de la RH ; le DG n'y décide qu'en repli, par `treso.decider_dg`" },
  { roles: "Assistant Finance", cle: "treso.decider_finance", raison: "l'Assistant exécute (règlement, retours), il ne décide pas : séparation des tâches" },
  { roles: "Assistant Finance", cle: "treso.valider_demande", raison: "même raison : valider et régler ne doivent pas être la même personne" },
  { roles: "Admin", cle: "systeme.reinitialiser", raison: "la remise à zéro globale est réservée au DG" },
];

/** Où chaque permission récente est créée : une permission absente de /admin/roles = migration non appliquée. */
export const PERMISSIONS_RECENTES: readonly { lot: string; migration: string; cles: readonly string[] }[] = [
  {
    lot: "Circuit de validation (2026-10-06 à 2026-10-08)",
    migration: "20261006100000_tresorerie_permissions_explicites, 20261006120000_circuit_validation_demandes",
    cles: [
      "treso.decider_finance",
      "treso.soumettre_dg",
      "treso.annuler_reglement",
      "treso.ajuster_retour",
      "treso.valider_remboursement",
      "treso.valider_retour_exceptionnel",
      "treso.creer_retour_externe",
      "treso.modifier_budget_categorie",
      "treso.deleguer_acces",
      "treso.modifier_description",
      "treso.decider_dg",
    ],
  },
  { lot: "Lot J — budgets", migration: "20261023090000_budgets_parametrage", cles: ["treso.valider_budget"] },
  { lot: "Lot K — réorientation et reprise", migration: "20261026090000_circuit_reorientation_reprise", cles: ["treso.reorienter_demande"] },
  { lot: "Pointage — purge du Pointage seul", migration: "20261014120000_pointage_reinitialisation", cles: ["pointage.reinitialiser"] },
  {
    lot: "Module Congés",
    migration: "20261030090000_conges_permissions_absence",
    cles: ["conges.soumettre", "conges.valider_rh", "conges.annuler", "conges.consulter_tous"],
  },
];

export interface PointAValider {
  id: string;
  titre: string;
  texte: string;
}

/** Cas où le code ne tranche pas : à faire valider par le DG avant de régler la production. */
export const POINTS_A_VALIDER: readonly PointAValider[] = [
  {
    id: "V1",
    titre: "Pointage des équipes Finance, Assistant Finance, DG et Encaissements",
    texte:
      "Ces rôles ne portent ni `pointage.pointer` ni `pointage.consulter_historique`. Si leurs membres doivent pointer, créer un rôle combiné ou cocher ces deux permissions sur le rôle. Le code ne décide pas qui pointe ; c'est une décision d'organisation.",
  },
  {
    id: "V2",
    titre: "Compte Admin : `feedback.moderer` et `pointage.reinitialiser`",
    texte:
      "Le rôle Admin porte ces deux permissions par décision datée (17/09/2026 et 14/10/2026), contrairement à la règle « Admin sans permission métier ». Conséquence : tout compte du rôle Admin peut modérer FeedbackApp et purger le Pointage tant qu'il n'est pas en service. À confirmer, ou à décocher dans /admin/roles.",
  },
  {
    id: "V3",
    titre: "Permissions Encaissements sans écran",
    texte:
      "`enc.corriger_encaissement`, `enc.gerer_non_identifie`, `enc.marquer_paye` et `enc.mettre_en_service` ne sont lues par aucun écran à ce jour (lots 3 et 4 du module non livrés). Elles sont cochées sur Encaissements – Finance (les trois premières) et sur le DG (la dernière) d'après le cahier des charges ; rien ne dépend d'elles tant que les écrans n'existent pas.",
  },
  {
    id: "V4",
    titre: "Qui accède à l'Accueil Finance",
    texte:
      "L'Assistant Finance n'a pas `treso.voir_dashboard_finance` : il n'a donc pas d'« Accueil Finance » (seulement « Accueil »). Le DG et la Finance l'ont. Décision de permission, pas de libellé : à confirmer.",
  },
  {
    id: "V5",
    titre: "Congés des rôles estAdmin",
    texte:
      "Un rôle « Administrateur » (`estAdmin`) ne reçoit que `conges.soumettre`. `conges.valider_rh`, `conges.annuler` et `conges.consulter_tous` se cochent à la main ; ils ne doivent pas l'être pour un compte technique. Vérifier quels comptes de la production portent un rôle `estAdmin` : ils pourront demander un congé.",
  },
  {
    id: "V6",
    titre: "Un seul rôle par compte et rôles combinés",
    texte:
      "Un compte n'a qu'un rôle. Une personne qui cumule des fonctions (ex. Finance et RH, Encaissements et Collaborateur) exige un rôle combiné créé dans /admin/roles. Éviter les combinaisons qui contournent la séparation des tâches : `treso.decider_finance` avec `treso.decider_dg`, ou `treso.decider_finance` avec `treso.effectuer_reglement`. Le code applique la règle « deux personnes » par compte, mais un rôle combiné rend la séparation fragile.",
  },
  {
    id: "V7",
    titre: "Responsable de service",
    texte:
      "« Responsable de service » n'est pas un rôle : il est désigné dans Admin > Services (`Service.responsableId`) et n'a besoin d'aucune permission pour valider l'étape Service, décider les justifications de pointage de son équipe et les congés de son service. Les comptes responsables du seed portent le rôle Collaborateur. À confirmer qu'aucun rôle dédié n'est voulu.",
  },
  {
    id: "V8",
    titre: "Rôle RH et DG sur les congés",
    texte:
      "La RH décide l'étape RH des congés (`conges.valider_rh`, `conges.annuler`). Le DG n'y décide qu'en repli, quand aucun autre compte RH n'existe (point ouvert O1 du module Congés, provisoire). À confirmer.",
  },
  {
    id: "V9",
    titre: "Rôles Encaissements",
    texte:
      "Trois rôles de départ (Équipe technique : consulter, importer la production, annuler un contrat ; Finance : tout le reste sauf l'annulation de contrat ; Consultation : consulter seulement). Le DG n'a aucune permission `enc.*` hormis `enc.mettre_en_service` : il ne consulte pas le module Encaissements avec son rôle actuel. Si le DG ou une autre personne doit y accéder, créer un rôle combiné. À confirmer.",
  },
  {
    id: "V10",
    titre: "Permissions attribuées par la migration sur une production déjà seedée",
    texte:
      "La production n'est plus re-seedée : seules les migrations y ajoutent des permissions, en les donnant aux rôles qui portent la permission « sœur ». Si un rôle de la production a été modifié à la main depuis le premier seed (cases cochées ou décochées dans /admin/roles), il peut différer de ce document. Comparer avec `roles-et-permissions-base.md` (script `lister-roles-permissions.ts`) avant de cocher.",
  },
];

const ORDRE_MODULES: CleModule[] = ["tresorerie", "pointage", "conges", "encaissements", "feedback", "systeme"];

const TITRE_MODULE: Record<string, string> = {
  tresorerie: "Trésorerie",
  pointage: "Pointage",
  conges: "Congés",
  encaissements: "Encaissements",
  feedback: "Feedback",
  systeme: "Système",
};

function titreModule(cle: string): string {
  return TITRE_MODULE[cle] ?? cle;
}

function parModule(permissions: readonly PermissionCatalogue[]): Map<string, PermissionCatalogue[]> {
  const m = new Map<string, PermissionCatalogue[]>();
  for (const cle of ORDRE_MODULES) m.set(cle, []);
  for (const p of permissions) {
    const liste = m.get(p.moduleKey) ?? [];
    liste.push(p);
    m.set(p.moduleKey, liste);
  }
  return m;
}

/** Rôles qui portent une permission, dans l'ordre de `ROLES_CIBLES`. */
export function rolesPortant(cle: string, roles: readonly RoleCible[] = ROLES_CIBLES): string[] {
  return roles.filter((r) => r.permissions.includes(cle)).map((r) => r.name);
}

/** Nombre de permissions d'un rôle par module (clé de module du catalogue). */
export function decompteParModule(role: RoleCible): Record<string, number> {
  const parCle = new Map(PERMISSIONS_CATALOGUE.map((p) => [p.key, p.moduleKey]));
  const out: Record<string, number> = {};
  for (const k of role.permissions) {
    const m = parCle.get(k);
    if (m) out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

/** Nombre de permissions du catalogue par module. */
export function decompteCatalogueParModule(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PERMISSIONS_CATALOGUE) out[p.moduleKey] = (out[p.moduleKey] ?? 0) + 1;
  return out;
}

function echapperCellule(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function sectionRole(role: RoleCible): string {
  const catalogue = new Map(PERMISSIONS_CATALOGUE.map((p) => [p.key, p]));
  const portees = role.permissions.map((k) => catalogue.get(k)!).filter(Boolean);
  const lignes: string[] = [];
  lignes.push(`### ${role.name}`);
  lignes.push("");
  lignes.push(`${role.description}.`);
  lignes.push("");
  lignes.push(
    `- Accès à la console d'administration (« Administrateur », fixé à la création) : **${role.estAdmin ? "oui" : "non"}**`,
    `- Peut être bénéficiaire d'une délégation : **${role.peutEtreBeneficiaireDelegation ? "oui" : "non"}**`,
    `- Peut recevoir un feedback (FeedbackApp) : **${role.peutRecevoirFeedback ? "oui" : "non"}**`,
    `- Nombre de permissions à cocher : **${portees.length}**`
  );
  lignes.push("");
  const groupes = parModule(portees);
  for (const [cle, liste] of groupes) {
    if (liste.length === 0) continue;
    lignes.push(`**${titreModule(cle)}** (${liste.length})`);
    lignes.push("");
    for (const p of liste) lignes.push(`- [ ] \`${p.key}\` — ${DESCRIPTIONS[p.key]}`);
    lignes.push("");
  }
  if (role.estAdmin) {
    lignes.push(
      "L'accès à la console `/admin` vient du réglage « Administrateur » du rôle, pas d'une case à cocher. Ce rôle ne doit porter aucune autre permission métier que celles ci-dessus."
    );
    lignes.push("");
  }
  return lignes.join("\n");
}

/** Contenu complet de `docs/roles-et-permissions.md`. Pur et déterministe. */
export function genererDocRoles(): string {
  const catalogue = parModule(PERMISSIONS_CATALOGUE);
  const modulesLabel = new Map(MODULES_CATALOGUE.map((m) => [m.key, m.label]));
  const nonCochables = new Set(permissionsNonCochables());
  const comptes = decompteCatalogueParModule();
  const o: string[] = [];

  o.push("# Rôles et permissions du portail — liste à cocher pour la production");
  o.push("");
  o.push(
    "> Document **généré** à partir de `backend/src/rolesCibles.ts` (`npx tsx prisma/generer-doc-roles.ts`). Ne pas le modifier à la main : un test échoue s'il n'est plus à jour."
  );
  o.push("");
  o.push("**Pour qui ?** Le DG ou l'Admin qui règle les rôles de la production dans l'application (`/admin/roles`). La production n'est pas re-seedée : ce document dit ce que chaque rôle doit porter.");
  o.push("");
  o.push("**Comment l'utiliser.**");
  o.push("");
  o.push("1. Lancer `npx tsx prisma/lister-roles-permissions.ts` (lecture seule) pour obtenir `roles-et-permissions-base.md`, l'état réel de la production, et le comparer à ce document ; le script signale lui-même les écarts.");
  o.push("2. Dans `/admin/roles`, ouvrir chaque rôle et cocher ou décocher pour que la section du rôle ci-dessous soit respectée exactement. Chaque case s'applique tout de suite (pas de bouton « Enregistrer »).");
  o.push("3. Lire les encadrés « Permissions réservées » et « Vérifier avant de cocher » avant de commencer.");
  o.push("");
  o.push("Les permissions du module « Système » (`systeme.reinitialiser`, `enc.mettre_en_service`) n'apparaissent **pas** dans `/admin/roles` : elles sont posées par le seed ou la migration et ne se cochent pas à la main.");
  o.push("");
  o.push(`Total : **${PERMISSIONS_CATALOGUE.length} permissions** réparties ainsi : ${ORDRE_MODULES.filter((c) => comptes[c]).map((c) => `${titreModule(c)} ${comptes[c]}`).join(", ")}.`);
  o.push("");

  // Encadré permissions réservées
  o.push("## Permissions réservées");
  o.push("");
  o.push("> ⚠️ **Ne doivent être portées que par le DG :**");
  o.push(">");
  for (const r of PERMISSIONS_DG_SEUL) o.push(`> - \`${r.cle}\` — ${r.raison}.`);
  o.push(">");
  o.push("> **Couples INTERDITS (jamais sur le même rôle) :**");
  o.push(">");
  for (const c of COUPLES_INTERDITS) o.push(`> - Le rôle **${c.roles}** ne doit **pas** porter \`${c.cle}\` — ${c.raison}.`);
  o.push(">");
  o.push("> **Sur la production déjà en service, vérifier en priorité** : d'anciennes bases ont vu **Finance et Admin porter `treso.approuver_validation_complete`** et le DG porter `treso.valider_demande`. Aucune migration ne retire la première ; la migration `20261008090000_valider_demande_retiree_du_dg` retire la seconde. Décocher à la main si besoin.");
  o.push("");
  o.push("Ne sont **jamais délégables** (même cochées, l'octroi est impossible) : `treso.decider_finance`, `treso.soumettre_dg`, `treso.decider_dg`, `treso.approuver_validation_complete`, `conges.valider_rh`, `pointage.reinitialiser`.");
  o.push("");

  // Encadré à vérifier avant de cocher
  o.push("## Vérifier avant de cocher");
  o.push("");
  o.push("> Une permission **absente de `/admin/roles`** signifie que **sa migration n'est pas encore appliquée** : la personne qui déploie doit lancer `prisma migrate deploy` avant de régler les rôles. Permissions créées par les migrations récentes :");
  o.push(">");
  for (const r of PERMISSIONS_RECENTES) {
    o.push(`> - **${r.lot}** — migration \`${r.migration}\` : ${r.cles.map((c) => `\`${c}\``).join(", ")}.`);
  }
  o.push(">");
  o.push("> Après `prisma migrate deploy`, ces permissions existent mais **les rôles ne les portent que si la migration les a données** (par permission « sœur », jamais par nom de rôle). Vérifier chaque section de rôle ci-dessous.");
  o.push("");

  // Rôles
  o.push("## Rôles");
  o.push("");
  o.push("Tous les rôles du seed (6 rôles du portail puis les 3 rôles Encaissements). « Responsable de service » n'est pas un rôle (voir point V7).");
  o.push("");
  for (const role of ROLES_CIBLES) o.push(sectionRole(role));

  o.push("### Responsable de service (pas un rôle)");
  o.push("");
  o.push("Un responsable de service est désigné dans **Admin > Services** (champ responsable). Il n'a besoin d'**aucune permission** pour valider l'étape Service des demandes de son équipe, décider les justifications de pointage de son équipe, décider les congés de son service et consulter « Mon équipe ». Son compte porte un rôle ordinaire (Collaborateur dans le seed). **Rien à cocher.**");
  o.push("");

  // Synthèse par rôle
  o.push("## Synthèse : nombre de permissions par rôle et par module");
  o.push("");
  const mods = ORDRE_MODULES.filter((c) => comptes[c]);
  o.push(`| Rôle | ${mods.map(titreModule).join(" | ")} | Total |`);
  o.push(`|---|${mods.map(() => "---:").join("|")}|---:|`);
  for (const r of ROLES_CIBLES) {
    const d = decompteParModule(r);
    o.push(`| ${r.name} | ${mods.map((c) => d[c] ?? 0).join(" | ")} | ${r.permissions.length} |`);
  }
  o.push(`| **Catalogue** | ${mods.map((c) => comptes[c] ?? 0).join(" | ")} | ${PERMISSIONS_CATALOGUE.length} |`);
  o.push("");

  // Points à valider
  o.push("## À VALIDER PAR LE DG");
  o.push("");
  o.push("Cas où le code ne tranche pas : une décision de l'organisation est nécessaire avant de régler la production.");
  o.push("");
  for (const p of POINTS_A_VALIDER) {
    o.push(`- **À VALIDER PAR LE DG — ${p.id}. ${p.titre}.** ${p.texte}`);
  }
  o.push("");

  // Écarts seed / migrations
  o.push("## Écarts entre le seed et les migrations");
  o.push("");
  o.push("Vérifié le 2026-10-22 sur deux bases jetables : (1) toutes les migrations seules ; (2) une simulation de production (seed du 2026-09-17, puis toutes les migrations). Résultat :");
  o.push("");
  o.push("- Les **76 attributions rôle ↔ permission** de la simulation de production sont **identiques** à celles d'une base neuve seedée (donc à ce document), sauf ce qui suit.");
  o.push("- **Rôles créés par le seed seulement** : Collaborateur, Finance, DG, Admin, RH. Aucune migration ne les crée : sur une base vide migrée sans seed, ils n'existent pas. Les rôles **Assistant Finance** et **Encaissements** (3) sont créés par des migrations (et par le seed).");
  o.push("- **Permissions créées par le seed seulement** : les 8 permissions `pointage.*` d'origine (le module Pointage est posé par le seed). `pointage.reinitialiser` est créée par migration à condition que le module `pointage` existe ; les 43 autres permissions sont créées par des migrations.");
  o.push("- **Libellés** : identiques entre le seed et les migrations pour les 43 permissions créées par les deux.");
  o.push("- **Non modifié par les migrations** : `treso.approuver_validation_complete` n'est jamais retirée à Finance ou Admin si une ancienne base la leur avait donnée (voir « Permissions réservées »).");
  o.push("- **Libellé de module** : le module Congés s'appelle « Congés » ; le module Trésorerie « Gestion des demandes et trésorerie » ; Encaissements « Encaissements, taxes et commissions ».");
  o.push("");

  // Tableau
  o.push("## Tableau des permissions");
  o.push("");
  o.push("| Clé | Module | Libellé dans /admin/roles | Ce qu'elle permet | Rôles qui la portent |");
  o.push("|---|---|---|---|---|");
  for (const cle of ORDRE_MODULES) {
    for (const p of catalogue.get(cle) ?? []) {
      const libelleAdmin = nonCochables.has(p.key) ? "*(non affichée : module Système)*" : p.label;
      const roles = rolesPortant(p.key);
      o.push(
        `| \`${p.key}\` | ${modulesLabel.get(p.moduleKey) ?? p.moduleKey} | ${echapperCellule(libelleAdmin)} | ${echapperCellule(DESCRIPTIONS[p.key])} | ${roles.length ? roles.join(", ") : "—"} |`
      );
    }
  }
  o.push("");
  return o.join("\n");
}
