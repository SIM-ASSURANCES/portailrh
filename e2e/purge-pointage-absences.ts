// Lot 5 (D5) : la purge du Pointage supprimerait les plages d'absence autorisée des congés validés :
// elle est refusée (exécution ET sauvegarde) dès qu'une demande de congé existe.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:45497/e2e?schema=public npx tsx e2e/purge-pointage-absences.ts
// Base JETABLE seulement ; lancer APRÈS e2e/conges-integration.mjs (qui laisse une demande de congé).

import {
  MESSAGE_PURGE_REFUSEE_ABSENCES,
  ReinitialisationPointageError,
  executerReinitialisationPointage,
  genererSauvegardePointage,
  prisma,
} from "../backend/src/index";

const url = process.env.DATABASE_URL ?? "";
if (!/(jetable|e2e|conges)/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
  console.error("Refus : DATABASE_URL doit viser une base jetable.");
  process.exit(2);
}
let ko = 0;
const verifier = (nom: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK " : "KO "} ${nom}${ok ? "" : ` — ${String(detail)}`}`);
  if (!ok) ko++;
};
const message = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof ReinitialisationPointageError ? e.message : `ERREUR INATTENDUE: ${String(e)}`;
  }
};

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@simassurances.test" } });
  const nb = await prisma.demandeConge.count();
  if (nb === 0) throw new Error("Préparation : aucune demande (lancer e2e/conges-integration.mjs d'abord).");

  // Une vraie plage d'absence autorisée (celle d'un congé validé) : la purge refusée doit la laisser intacte.
  const conge = await prisma.demandeConge.findFirstOrThrow();
  await prisma.plageAbsenceAutorisee.create({
    data: { userId: conge.userId, date: conge.dateDebut, heureDebut: "00:00", heureFin: "23:59", source: "CONGE", demandeCongeId: conge.id },
  });
  const plagesAvant = await prisma.plageAbsenceAutorisee.count();

  const sauvegarde = await message(() => genererSauvegardePointage(user.id));
  verifier("Sauvegarde refusée avec une demande existante", sauvegarde === MESSAGE_PURGE_REFUSEE_ABSENCES, sauvegarde);
  const purge = await message(() => executerReinitialisationPointage({ userId: user.id, sauvegardeSha256: "0".repeat(64) }));
  verifier("Purge refusée avec une demande existante (avant même le contrôle d'empreinte)", purge === MESSAGE_PURGE_REFUSEE_ABSENCES, purge);
  verifier("Les plages d'absence autorisée sont intactes après les refus", (await prisma.plageAbsenceAutorisee.count()) === plagesAvant && plagesAvant >= 1, plagesAvant);

  // Sans demande, la purge n'est plus refusée pour ce motif (elle l'est pour l'empreinte factice).
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: { not: null } } });
  await prisma.demandeConge.deleteMany();
  const apres = await message(() => executerReinitialisationPointage({ userId: user.id, sauvegardeSha256: "0".repeat(64) }));
  verifier("Sans demande : le refus change de motif (empreinte invalide)", apres !== null && apres !== MESSAGE_PURGE_REFUSEE_ABSENCES && /sauvegarde/i.test(apres), apres);

  await prisma.$disconnect();
  process.exit(ko ? 1 : 0);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
