import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = 10;
const TEST_PASSWORD = "password123";

async function main() {
  console.log("Suppression des données existantes...");

  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.module.deleteMany();
  await prisma.historiqueEntry.deleteMany();
  await prisma.retourCaisse.deleteMany();
  await prisma.reglement.deleteMany();
  await prisma.pieceJointe.deleteMany();
  await prisma.demande.deleteMany();
  await prisma.objet.deleteMany();
  await prisma.categorie.deleteMany();
  await prisma.correctionPointage.deleteMany();
  await prisma.pointage.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.parametrageHoraire.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  console.log("Données existantes supprimées.");

  console.log("Création des rôles...");

  const [roleCollaborateur, roleFinance, roleDG, roleAdmin, roleRH] = await Promise.all([
    prisma.role.create({ data: { name: "Collaborateur", description: "Collaborateur pouvant créer des demandes" } }),
    prisma.role.create({ data: { name: "Finance", description: "Équipe finance / trésorerie" } }),
    prisma.role.create({ data: { name: "DG", description: "Direction générale" } }),
    prisma.role.create({ data: { name: "Admin", description: "Administrateur du portail" } }),
    prisma.role.create({
      data: { name: "RH", description: "Gère le pointage, les retards, absences et reportings RH" },
    }),
  ]);

  console.log(
    `Rôles créés : ${roleCollaborateur.name}, ${roleFinance.name}, ${roleDG.name}, ${roleAdmin.name}, ${roleRH.name}`
  );

  console.log("Création des modules...");

  const [moduleTresorerie, modulePointage] = await Promise.all([
    prisma.module.create({
      data: { key: "tresorerie", label: "Gestion des demandes et trésorerie" },
    }),
    prisma.module.create({
      data: { key: "pointage", label: "Pointage RH" },
    }),
  ]);

  console.log(`Modules créés : ${moduleTresorerie.label}, ${modulePointage.label}`);

  console.log("Création des permissions...");

  const permissionKeys = [
    { key: "treso.creer_demande", label: "Créer une demande", moduleId: moduleTresorerie.id },
    { key: "treso.categoriser_demande", label: "Catégoriser une demande", moduleId: moduleTresorerie.id },
    { key: "treso.valider_demande", label: "Valider une demande", moduleId: moduleTresorerie.id },
    { key: "treso.effectuer_reglement", label: "Effectuer un règlement", moduleId: moduleTresorerie.id },
    { key: "treso.declarer_retour", label: "Déclarer un retour de caisse", moduleId: moduleTresorerie.id },
    { key: "treso.receptionner_retour", label: "Réceptionner un retour de caisse", moduleId: moduleTresorerie.id },
    { key: "treso.cloturer_demande", label: "Clôturer une demande", moduleId: moduleTresorerie.id },
    { key: "treso.voir_dashboard_finance", label: "Voir le dashboard finance", moduleId: moduleTresorerie.id },
    { key: "treso.voir_reporting", label: "Voir le reporting", moduleId: moduleTresorerie.id },
    { key: "pointage.pointer", label: "Pointer (arrivée / départ)", moduleId: modulePointage.id },
    { key: "pointage.consulter_historique", label: "Consulter son propre historique de pointage", moduleId: modulePointage.id },
    { key: "pointage.consulter_tous", label: "Consulter les pointages de tous les employés", moduleId: modulePointage.id },
    { key: "pointage.pointage_exceptionnel", label: "Pointer à la place d'un collaborateur", moduleId: modulePointage.id },
    { key: "pointage.corriger_pointage", label: "Corriger un pointage", moduleId: modulePointage.id },
    { key: "pointage.gerer_horaires", label: "Paramétrer les horaires de référence", moduleId: modulePointage.id },
    { key: "pointage.voir_dashboard_rh", label: "Voir le dashboard RH", moduleId: modulePointage.id },
    { key: "pointage.voir_reporting", label: "Voir le reporting RH", moduleId: modulePointage.id },
  ];

  const createdPermissions = await Promise.all(
    permissionKeys.map((p) =>
      prisma.permission.create({
        data: {
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
    [roleFinance.id]: [
      "treso.categoriser_demande",
      "treso.valider_demande",
      "treso.effectuer_reglement",
      "treso.receptionner_retour",
      "treso.cloturer_demande",
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
    ],
    [roleDG.id]: [
      "treso.valider_demande",
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
      // Consultation seule côté RH pour la Direction générale, cohérent avec
      // "consultation selon les droits accordés" du cahier des charges.
      "pointage.consulter_tous",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
    ],
    [roleRH.id]: [
      "pointage.pointer",
      "pointage.consulter_historique",
      "pointage.consulter_tous",
      "pointage.pointage_exceptionnel",
      "pointage.corriger_pointage",
      "pointage.gerer_horaires",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
    ],
    // Le rôle Admin n'a délibérément aucune permission de module ici : son
    // accès à la console d'administration est un bypass basé sur
    // role.name === "Admin" (voir isAdmin() dans src/lib/auth.ts), pas sur
    // le système RolePermission. getAccessibleModules() lui montre malgré
    // tout tous les modules actifs (vue d'ensemble Admin), sans que cela
    // ne lui donne les permissions métier de ces modules.
  };

  let rolePermissionCount = 0;
  for (const [roleId, keys] of Object.entries(rolePermissionMap)) {
    for (const key of keys) {
      await prisma.rolePermission.create({
        data: {
          roleId,
          permissionId: permissionByKey[key].id,
        },
      });
      rolePermissionCount++;
    }
  }

  console.log(`${rolePermissionCount} attributions rôle-permission créées.`);

  console.log("Création des utilisateurs de test...");

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, SALT_ROUNDS);

  const testUsers = [
    { fullName: "Collaborateur Test", email: "collaborateur@simassurances.test", roleId: roleCollaborateur.id },
    { fullName: "Finance Test", email: "finance@simassurances.test", roleId: roleFinance.id },
    { fullName: "DG Test", email: "dg@simassurances.test", roleId: roleDG.id },
    { fullName: "Admin Test", email: "admin@simassurances.test", roleId: roleAdmin.id },
    { fullName: "RH Test", email: "rh@simassurances.test", roleId: roleRH.id },
  ];

  const createdUsers = await Promise.all(
    testUsers.map((u) =>
      prisma.user.create({
        data: {
          fullName: u.fullName,
          email: u.email,
          passwordHash,
          roleId: u.roleId,
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
    categorieLabels.map((label) => prisma.categorie.create({ data: { label } }))
  );

  const categorieByLabel = Object.fromEntries(createdCategories.map((c) => [c.label, c]));

  console.log(`${createdCategories.length} catégories créées.`);

  console.log("Création des objets d'exemple...");

  const objetsData = [
    { label: "Déplacement équipe commerciale", categorie: "Déplacements" },
    { label: "Mission terrain régionale", categorie: "Déplacements" },
    { label: "Carburant véhicule de liaison", categorie: "Carburant" },
  ];

  const createdObjets = await Promise.all(
    objetsData.map((o) =>
      prisma.objet.create({
        data: {
          label: o.label,
          categorieId: categorieByLabel[o.categorie].id,
        },
      })
    )
  );

  console.log(`${createdObjets.length} objets créés.`);

  console.log("Création du paramétrage horaire par défaut...");

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
