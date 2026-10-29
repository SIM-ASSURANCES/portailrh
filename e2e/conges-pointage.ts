// Congés — T08 : « En congé » dans la présence du jour, « Mon équipe » et le reporting du Pointage,
// sur une base PostgreSQL jetable, sans navigateur. Lancé depuis frontend/ (lit chargerPresenceJour).
//
//   cd frontend && DATABASE_URL=postgresql://…/conges_jetable npx tsx ../e2e/conges-pointage.ts
//
// Garde : le nom de la base doit contenir « jetable », « e2e » ou « conges ». Un jour ouvré est nécessaire (aujourd'hui et demain).

import {
  getReportingAgrégé,
  prisma,
  saisirCongeRH,
  soumettreConge,
  transactionConge,
  type EntreeConge,
} from "backend";
import { chargerPresenceJour } from "../frontend/src/lib/presenceJour";

const url = process.env.DATABASE_URL ?? "";
if (!/(jetable|e2e|conges)/i.test(url.split("/").pop() ?? "")) {
  console.error("Refus : DATABASE_URL doit viser une base jetable (nom contenant jetable, e2e ou conges).");
  process.exit(2);
}

let ok = 0;
let ko = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  if (condition) {
    ok++;
    console.log(`  ok   ${nom}`);
  } else {
    ko++;
    console.log(`  ECHEC ${nom}`, detail ?? "");
  }
}

const jc = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const id = async (email: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email: `${email}@simassurances.test` } })).id;

async function main() {
  const aujourdhui = new Date();
  if ([0, 5, 6].includes(aujourdhui.getDay())) {
    console.error("Lancer un jour du lundi au jeudi (le congé testé couvre aujourd'hui et demain).");
    process.exit(2);
  }
  const demain = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() + 1);
  const j0 = jc(aujourdhui);
  const j1 = jc(demain);

  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  await prisma.pointage.deleteMany({});
  await prisma.absence.deleteMany({});
  await prisma.jourFerie.deleteMany({});

  const collab = await id("collaborateur");
  const marketing = await id("responsable-marketing");
  const tech = await id("responsable-technique");
  const rh = await id("rh");
  // Option B : un compte créé aujourd'hui n'est jamais absent ; on l'antidate pour que la règle n'influe pas.
  await prisma.user.updateMany({ data: { createdAt: new Date(2025, 0, 1) } });

  const entree = (motif: string): EntreeConge => ({ nature: "CONGE", motif, dateDebut: j0, dateFin: j1 });

  // Congé VALIDÉ du collaborateur (saisi par la RH), aujourd'hui et demain.
  const valide = await transactionConge((tx) =>
    saisirCongeRH(tx, { acteurId: rh, userId: collab, entree: entree("Congé validé T08"), maintenant: new Date() })
  );
  if (!valide.ok) throw new Error(valide.erreur);
  // Second congé VALIDÉ (responsable marketing), pendant lequel il pointe pourtant son arrivée (R13).
  const valide2 = await transactionConge((tx) =>
    saisirCongeRH(tx, { acteurId: rh, userId: marketing, entree: entree("Congé validé T08 bis"), maintenant: new Date() })
  );
  if (!valide2.ok) throw new Error(valide2.erreur);
  // Congé EN ATTENTE du responsable technique (plages provisoires).
  const attente = await transactionConge((tx) =>
    soumettreConge(tx, { userId: tech, entree: entree("Congé en attente T08"), maintenant: new Date() })
  );
  if (!attente.ok) throw new Error(attente.erreur);

  // Le responsable marketing pointe son arrivée aujourd'hui ; une ligne Absence existe à tort pour les deux comptes en congé.
  const huit = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate(), 8, 0);
  await prisma.pointage.create({ data: { type: "ARRIVEE", source: "ORDINATEUR", heure: huit, userId: marketing } });
  const minuit = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  await prisma.absence.createMany({ data: [{ userId: collab, date: minuit }, { userId: marketing, date: minuit }] });

  console.log("Présence du jour");
  const jour = await chargerPresenceJour(new Date());
  const autCollab = jour.autorises.find((a) => a.userId === collab);
  const autTech = jour.autorises.find((a) => a.userId === tech);
  verifier("congé validé : dans « Absence autorisée », état EN_CONGE", autCollab?.etatConge === "EN_CONGE", autCollab);
  verifier(
    "libellé « En congé (référence) »",
    autCollab?.absenceAutorisee === `En congé (${valide.valeur.reference})`,
    autCollab?.absenceAutorisee
  );
  verifier("congé validé : jamais dans les absents", !jour.absents.some((a) => a.userId === collab), jour.absents);
  verifier("congé en attente : état EN_ATTENTE", autTech?.etatConge === "EN_ATTENTE", autTech);
  verifier(
    "libellé « Congé en attente de validation »",
    (autTech?.absenceAutorisee ?? "").startsWith("Congé en attente de validation"),
    autTech?.absenceAutorisee
  );
  verifier("congé en attente : ni absent ni manquant", ![...jour.absents, ...jour.manquants].some((a) => a.userId === tech));
  const presMarketing = jour.presents.find((p) => p.userId === marketing);
  verifier("arrivée pendant un congé validé : présente et signalée", presMarketing?.pointeEnConge === true, presMarketing);
  verifier("pointé pendant son congé : jamais absent non plus", !jour.absents.some((a) => a.userId === marketing));
  verifier("un compte présent hors congé n'est pas signalé", jour.presents.every((p) => p.userId === marketing || !p.pointeEnConge));

  console.log("Restriction « Mon équipe » (userIds)");
  const equipe = await chargerPresenceJour(new Date(), [tech]);
  verifier(
    "seul le membre demandé apparaît",
    equipe.autorises.length === 1 && equipe.autorises[0].userId === tech && equipe.presents.length === 0
  );

  console.log("Reporting");
  const avecConge = await getReportingAgrégé({ dateDebut: j0, dateFin: j1 } as never);
  const rCollab = avecConge.find((r) => r.id === collab);
  const rMarketing = avecConge.find((r) => r.id === marketing);
  const rTech = avecConge.find((r) => r.id === tech);
  verifier("2 jours de congé validé comptés", rCollab?.joursConge === 2, rCollab);
  verifier("aucun jour pointé pendant le congé du collaborateur", rCollab?.joursPointesEnConge === 0, rCollab);
  verifier("1 jour pointé pendant le congé du responsable marketing", rMarketing?.joursConge === 2 && rMarketing?.joursPointesEnConge === 1, rMarketing);
  verifier("congé en attente : 0 jour de congé", rTech?.joursConge === 0 && rTech?.joursPointesEnConge === 0, rTech);
  verifier(
    "comptes sans congé : 0 partout",
    avecConge.filter((r) => r.id !== collab && r.id !== marketing).every((r) => r.joursConge === 0 && r.joursPointesEnConge === 0)
  );

  const avant = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() - 7);
  const sansConge = await getReportingAgrégé({ dateDebut: jc(avant), dateFin: jc(avant) } as never);
  verifier(
    "période sans congé : aucun jour de congé, aucun retard ni absence",
    sansConge.every((r) => r.joursConge === 0 && r.joursPointesEnConge === 0 && r.absences === 0 && r.joursRetard === 0)
  );

  console.log(`\n${ok} ok, ${ko} échec(s)`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
