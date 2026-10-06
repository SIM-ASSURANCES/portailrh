// ".env" chargé depuis la racine du monorepo, pas depuis `backend/`
// (`process.cwd()` lors de `prisma db seed`) — voir CLAUDE.md "Monorepo
// backend/frontend".
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { ENC_MODULE_KEY, ENC_PERMISSIONS, ENC_PERMISSION_MISE_EN_SERVICE, ENC_ROLES_DEPART } from "../src/encPermissions";
import { ENC_PARAMETRES } from "../src/encParametres";
import { ENC_BENEFICIAIRE_HONORAIRES_INITIAL } from "../src/encReferentiels";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = 10;
const TEST_PASSWORD = "password123";

async function main() {
  // Module Encaissements : une base mise en service ne se reseede JAMAIS (audit et séquences verrouillés par trigger).
  // Refus AVANT toute suppression, pour ne rien effacer à moitié.
  if ((await prisma.encMiseEnService.count()) > 0) {
    throw new Error("Module Encaissements mis en service sur cette base : seed refusé, aucune donnée supprimée.");
  }

  console.log("Suppression des données existantes...");

  // Suppression par ordre inverse des dépendances
  await prisma.permissionDelegation.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.module.deleteMany();
  await prisma.historiqueEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.plageAbsenceAutorisee.deleteMany();
  await prisma.depenseLigne.deleteMany();
  await prisma.pieceJointe.deleteMany();
  await prisma.journalCaisse.deleteMany();
  await prisma.retourCaisse.deleteMany();
  await prisma.reglement.deleteMany();
  await prisma.ligneDemande.deleteMany();
  await prisma.demande.deleteMany();
  await prisma.objet.deleteMany();
  await prisma.categorie.deleteMany();
  await prisma.correctionPointage.deleteMany();
  await prisma.pointage.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.jourFerie.deleteMany();
  await prisma.parametrageHoraire.deleteMany();
  // Module Encaissements (socle technique) : relations vers User en RESTRICT, à vider avant les comptes.
  await prisma.encAudit.deleteMany();
  await prisma.encPieceJointe.deleteMany();
  await prisma.encSequence.deleteMany();
  await prisma.encParametre.deleteMany();
  // Module Encaissements (paramètres V2) : EncTauxControle référence EncPartenaire, donc supprimé avant lui.
  await prisma.encTauxControle.deleteMany();
  await prisma.encPartenaire.deleteMany();
  await prisma.encBeneficiaireHonoraires.deleteMany();
  await prisma.encBranche.deleteMany();
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  await prisma.role.deleteMany();

  console.log("Données existantes supprimées.");

  console.log("Création des rôles...");

  const [roleCollaborateur, roleFinance, roleDG, roleAdmin, roleRH, roleAssistantFinance] = await Promise.all([
    prisma.role.upsert({
      where: { name: "Collaborateur" },
      update: {
        description: "Collaborateur pouvant créer des demandes",
        peutEtreBeneficiaireDelegation: true,
      },
      create: {
        name: "Collaborateur",
        description: "Collaborateur pouvant créer des demandes",
        peutEtreBeneficiaireDelegation: true,
      },
    }),
    prisma.role.upsert({
      where: { name: "Finance" },
      update: { description: "Équipe finance / trésorerie : décide (valide, rejette, clôture)" },
      create: { name: "Finance", description: "Équipe finance / trésorerie : décide (valide, rejette, clôture)" },
    }),
    prisma.role.upsert({
      where: { name: "DG" },
      update: { description: "Direction générale" },
      create: { name: "DG", description: "Direction générale" },
    }),
    prisma.role.upsert({
      where: { name: "Admin" },
      // FeedbackApp (voir CLAUDE.md "FeedbackApp") — compte technique, pas
      // un vrai employé à évaluer : jamais proposable comme destinataire.
      // Comparaison sur le nom exact ("Admin"), jamais sur `estAdmin` : un
      // rôle combiné comme "Admin / Collaborateur" représente, lui, un
      // vrai employé et doit rester proposable malgré `estAdmin: true`.
      update: { description: "Administrateur du portail", estAdmin: true, peutRecevoirFeedback: false },
      create: {
        name: "Admin",
        description: "Administrateur du portail",
        estAdmin: true,
        peutRecevoirFeedback: false,
      },
    }),
    prisma.role.upsert({
      where: { name: "RH" },
      update: { description: "Gère le pointage, les retards, absences et reportings RH" },
      create: { name: "RH", description: "Gère le pointage, les retards, absences et reportings RH" },
    }),
    // Séparation stricte des tâches Trésorerie (voir CLAUDE.md "Séparation
    // Responsable Finance / Assistant Finance") — exécute le
    // règlement/décaissement et la réception des retours de caisse,
    // JAMAIS la validation elle-même : réduit le risque de fraude en
    // s'assurant qu'une seule personne ne peut jamais à la fois valider
    // une dépense ET la régler. `peutEtreBeneficiaireDelegation: true` DÈS
    // LA CRÉATION — second cas explicite après "Collaborateur" à déroger à
    // la règle "réservé au rôle Collaborateur" (voir "Délégation
    // individuelle de permissions") : un Responsable Finance doit pouvoir
    // déléguer au cas par cas l'alimentation de caisse/la correction du
    // solde d'ouverture/la dépense directe à son Assistant.
    prisma.role.upsert({
      where: { name: "Assistant Finance" },
      update: {
        description: "Exécute les règlements/décaissements et réceptionne les retours de caisse (séparation des tâches)",
        peutEtreBeneficiaireDelegation: true,
      },
      create: {
        name: "Assistant Finance",
        description: "Exécute les règlements/décaissements et réceptionne les retours de caisse (séparation des tâches)",
        peutEtreBeneficiaireDelegation: true,
      },
    }),
  ]);

  console.log(
    `Rôles créés : ${roleCollaborateur.name}, ${roleFinance.name}, ${roleDG.name}, ${roleAdmin.name}, ${roleRH.name}, ${roleAssistantFinance.name}`
  );

  // Module Encaissements (voir docs/encaissements-conception.md §4) : 3 rôles de départ, modifiables ensuite.
  const rolesEncaissements = await Promise.all(
    ENC_ROLES_DEPART.map((r) =>
      prisma.role.upsert({
        where: { name: r.name },
        update: { description: r.description },
        create: { name: r.name, description: r.description },
      })
    )
  );

  console.log("Création des modules...");

  const [moduleTresorerie, modulePointage, moduleFeedback, moduleSysteme] = await Promise.all([
    prisma.module.upsert({
      where: { key: "tresorerie" },
      update: { label: "Gestion des demandes et trésorerie" },
      create: { key: "tresorerie", label: "Gestion des demandes et trésorerie" },
    }),
    prisma.module.upsert({
      where: { key: "pointage" },
      update: { label: "Pointage RH" },
      create: { key: "pointage", label: "Pointage RH" },
    }),
    prisma.module.upsert({
      where: { key: "feedback" },
      update: { label: "FeedbackApp" },
      create: { key: "feedback", label: "FeedbackApp" },
    }),
    // Module TECHNIQUE (jamais affiché comme carte, voir getAccessibleModules) : réinitialisation à usage unique.
    prisma.module.upsert({
      where: { key: "systeme" },
      update: { label: "Système" },
      create: { key: "systeme", label: "Système" },
    }),
  ]);

  console.log(`Modules créés : ${moduleTresorerie.label}, ${modulePointage.label}, ${moduleFeedback.label}`);

  const moduleEncaissements = await prisma.module.upsert({
    where: { key: ENC_MODULE_KEY },
    update: { label: "Encaissements, taxes et commissions" },
    create: { key: ENC_MODULE_KEY, label: "Encaissements, taxes et commissions" },
  });

  console.log("Création des permissions...");

  const permissionKeys = [
    { key: "treso.creer_demande", label: "Créer une demande", moduleId: moduleTresorerie.id },
    { key: "treso.categoriser_demande", label: "Catégoriser une demande", moduleId: moduleTresorerie.id },
    { key: "treso.valider_demande", label: "Valider une demande", moduleId: moduleTresorerie.id },
    { key: "treso.effectuer_reglement", label: "Effectuer un règlement", moduleId: moduleTresorerie.id },
    { key: "treso.declarer_retour", label: "Déclarer un retour de caisse", moduleId: moduleTresorerie.id },
    { key: "treso.receptionner_retour", label: "Réceptionner un retour de caisse", moduleId: moduleTresorerie.id },
    { key: "treso.cloturer_demande", label: "Clôturer une demande", moduleId: moduleTresorerie.id },
    {
      key: "treso.approuver_validation_complete",
      label: "Approuver la validation complète (verrou de clôture)",
      moduleId: moduleTresorerie.id,
    },
    { key: "treso.saisir_depense_directe", label: "Saisir une dépense directe", moduleId: moduleTresorerie.id },
    {
      key: "treso.alimenter_caisse",
      label: "Enregistrer une alimentation de caisse",
      moduleId: moduleTresorerie.id,
    },
    {
      key: "treso.corriger_solde_ouverture",
      label: "Définir/corriger le solde d'ouverture de caisse",
      moduleId: moduleTresorerie.id,
    },
    { key: "treso.voir_dashboard_finance", label: "Voir le dashboard finance", moduleId: moduleTresorerie.id },
    { key: "treso.voir_reporting", label: "Voir le reporting", moduleId: moduleTresorerie.id },
    {
      key: "treso.gerer_categories",
      label: "Gérer les catégories et objets d'achat (créer/supprimer)",
      moduleId: moduleTresorerie.id,
    },
    // Permissions explicites qui remplacent la règle « Resp » (2026-10-06, migration
    // 20261006100000_tresorerie_permissions_explicites, mêmes libellés).
    { key: "treso.decider_finance", label: "Décider à l'étape Finance (valider ou rejeter les lignes)", moduleId: moduleTresorerie.id },
    { key: "treso.soumettre_dg", label: "Soumettre ou resoumettre une demande au DG", moduleId: moduleTresorerie.id },
    { key: "treso.annuler_reglement", label: "Annuler un règlement confirmé", moduleId: moduleTresorerie.id },
    { key: "treso.ajuster_retour", label: "Ajuster le total déclaré d'un retour de caisse", moduleId: moduleTresorerie.id },
    { key: "treso.valider_remboursement", label: "Valider ou rejeter un remboursement de retour", moduleId: moduleTresorerie.id },
    { key: "treso.valider_retour_exceptionnel", label: "Valider ou rejeter un retour exceptionnel post-clôture", moduleId: moduleTresorerie.id },
    { key: "treso.creer_retour_externe", label: "Enregistrer un retour externe (hors demande)", moduleId: moduleTresorerie.id },
    { key: "treso.modifier_budget_categorie", label: "Modifier le budget d'une catégorie", moduleId: moduleTresorerie.id },
    { key: "treso.deleguer_acces", label: "Déléguer des accès", moduleId: moduleTresorerie.id },
    {
      key: "treso.modifier_description",
      label: "Modifier la description d'une demande et le libellé de ses lignes",
      moduleId: moduleTresorerie.id,
    },
    { key: "pointage.pointer", label: "Pointer (arrivée / départ)", moduleId: modulePointage.id },
    { key: "pointage.consulter_historique", label: "Consulter son propre historique de pointage", moduleId: modulePointage.id },
    { key: "pointage.consulter_tous", label: "Consulter les pointages de tous les employés", moduleId: modulePointage.id },
    { key: "pointage.pointage_exceptionnel", label: "Pointer à la place d'un collaborateur", moduleId: modulePointage.id },
    { key: "pointage.corriger_pointage", label: "Corriger un pointage", moduleId: modulePointage.id },
    { key: "pointage.gerer_horaires", label: "Paramétrer les horaires de référence", moduleId: modulePointage.id },
    { key: "pointage.voir_dashboard_rh", label: "Voir le dashboard RH", moduleId: modulePointage.id },
    { key: "pointage.voir_reporting", label: "Voir le reporting RH", moduleId: modulePointage.id },
    {
      key: "feedback.moderer",
      label: "Modérer les messages FeedbackApp",
      moduleId: moduleFeedback.id,
    },
    {
      key: "systeme.reinitialiser",
      label: "Réinitialiser les données de test avant mise en production (usage unique)",
      moduleId: moduleSysteme.id,
    },
    // Module Encaissements (source unique : src/encPermissions.ts). La mise en service va au module technique « systeme ».
    ...ENC_PERMISSIONS.map((p) => ({ key: p.key, label: p.label, moduleId: moduleEncaissements.id })),
    { ...ENC_PERMISSION_MISE_EN_SERVICE, moduleId: moduleSysteme.id },
  ];

  const createdPermissions = await Promise.all(
    permissionKeys.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: { label: p.label, moduleId: p.moduleId },
        create: {
          key: p.key,
          label: p.label,
          moduleId: p.moduleId,
        },
      })
    )
  );

  const permissionByKey = Object.fromEntries(createdPermissions.map((p) => [p.key, p]));

  console.log(`${createdPermissions.length} permissions créées.`);

  console.log("Attribution des permissions aux rôles...");

  const rolePermissionMap: Record<string, string[]> = {
    [roleCollaborateur.id]: [
      "treso.creer_demande",
      "treso.declarer_retour",
      "pointage.pointer",
      "pointage.consulter_historique",
    ],
    // Responsable Finance : décide (valide/rejette, clôture) — voir
    // CLAUDE.md "Séparation Responsable Finance / Assistant Finance".
    // Retrait assumé (choix produit daté 2026-09-21, PAS un correctif de
    // bug) de "treso.effectuer_reglement"/"treso.receptionner_retour" :
    // désormais l'exclusivité du rôle "Assistant Finance" ci-dessous,
    // pour qu'une seule personne ne puisse jamais à la fois valider une
    // dépense ET la régler.
    [roleFinance.id]: [
      "treso.categoriser_demande",
      "treso.valider_demande",
      "treso.cloturer_demande",
      "treso.alimenter_caisse",
      "treso.corriger_solde_ouverture",
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
      "treso.saisir_depense_directe",
      "treso.gerer_categories",
      // Actions autrefois déduites de « valider_demande sans approuver_validation_complete » (2026-10-06).
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
    ],
    [roleDG.id]: [
      "treso.valider_demande",
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
      "treso.approuver_validation_complete",
      "pointage.consulter_tous",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
      // FeedbackApp (voir CLAUDE.md "FeedbackApp") — décision confirmée :
      // la Direction modère aussi les messages, au même titre que RH.
      "feedback.moderer",
      // Réinitialisation à usage unique : DG SEUL (jamais Admin, jamais héritée d'estAdmin).
      "systeme.reinitialiser",
      // Mise en service du module Encaissements : même modèle, DG seul.
      ENC_PERMISSION_MISE_EN_SERVICE.key,
    ],
    // EXCEPTION DÉLIBÉRÉE à l'invariant "le rôle Admin n'a aucune
    // RolePermission explicite" (voir CLAUDE.md "estAdmin — accès à la
    // console /admin") : décision produit confirmée par le maître de
    // stage le 17/09/2026 (voir CLAUDE.md "FeedbackApp — notation
    // structurée"), jamais l'ancien mécanisme runtime bugué qui
    // réattribuait ceci automatiquement à chaque process (corrigé). Seule
    // exception à ce jour — ne pas y ajouter d'autres permissions
    // `treso.*`/`pointage.*` sans une décision tout aussi explicite.
    [roleAdmin.id]: ["feedback.moderer"],
    [roleRH.id]: [
      "pointage.pointer",
      "pointage.consulter_historique",
      "pointage.consulter_tous",
      "pointage.pointage_exceptionnel",
      "pointage.corriger_pointage",
      "pointage.gerer_horaires",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
      // FeedbackApp (voir CLAUDE.md "FeedbackApp") — attribuée à RH ET DG
      // (voir roleDG.id ci-dessus) : les deux rôles peuvent modérer.
      "feedback.moderer",
    ],
    // Assistant Finance : exécute (règlement/décaissement, réception des
    // retours de caisse) — jamais la validation, jamais par défaut
    // l'alimentation de caisse/la correction du solde d'ouverture/la
    // dépense directe (délégables au cas par cas par le Responsable
    // Finance, voir CLAUDE.md).
    [roleAssistantFinance.id]: ["treso.effectuer_reglement", "treso.receptionner_retour", "treso.modifier_description"],
    // Module Encaissements : un rôle par profil du cahier (§2).
    ...Object.fromEntries(rolesEncaissements.map((role, i) => [role.id, ENC_ROLES_DEPART[i].permissions])),
  };

  let rolePermissionCount = 0;
  for (const [roleId, keys] of Object.entries(rolePermissionMap)) {
    for (const key of keys) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId: permissionByKey[key].id,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId: permissionByKey[key].id,
        },
      });
      rolePermissionCount++;
    }
  }

  console.log(`${rolePermissionCount} attributions rôle-permission créées.`);

  console.log("Création des services...");

  const servicesData = [
    { name: "Commercial" },
    { name: "Finance" },
    { name: "Direction" },
    { name: "Ressources Humaines" },
    { name: "Technique" },
  ];

  const createdServices = await Promise.all(
    servicesData.map((s) =>
      prisma.service.upsert({
        where: { name: s.name },
        update: {},
        create: s,
      })
    )
  );

  const serviceByName = Object.fromEntries(createdServices.map((s) => [s.name, s]));
  console.log(`${createdServices.length} services créés.`);

  console.log("Création des utilisateurs de test...");

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, SALT_ROUNDS);

  const testUsers = [
    { fullName: "Collaborateur Test", email: "collaborateur@simassurances.test", roleId: roleCollaborateur.id, serviceId: serviceByName["Commercial"].id },
    { fullName: "Finance Test", email: "finance@simassurances.test", roleId: roleFinance.id, serviceId: serviceByName["Finance"].id },
    { fullName: "DG Test", email: "dg@simassurances.test", roleId: roleDG.id, serviceId: serviceByName["Direction"].id },
    { fullName: "Admin Test", email: "admin@simassurances.test", roleId: roleAdmin.id, serviceId: null },
    { fullName: "RH Test", email: "rh@simassurances.test", roleId: roleRH.id, serviceId: serviceByName["Ressources Humaines"].id },
    { fullName: "Assistant Finance Test", email: "assistant-finance@simassurances.test", roleId: roleAssistantFinance.id, serviceId: serviceByName["Finance"].id },
    // Module Encaissements : un compte de test par rôle de départ, JAMAIS en production (l'image fixe
    // NODE_ENV=production, y compris pour le service `init` qui exécute ce seed au premier déploiement).
    ...(process.env.NODE_ENV === "production"
      ? []
      : ENC_ROLES_DEPART.map((r, i) => ({ ...r.compteTest, roleId: rolesEncaissements[i].id, serviceId: serviceByName["Finance"].id }))),
  ];

  const createdUsers = await Promise.all(
    testUsers.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {
          fullName: u.fullName,
          passwordHash,
          roleId: u.roleId,
          serviceId: u.serviceId,
          isActive: true,
        },
        create: {
          fullName: u.fullName,
          email: u.email,
          passwordHash,
          roleId: u.roleId,
          serviceId: u.serviceId,
          isActive: true,
        },
      })
    )
  );

  console.log(`${createdUsers.length} utilisateurs créés.`);

  console.log("Création des catégories...");

  const categorieLabels = [
    "Loyers",
    "Publicité",
    "Carburant",
    "Déplacements",
    "Fournitures",
    "Entretien",
    "Missions",
    "Personnel",
    "Prestations",
  ];

  const createdCategories = await Promise.all(
    categorieLabels.map((label) =>
      prisma.categorie.upsert({
        where: { label },
        update: {},
        create: { label },
      })
    )
  );

  const categorieByLabel = Object.fromEntries(createdCategories.map((c) => [c.label, c]));

  console.log(`${createdCategories.length} catégories créées.`);

  console.log("Création des objets d'exemple...");

  const objetsData = [
    { label: "Déplacement équipe commerciale", categorie: "Déplacements" },
    { label: "Mission terrain régionale", categorie: "Déplacements" },
    { label: "Carburant véhicule de liaison", categorie: "Carburant" },
  ];

  const createdObjets = [];
  for (const o of objetsData) {
    const cat = categorieByLabel[o.categorie];
    if (cat) {
      const existing = await prisma.objet.findFirst({
        where: { label: o.label, categorieId: cat.id },
      });
      if (existing) {
        createdObjets.push(existing);
      } else {
        createdObjets.push(
          await prisma.objet.create({
            data: {
              label: o.label,
              categorieId: cat.id,
            },
          })
        );
      }
    }
  }

  console.log(`${createdObjets.length} objets créés.`);

  console.log("Création du paramétrage horaire par défaut...");

  await prisma.parametrageHoraire.deleteMany();
  const parametrageHoraire = await prisma.parametrageHoraire.create({
    data: {
      heureDebutMatin: "07:45",
      heureFinMatin: "12:15",
      heureDebutApresMidi: "13:15",
      heureFinApresMidi: "16:45",
    },
  });

  console.log(
    `Paramétrage horaire créé : ${parametrageHoraire.heureDebutMatin}-${parametrageHoraire.heureFinMatin} / ${parametrageHoraire.heureDebutApresMidi}-${parametrageHoraire.heureFinApresMidi}`
  );

  // Module Encaissements : paramètres par défaut (source unique : src/encParametres.ts, aussi posés par la migration).
  await prisma.encParametre.createMany({ data: ENC_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut })) });
  console.log(`Paramètres Encaissements : ${ENC_PARAMETRES.length}`);

  // Bénéficiaire des honoraires (CDC §3.6) : NOVELIA, posé une seule fois — `creeParId` nul (aucun utilisateur réel à
  // cet instant, seul cas où ce champ est nul), même valeur que la migration corrective
  // `20260930000000_encaissements_parametres_v2` (source unique : ENC_BENEFICIAIRE_HONORAIRES_INITIAL, encReferentiels.ts).
  await prisma.encBeneficiaireHonoraires.create({
    data: {
      nom: ENC_BENEFICIAIRE_HONORAIRES_INITIAL.nom,
      dateDebut: new Date(ENC_BENEFICIAIRE_HONORAIRES_INITIAL.dateDebut),
    },
  });
  console.log(`Bénéficiaire des honoraires initial : ${ENC_BENEFICIAIRE_HONORAIRES_INITIAL.nom}`);

  console.log("\n=== Résumé du seed ===");
  console.log(`Rôles : ${createdUsers.length === 5 ? 5 : "?"}`);
  console.log(`Modules : ${moduleTresorerie.label}, ${modulePointage.label}`);
  console.log(`Permissions : ${createdPermissions.length}`);
  console.log(`Attributions rôle-permission : ${rolePermissionCount}`);
  console.log(`Catégories : ${createdCategories.length}`);
  console.log(`Objets : ${createdObjets.length}`);
  console.log(`Paramétrage horaire par défaut : 1`);
  console.log("\nComptes de test (mot de passe pour tous : password123) :");
  for (const u of testUsers) {
    console.log(`  - ${u.email}`);
  }
}

main()
  .catch((e) => {
    console.error("Erreur lors du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
