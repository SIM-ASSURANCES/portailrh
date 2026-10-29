// ".env" chargé depuis la racine du monorepo, pas depuis `backend/`
// (`process.cwd()` lors de `prisma db seed`) — voir CLAUDE.md "Monorepo
// backend/frontend".
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { ENC_ROLES_DEPART } from "../src/encPermissions";
import { MODULES_CATALOGUE, PERMISSIONS_CATALOGUE, ROLES_CIBLES } from "../src/rolesCibles";
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
  // Congés : les demandes avant les comptes (supprimés plus bas).
  await prisma.demandeConge.deleteMany();
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
  await prisma.justificationPointage.deleteMany();
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
  // Un service pointe vers son responsable (clé RESTRICT) : le détacher avant de supprimer les comptes.
  await prisma.service.updateMany({ data: { responsableId: null } });
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  await prisma.role.deleteMany();

  console.log("Données existantes supprimées.");

  console.log("Création des rôles...");

  // Source unique des rôles, modules et permissions : src/rolesCibles.ts (aussi lue par docs/roles-et-permissions.md et par
  // le script de comparaison lister-roles-permissions.ts). Même contenu qu'avant, déplacé tel quel.
  const rolesParNom: Record<string, { id: string; name: string }> = {};
  for (const r of ROLES_CIBLES) {
    const donnees = {
      description: r.description,
      estAdmin: r.estAdmin,
      peutEtreBeneficiaireDelegation: r.peutEtreBeneficiaireDelegation,
      peutRecevoirFeedback: r.peutRecevoirFeedback,
    };
    rolesParNom[r.name] = await prisma.role.upsert({ where: { name: r.name }, update: donnees, create: { name: r.name, ...donnees } });
  }
  const roleCollaborateur = rolesParNom["Collaborateur"];
  const roleFinance = rolesParNom["Finance"];
  const roleDG = rolesParNom["DG"];
  const roleAdmin = rolesParNom["Admin"];
  const roleRH = rolesParNom["RH"];
  const roleAssistantFinance = rolesParNom["Assistant Finance"];
  // Module Encaissements (voir docs/encaissements-conception.md §4) : 3 rôles de départ, modifiables ensuite.
  const rolesEncaissements = ENC_ROLES_DEPART.map((r) => rolesParNom[r.name]);

  console.log(`Rôles créés : ${ROLES_CIBLES.map((r) => r.name).join(", ")}`);

  console.log("Création des modules...");

  const modulesParCle: Record<string, { id: string; label: string }> = {};
  for (const m of MODULES_CATALOGUE) {
    modulesParCle[m.key] = await prisma.module.upsert({
      where: { key: m.key },
      update: { label: m.label },
      create: { key: m.key, label: m.label },
    });
  }
  const moduleTresorerie = modulesParCle["tresorerie"];
  const modulePointage = modulesParCle["pointage"];

  console.log(`Modules créés : ${MODULES_CATALOGUE.map((m) => m.label).join(", ")}`);

  console.log("Création des permissions...");

  const createdPermissions = await Promise.all(
    PERMISSIONS_CATALOGUE.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: { label: p.label, moduleId: modulesParCle[p.moduleKey].id },
        create: { key: p.key, label: p.label, moduleId: modulesParCle[p.moduleKey].id },
      })
    )
  );

  const permissionByKey = Object.fromEntries(createdPermissions.map((p) => [p.key, p]));

  console.log(`${createdPermissions.length} permissions créées.`);

  console.log("Attribution des permissions aux rôles...");

  // Congés compris : calculés par permission sœur dans ROLES_CIBLES (même règle que la migration), jamais par nom de rôle.
  let rolePermissionCount = 0;
  for (const r of ROLES_CIBLES) {
    const roleId = rolesParNom[r.name].id;
    for (const key of r.permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permissionByKey[key].id } },
        update: {},
        create: { roleId, permissionId: permissionByKey[key].id },
      });
      rolePermissionCount++;
    }
  }

  console.log(`${rolePermissionCount} attributions rôle-permission créées.`);

  console.log("Création des services...");

  // Les 8 services (migration 20261006110000_services_responsables, mêmes noms).
  const servicesData = [
    { name: "Commercial" },
    { name: "Informatique" },
    { name: "Direction DG" },
    { name: "Finance" },
    { name: "RH" },
    { name: "Technique" },
    { name: "Comptabilité" },
    { name: "Marketing" },
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
    { fullName: "DG Test", email: "dg@simassurances.test", roleId: roleDG.id, serviceId: serviceByName["Direction DG"].id },
    { fullName: "Admin Test", email: "admin@simassurances.test", roleId: roleAdmin.id, serviceId: serviceByName["Informatique"].id },
    { fullName: "RH Test", email: "rh@simassurances.test", roleId: roleRH.id, serviceId: serviceByName["RH"].id },
    // Responsable du service Commercial (circuit de validation) : un Collaborateur, sans nouveau rôle.
    {
      fullName: "Responsable Commercial Test",
      email: "responsable-commercial@simassurances.test",
      roleId: roleCollaborateur.id,
      serviceId: serviceByName["Commercial"].id,
    },
    // Responsables de Technique, Comptabilité et Marketing : même principe (Collaborateurs, membres de leur service).
    {
      fullName: "Responsable Technique Test",
      email: "responsable-technique@simassurances.test",
      roleId: roleCollaborateur.id,
      serviceId: serviceByName["Technique"].id,
    },
    {
      fullName: "Responsable Comptabilité Test",
      email: "responsable-comptabilite@simassurances.test",
      roleId: roleCollaborateur.id,
      serviceId: serviceByName["Comptabilité"].id,
    },
    {
      fullName: "Responsable Marketing Test",
      email: "responsable-marketing@simassurances.test",
      roleId: roleCollaborateur.id,
      serviceId: serviceByName["Marketing"].id,
    },
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

  // Responsables de service (étape « Service » du circuit de validation) : chacun des 8 services en a un. Le cas
  // « service sans responsable » se teste sur une base jetable, en retirant le responsable dans le test.
  const userByEmail = Object.fromEntries(createdUsers.map((u) => [u.email, u]));
  const responsables: [string, string][] = [
    ["Commercial", "responsable-commercial@simassurances.test"],
    ["Finance", "finance@simassurances.test"],
    ["Direction DG", "dg@simassurances.test"],
    ["RH", "rh@simassurances.test"],
    ["Informatique", "admin@simassurances.test"],
    ["Technique", "responsable-technique@simassurances.test"],
    ["Comptabilité", "responsable-comptabilite@simassurances.test"],
    ["Marketing", "responsable-marketing@simassurances.test"],
  ];
  for (const [service, email] of responsables) {
    await prisma.service.update({ where: { id: serviceByName[service].id }, data: { responsableId: userByEmail[email].id } });
  }
  console.log(`${responsables.length} responsables de service désignés.`);

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
