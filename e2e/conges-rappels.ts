/**
 * Vérification sur base PostgreSQL jetable (T10) : rappel quotidien des demandes de congé en attente (`executerRappelsConges`).
 *
 * À lancer depuis `frontend/` (pour la résolution de `@/lib/...`) :
 *   DATABASE_URL="postgresql://.../conges_jetable?schema=public" npx tsx ../e2e/conges-rappels.ts
 * Refus immédiat si le nom de la base ne contient ni `jetable` ni `test`.
 */

const dbUrl = process.env.DATABASE_URL ?? "";
const dbName = dbUrl.split("/").pop()?.split("?")[0] ?? "";
if (!dbName || (!dbName.includes("jetable") && !dbName.includes("test"))) {
  console.error(`Refus : DATABASE_URL (${dbName || "absente"}) n'est pas une base jetable.`);
  process.exit(1);
}

import {
  ajouterJours,
  comptesActifsAvecPermission,
  deciderConge,
  formatJourCivil,
  PERMISSION_ETAPE_RH_CONGE,
  prisma,
  soumettreConge,
  transactionConge,
} from "backend";
import { executerRappelsConges } from "../frontend/src/lib/taches/rappelsConges";

let ok = 0;
const erreurs: string[] = [];

function verifier(nom: string, condition: boolean, detail?: unknown) {
  if (condition) {
    ok++;
    console.log(`OK — ${nom}`);
  } else {
    const msg = `${nom}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ""}`;
    erreurs.push(msg);
    console.error(`ÉCHEC — ${msg}`);
  }
}

