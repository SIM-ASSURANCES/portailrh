// Lot N (1.7) — `utilisateursAvecPermission` (utilisée par `notifyByPermission`) sur la VRAIE base jetable : titulaires par le rôle
// + délégués ACTIFS d'une délégation valide. Imprime un JSON { permission, sans, avec, ... } lu par e2e/lot-n.mjs.
import "../backend/prisma/chargerEnv";
import { prisma } from "../backend/src/prisma";
import { utilisateursAvecPermission } from "../backend/src/delegations";

async function main() {
  const P = "pointage.corriger_pointage";
  const id = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;
  const rh = await id("rh@simassurances.test");
  const collab = await id("collaborateur@simassurances.test");
  const complet = await utilisateursAvecPermission(prisma, P);
  const sansDelegues = await utilisateursAvecPermission(prisma, P, { inclureDelegues: false });
  const sansCollab = await utilisateursAvecPermission(prisma, P, { excludeUserId: collab });
  // Donneur désactivé : la délégation ne compte plus.
  await prisma.user.update({ where: { id: rh }, data: { isActive: false } });
  const donneurInactif = await utilisateursAvecPermission(prisma, P);
  await prisma.user.update({ where: { id: rh }, data: { isActive: true } });
  // Délégation révoquée : ne compte plus.
  await prisma.permissionDelegation.updateMany({ where: { donneurId: rh, beneficiaireId: collab, estActive: true }, data: { estActive: false, revokedAt: new Date() } });
  const revoquee = await utilisateursAvecPermission(prisma, P);
  await prisma.permissionDelegation.updateMany({ where: { donneurId: rh, beneficiaireId: collab }, data: { estActive: true, revokedAt: null } });
  console.log(JSON.stringify({ rh, collab, complet, sansDelegues, sansCollab, donneurInactif, revoquee }));
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
