// Congés / permissions — A3 (relecture du 2026-10-16) : UN SEUL verrou par collaborateur pour les congés ET les permissions.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:45497/e2e npx tsx e2e/absence-verrou-commun.ts
//
// Un congé et une permission soumis au même instant pour le même compte, le même jour : un seul doit passer, l'autre
// reçoit le message de chevauchement. Plusieurs tours pour que la course ait réellement lieu. Base jetable seulement.

import { prisma, soumettreConge, soumettrePermission, accorderCongeOffice, transactionAbsence } from "../backend/src/index";

const url = process.env.DATABASE_URL ?? "";
if (!/(jetable|e2e|conges)/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
  console.error("Refus : DATABASE_URL doit viser une base jetable (nom contenant jetable, e2e ou conges).");
  process.exit(2);
}

const TOURS = Number(process.env.TOURS ?? 20);
let ok = 0;
let ko = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  if (condition) {
    ok++;
  } else {
    ko++;
    console.log(`  ECHEC ${nom}`, detail ?? "");
  }
}

function jourLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Un mercredi dans 3 à 5 semaines : jour ouvré, hors passé. */
function mercredi(decalageSemaines: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalageSemaines * 7 - ((d.getDay() + 4) % 7));
  return jourLocal(d);
}

async function main() {
  const collab = await prisma.user.findUniqueOrThrow({ where: { email: "collaborateur@simassurances.test" } });
  const rh = await prisma.user.findUniqueOrThrow({ where: { email: "rh@simassurances.test" } });
  const typeConge = await prisma.typeConge.findFirstOrThrow({ where: { code: "SANS_SOLDE" } });
  const typePermission = await prisma.typePermission.findFirstOrThrow({ where: { label: "Rendez-vous médical" } });
  await prisma.typePermission.update({ where: { id: typePermission.id }, data: { plafondMensuel: 50, dureeMaxHeures: 4, isActive: true } });
  const maintenant = new Date();

  const nettoyer = async () => {
    await prisma.plageAbsenceAutorisee.deleteMany({ where: { OR: [{ demandeCongeId: { not: null } }, { demandePermissionId: { not: null } }] } });
    await prisma.demandePermission.deleteMany({});
    await prisma.pieceJointeConge.deleteMany({});
    await prisma.demandeConge.deleteMany({});
  };
  await nettoyer();

  const conge = (jour: string) =>
    transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: typeConge.id, dateDebut: jour, dateFin: jour, motif: "Course congé" }, maintenant }));
  const permission = (jour: string) =>
    transactionAbsence((tx) =>
      soumettrePermission(tx, { userId: collab.id, entree: { typePermissionId: typePermission.id, date: jour, heureDepart: "09:00", heureRetourPrevue: "11:00", motif: "Course permission" }, maintenant })
    );
  const office = (jour: string) =>
    transactionAbsence((tx) => accorderCongeOffice(tx, { acteurId: rh.id, userId: collab.id, entree: { typeCongeId: typeConge.id, dateDebut: jour, dateFin: jour, motif: "Course office" }, maintenant }));

  let victoiresConge = 0;
  let victoiresPermission = 0;
  for (let i = 0; i < TOURS; i++) {
    const jour = mercredi(3 + (i % 3));
    await nettoyer();
    const [c, p] = await Promise.all([conge(jour), permission(jour)]);
    const gagnants = [c.ok, p.ok].filter(Boolean).length;
    verifier(`tour ${i} (congé + permission) : un seul passe`, gagnants === 1, { conge: c.ok ? "ok" : c.erreur, permission: p.ok ? "ok" : p.erreur });
    if (!c.ok) verifier(`tour ${i} : le congé refusé donne le message de chevauchement`, /permission d'absence existe déjà/.test(c.erreur), c.erreur);
    if (!p.ok) verifier(`tour ${i} : la permission refusée donne le message de chevauchement`, /congé est déjà demandé ou validé/.test(p.erreur), p.erreur);
    if (c.ok) victoiresConge++;
    if (p.ok) victoiresPermission++;
    const nbConges = await prisma.demandeConge.count({ where: { userId: collab.id } });
    const nbPerms = await prisma.demandePermission.count({ where: { userId: collab.id } });
    verifier(`tour ${i} : une seule demande en base`, nbConges + nbPerms === 1, { nbConges, nbPerms });
  }

  // Congé d'office (RH) contre une permission déposée au même instant.
  for (let i = 0; i < Math.ceil(TOURS / 2); i++) {
    const jour = mercredi(6 + (i % 3));
    await nettoyer();
    const [o, p] = await Promise.all([office(jour), permission(jour)]);
    const gagnants = [o.ok, p.ok].filter(Boolean).length;
    verifier(`tour ${i} (congé d'office + permission) : un seul passe`, gagnants === 1, { office: o.ok ? "ok" : o.erreur, permission: p.ok ? "ok" : p.erreur });
  }

  await nettoyer();
  console.log(`Congé gagnant ${victoiresConge} fois, permission gagnante ${victoiresPermission} fois sur ${TOURS} tours.`);
  console.log(`${ok} contrôles réussis, ${ko} échecs.`);
  await prisma.$disconnect();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