async function main() {
  const maintenant = new Date();
  const aujourdhui = formatJourCivil(maintenant);
  const ilYA25h = new Date(maintenant.getTime() - 25 * 60 * 60 * 1000);

  const [collabCommercial, respCommercial, respTechnique, rhIds] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "collaborateur@simassurances.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "responsable-commercial@simassurances.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "responsable-technique@simassurances.test" } }),
    comptesActifsAvecPermission(prisma, PERMISSION_ETAPE_RH_CONGE),
  ]);

  // Nettoyage initial des demandes de congé et notifications RH de test.
  await prisma.notification.deleteMany({ where: { category: "RH" } });
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: { not: null } } });
  await prisma.demandeConge.deleteMany({});

  // 1) Création avec `soumettreConge` :
  //    - collaborateur de Commercial (attend `responsable-commercial@`), commence demain (J+1 → priorité IMPORTANT) ;
  //    - `responsable-technique@` (attend la RH), commence dans 10 jours (J+10 → priorité INFO).
  const demain = ajouterJours(aujourdhui, 1);
  const dans10Jours = ajouterJours(aujourdhui, 10);

  const rCollab = await transactionConge((tx) =>
    soumettreConge(tx, {
      userId: collabCommercial.id,
      maintenant,
      entree: {
        nature: "CONGE",
        motif: "Congé commençant demain (test rappel)",
        dateDebut: demain,
        dateFin: ajouterJours(demain, 4),
      },
    })
  );
  if (!rCollab.ok) throw new Error(`Échec soumission collaborateur : ${rCollab.erreur}`);

  const rRespTech = await transactionConge((tx) =>
    soumettreConge(tx, {
      userId: respTechnique.id,
      maintenant,
      entree: {
        nature: "CONGE",
        motif: "Congé dans dix jours (test rappel RH)",
        dateDebut: dans10Jours,
        dateFin: ajouterJours(dans10Jours, 4),
      },
    })
  );
  if (!rRespTech.ok) throw new Error(`Échec soumission responsable technique : ${rRespTech.erreur}`);

  verifier(
    "1. Statuts initiaux : EN_ATTENTE_RESPONSABLE (collaborateur) et EN_ATTENTE_RH (responsable technique)",
    rCollab.valeur.statut === "EN_ATTENTE_RESPONSABLE" && rRespTech.valeur.statut === "EN_ATTENTE_RH",
    { collab: rCollab.valeur.statut, respTech: rRespTech.valeur.statut }
  );

  // Demandes VALIDEE et REJETEE (même antidatées de 25 h : jamais de rappel).
  const rValidee = await transactionConge(async (tx) => {
    const s = await soumettreConge(tx, {
      userId: respCommercial.id,
      maintenant,
      entree: {
        nature: "PERMISSION_EXCEPTIONNELLE",
        motif: "Demande déjà validée",
        dateDebut: ajouterJours(aujourdhui, 20),
        dateFin: ajouterJours(aujourdhui, 24),
      },
    });
    await deciderConge(tx, {
      demandeId: s.id,
      acteur: { id: rhIds[0], rolePermissions: [PERMISSION_ETAPE_RH_CONGE] },
      action: { type: "APPROUVER" },
      peutAnnulerApresDebut: true,
      maintenant,
    });
    return s;
  });
  if (!rValidee.ok) throw new Error(`Échec demande validée : ${rValidee.erreur}`);

  const rRejetee = await transactionConge(async (tx) => {
    const s = await soumettreConge(tx, {
      userId: respCommercial.id,
      maintenant,
      entree: {
        nature: "CONGE",
        motif: "Demande déjà rejetée",
        dateDebut: ajouterJours(aujourdhui, 30),
        dateFin: ajouterJours(aujourdhui, 34),
      },
    });
    await deciderConge(tx, {
      demandeId: s.id,
      acteur: { id: rhIds[0], rolePermissions: [PERMISSION_ETAPE_RH_CONGE] },
      action: { type: "REJETER", motif: "Refus pour test de non-rappel" },
      peutAnnulerApresDebut: true,
      maintenant,
    });
    return s;
  });
  if (!rRejetee.ok) throw new Error(`Échec demande rejetée : ${rRejetee.erreur}`);

  // Antidate `etapeDepuis` de 25 h sur toutes les demandes et vide les notifications avant le test du rappel.
  await prisma.demandeConge.updateMany({
    data: { etapeDepuis: ilYA25h, dernierRappelAt: null },
  });
  await prisma.notification.deleteMany({ where: { category: "RH" } });

  // 2) Premier passage de `executerRappelsConges()`.
  const bilan1 = await executerRappelsConges();
  verifier(
    "2. Premier passage : 2 demandes en attente examinées, 2 rappels envoyés, 0 erreur",
    bilan1.examinees === 2 && bilan1.rappels === 2 && bilan1.sansDestinataire === 0 && bilan1.erreurs === 0,
    bilan1
  );

  const notifs1 = await prisma.notification.findMany({
    where: { category: "RH", titre: "Demande de congé en attente" },
  });
  const notifsCollab = notifs1.filter((n) => n.lien === `/conges/${rCollab.valeur.id}`);
  const notifsRespTech = notifs1.filter((n) => n.lien === `/conges/${rRespTech.valeur.id}`);
  const notifsValideeOuRejetee = notifs1.filter(
    (n) => n.lien === `/conges/${rValidee.valeur.id}` || n.lien === `/conges/${rRejetee.valeur.id}`
  );

  verifier(
    "3. Demande du collaborateur Commercial : 1 notification au seul responsable commercial, jamais au demandeur",
    notifsCollab.length === 1 &&
      notifsCollab[0].userId === respCommercial.id &&
      notifsCollab.every((n) => n.userId !== collabCommercial.id),
    notifsCollab.map((n) => n.userId)
  );

  const rhAttendus = rhIds.filter((id) => id !== respTechnique.id).sort();
  const rhRecus = notifsRespTech.map((n) => n.userId).sort();
  verifier(
    "4. Demande du responsable technique : 1 notification à chaque compte RH, jamais au demandeur",
    rhRecus.length === rhAttendus.length &&
      rhRecus.every((id, i) => id === rhAttendus[i]) &&
      notifsRespTech.every((n) => n.userId !== respTechnique.id),
    { rhRecus, rhAttendus }
  );

  verifier(
    "5. Demandes VALIDEE et REJETEE : jamais de rappel",
    notifsValideeOuRejetee.length === 0,
    notifsValideeOuRejetee
  );

  verifier(
    "6. Priorité : IMPORTANT quand le congé commence demain, INFO quand il commence dans 10 jours",
    notifsCollab[0]?.priority === "IMPORTANT" && notifsRespTech.every((n) => n.priority === "INFO"),
    { collabPriority: notifsCollab[0]?.priority, rhPriorities: notifsRespTech.map((n) => n.priority) }
  );

  // 3) Relance immédiate → 0 rappel (moins de 24 h).
  const bilan2 = await executerRappelsConges();
  const countApresRelance = await prisma.notification.count({
    where: { category: "RH", titre: "Demande de congé en attente" },
  });
  verifier(
    "7. Relance immédiate (< 24 h) : 0 rappel envoyé, aucune notification supplémentaire",
    bilan2.rappels === 0 && countApresRelance === notifs1.length,
    { bilan2, countApresRelance, avant: notifs1.length }
  );

  // 4) Remise de `dernierRappelAt` à nul + deux exécutions simultanées (`Promise.all`) → une seule notification par destinataire.
  await prisma.notification.deleteMany({ where: { category: "RH" } });
  await prisma.demandeConge.updateMany({
    where: { id: { in: [rCollab.valeur.id, rRespTech.valeur.id] } },
    data: { dernierRappelAt: null, etapeDepuis: ilYA25h },
  });

  const [bilanA, bilanB] = await Promise.all([executerRappelsConges(), executerRappelsConges()]);
  const notifsConcurrentes = await prisma.notification.findMany({
    where: { category: "RH", titre: "Demande de congé en attente" },
  });
  const notifsCollabConc = notifsConcurrentes.filter((n) => n.lien === `/conges/${rCollab.valeur.id}`);
  const notifsRespTechConc = notifsConcurrentes.filter((n) => n.lien === `/conges/${rRespTech.valeur.id}`);

  verifier(
    "8. Deux exécutions simultanées (Promise.all) : 2 rappels au total et une seule notification par destinataire",
    bilanA.rappels + bilanB.rappels === 2 &&
      notifsCollabConc.length === 1 &&
      notifsRespTechConc.length === rhAttendus.length,
    {
      rappelsA: bilanA.rappels,
      rappelsB: bilanB.rappels,
      notifsCollabConc: notifsCollabConc.length,
      notifsRespTechConc: notifsRespTechConc.length,
    }
  );

  // Nettoyage final.
  await prisma.notification.deleteMany({ where: { category: "RH" } });
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: { not: null } } });
  await prisma.demandeConge.deleteMany({});

  console.log(`\nBilan conges-rappels : ${ok}/${ok + erreurs.length} contrôles réussis.`);
  if (erreurs.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

