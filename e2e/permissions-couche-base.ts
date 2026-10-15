// Permissions d'absence — vérification de la COUCHE BASE (backend/src/permissionsDb.ts) sur une base PostgreSQL jetable.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:5432/conges_d npx tsx e2e/permissions-couche-base.ts
//
// La base doit être migrée et seedée. Le script y ÉCRIT (permissions, plages) : jamais la base de développement.
// Garde : le nom de la base doit contenir « jetable », « e2e » ou « conges ».

import { prisma, soumettrePermission, deciderPermission, marquerRetourPermission, transactionAbsence } from "../backend/src/index";

const url = process.env.DATABASE_URL ?? "";
if (!/(jetable|e2e|conges)/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
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

async function compte(email: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email: `${email}@simassurances.test` },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return { id: u.id, rolePermissions: u.role.permissions.map((p) => p.permission.key) };
}

function jourLocal(decalage: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const collab = await compte("collaborateur");
  const resp = await compte("responsable-commercial");
  const rh = await compte("rh");
  const dg = await compte("dg");
  const type = await prisma.typePermission.findFirstOrThrow({ where: { label: "Rendez-vous médical" } }); // 3 h max, 2 par mois
  const maintenant = new Date();

  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandePermissionId: { not: null } } });
  await prisma.demandePermission.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  await prisma.typePermission.update({ where: { id: type.id }, data: { plafondMensuel: 2, dureeMaxHeures: 3, isActive: true } });

  const agir = (u: { id: string; rolePermissions: string[] }, demandeId: string, action: Parameters<typeof deciderPermission>[1]["action"], peutAnnuler = false) =>
    transactionAbsence((tx) => deciderPermission(tx, { demandeId, acteur: u, action, peutAnnulerApresDebut: peutAnnuler, maintenant: new Date() }));
  const soumettre = (userId: string, date: string, de: string, a: string, typePermissionId = type.id) =>
    transactionAbsence((tx) => soumettrePermission(tx, { userId, entree: { typePermissionId, date, heureDepart: de, heureRetourPrevue: a, motif: "Rendez-vous médical" }, maintenant }));

  // Jours de la même semaine que la date de test pour que le plafond (mois) joue : on prend des jours du mois courant à venir.
  const j1 = jourLocal(3);

  console.log("Circuit normal : collaborateur → responsable → RH");
  const s1 = await soumettre(collab.id, j1, "09:00", "11:00");
  verifier("soumission acceptée", s1.ok, s1);
  if (!s1.ok) throw new Error("arrêt");
  const p1 = s1.valeur;
  verifier("référence PRM-AAAAMM-NNNN", /^PRM-\d{6}-\d{4}$/.test(p1.reference), p1.reference);
  verifier("étape responsable d'abord, destinataire = le responsable seul", p1.statut === "EN_ATTENTE_RESPONSABLE" && p1.destinataires.length === 1 && p1.destinataires[0] === resp.id, p1);
  verifier("durée 2 h", p1.dureeMinutes === 120);
  verifier("pas de plage avant l'accord", (await prisma.plageAbsenceAutorisee.count({ where: { demandePermissionId: p1.id } })) === 0);

  verifier("la RH ne décide pas depuis l'étape responsable", !(await agir(rh, p1.id, { type: "APPROUVER" })).ok);
  verifier("personne ne décide sa propre demande", !(await agir(collab, p1.id, { type: "APPROUVER" })).ok);
  const r2 = await agir(resp, p1.id, { type: "APPROUVER" });
  verifier("le responsable approuve → en attente RH, RH prévenue (ni demandeur ni DG)", r2.ok && r2.valeur.statut === "EN_ATTENTE_RH" && r2.valeur.destinatairesSuivants.includes(rh.id) && !r2.valeur.destinatairesSuivants.includes(collab.id) && !r2.valeur.destinatairesSuivants.includes(dg.id), r2);

  console.log("Accord simultané : une seule plage");
  const [a, b] = await Promise.all([agir(rh, p1.id, { type: "APPROUVER" }), agir(rh, p1.id, { type: "APPROUVER" })]);
  verifier("exactement un accord réussit", [a, b].filter((x) => x.ok).length === 1, [a, b]);
  const plages = await prisma.plageAbsenceAutorisee.findMany({ where: { demandePermissionId: p1.id } });
  verifier("une plage PERMISSION 09:00–11:00 liée à la demande", plages.length === 1 && plages[0].source === "PERMISSION" && plages[0].heureDebut === "09:00" && plages[0].heureFin === "11:00", plages);
  const sd = await prisma.demandePermission.findUniqueOrThrow({ where: { id: p1.id } });
  verifier("statut APPROUVEE, étape RH horodatée", sd.statut === "APPROUVEE" && sd.valideParId === rh.id && sd.approuveParId === resp.id, sd);

  console.log("Contrôles à la soumission");
  const refus = async (nom: string, r: Awaited<ReturnType<typeof soumettre>>, contient: string) => verifier(nom, !r.ok && r.erreur.includes(contient), r);
  await refus("chevauchement horaire refusé", await soumettre(collab.id, j1, "10:00", "12:00"), "couvre déjà");
  verifier("deux plages qui se touchent sont acceptées (11:00–12:00)", (await soumettre(collab.id, j1, "11:00", "12:00")).ok);
  await refus("durée au-delà du maximum du type", await soumettre(collab.id, jourLocal(4), "08:00", "12:00"), "maximum");
  await refus("date passée", await soumettre(collab.id, jourLocal(-1), "08:00", "09:00"), "passé");
  await refus("retour avant départ", await soumettre(collab.id, jourLocal(4), "11:00", "10:00"), "postérieure");

  console.log("Congé : refus réciproque");
  const conge = await prisma.typeConge.findFirstOrThrow({ where: { code: "ANNUEL" } });
  const jc = jourLocal(6);
  await prisma.demandeConge.create({
    data: { reference: `CNG-TEST-${Date.now()}`, dateDebut: new Date(`${jc}T00:00:00.000Z`), dateFin: new Date(`${jc}T00:00:00.000Z`), nbJours: 1, motif: "test", statut: "VALIDEE", userId: collab.id, typeCongeId: conge.id },
  });
  await refus("permission refusée sur un jour de congé validé", await soumettre(collab.id, jc, "08:00", "09:00"), "congé");

  console.log("Plafond mensuel et dérogation");
  // Plafond à 1 : le premier créneau (p1, APPROUVEE) le sature déjà ce mois-ci s'il est dans le même mois que les suivants.
  await prisma.typePermission.update({ where: { id: type.id }, data: { plafondMensuel: 1 } });
  const j7 = jourLocal(3); // même mois que p1
  const sA = await soumettre(collab.id, j7, "14:00", "15:00");
  verifier("la soumission au-delà du plafond reste permise mais avertit", sA.ok && sA.valeur.auDelaDuPlafond !== null && sA.valeur.auDelaDuPlafond.plafond === 1, sA);
  if (!sA.ok) throw new Error("arrêt");
  await agir(resp, sA.valeur.id, { type: "APPROUVER" });
  const sansMotif = await agir(rh, sA.valeur.id, { type: "APPROUVER" });
  verifier("l'accord sans dérogation est refusé, message du plafond", !sansMotif.ok && sansMotif.erreur.includes("plafond"), sansMotif);
  verifier("aucune plage créée par le refus (transaction annulée)", (await prisma.plageAbsenceAutorisee.count({ where: { demandePermissionId: sA.valeur.id } })) === 0);
  const motifCourt = await agir(rh, sA.valeur.id, { type: "APPROUVER", exceptionPlafond: "ok" });
  verifier("dérogation trop courte refusée", !motifCourt.ok, motifCourt);
  const derog = await agir(rh, sA.valeur.id, { type: "APPROUVER", exceptionPlafond: "Cas médical suivi par le médecin du travail" });
  verifier("dérogation motivée acceptée et tracée", derog.ok && derog.valeur.exceptionPlafond, derog);
  const sdA = await prisma.demandePermission.findUniqueOrThrow({ where: { id: sA.valeur.id } });
  verifier("motifExceptionPlafond enregistré", sdA.motifExceptionPlafond === "Cas médical suivi par le médecin du travail", sdA.motifExceptionPlafond);
  const hist = await prisma.historiqueEntry.findMany({ where: { entity: "DemandePermission", entityId: sA.valeur.id } });
  verifier("l'historique mentionne la dérogation", hist.some((h) => h.detail.includes("Dérogation")), hist.map((h) => h.detail));
  await prisma.typePermission.update({ where: { id: type.id }, data: { plafondMensuel: 5 } });
  const resp2 = await agir(resp, sA.valeur.id, { type: "APPROUVER", exceptionPlafond: "inutile" });
  verifier("une dérogation hors étape RH est refusée", !resp2.ok);

  console.log("Pas de « modification demandée » pour une permission");
  const sM = await soumettre(collab.id, jourLocal(8), "08:00", "09:00");
  if (!sM.ok) throw new Error("arrêt");
  const r3 = await transactionAbsence((tx) => deciderPermission(tx, { demandeId: sM.valeur.id, acteur: resp, action: { type: "REJETER", motif: "Pas possible ce jour-là" }, peutAnnulerApresDebut: false, maintenant: new Date() }));
  verifier("le responsable rejette avec motif", r3.ok && r3.valeur.statut === "REJETEE", r3);
  const sdM = await prisma.demandePermission.findUniqueOrThrow({ where: { id: sM.valeur.id } });
  verifier("motif de rejet enregistré", sdM.motifRejet === "Pas possible ce jour-là");
  verifier("une demande rejetée ne se décide plus", !(await agir(rh, sM.valeur.id, { type: "APPROUVER" })).ok);

  console.log("Annulation : la plage disparaît par clé");
  const ann = await agir(collab, p1.id, { type: "ANNULER", motif: "Rendez-vous reporté" });
  verifier("le demandeur annule sa permission approuvée (jour pas encore arrivé)", ann.ok && ann.valeur.statut === "ANNULEE", ann);
  verifier("plage supprimée par demandePermissionId", (await prisma.plageAbsenceAutorisee.count({ where: { demandePermissionId: p1.id } })) === 0);
  verifier("les autres plages ne sont pas touchées", (await prisma.plageAbsenceAutorisee.count({ where: { demandePermissionId: sA.valeur.id } })) === 1);
  verifier("annuler deux fois est refusé", !(await agir(collab, p1.id, { type: "ANNULER", motif: "encore" })).ok);

  console.log("Retour : permission consommée");
  const jr = jourLocal(0);
  const sR = await soumettre(collab.id, jr, "07:00", "08:00");
  if (!sR.ok) throw new Error("arrêt");
  await agir(resp, sR.valeur.id, { type: "APPROUVER" });
  await agir(rh, sR.valeur.id, { type: "APPROUVER", exceptionPlafond: "Dérogation de test pour le retour" });
  const futur = await soumettre(collab.id, jourLocal(9), "08:00", "09:00");
  if (!futur.ok) throw new Error("arrêt");
  await agir(resp, futur.valeur.id, { type: "APPROUVER" });
  await agir(rh, futur.valeur.id, { type: "APPROUVER", exceptionPlafond: "Dérogation de test pour le futur" });
  const retour = (id: string, acteurId: string, heure: string, peutAutrui = false) =>
    transactionAbsence((tx) => marquerRetourPermission(tx, { demandeId: id, acteurId, peutMarquerPourAutrui: peutAutrui, heureRetourReelle: heure, maintenant: new Date() }));
  verifier("retour d'une permission future refusé", !(await retour(futur.valeur.id, collab.id, "08:30")).ok);
  verifier("un tiers ne marque pas le retour", !(await retour(sR.valeur.id, resp.id, "08:10")).ok);
  verifier("retour avant le départ refusé", !(await retour(sR.valeur.id, collab.id, "06:00")).ok);
  const rr = await retour(sR.valeur.id, collab.id, "08:20");
  verifier("retour marqué : 20 min de dépassement, 1 h 20 réelle", rr.ok && rr.valeur.depassement && rr.valeur.minutesEcart === 20 && rr.valeur.dureeReelleMinutes === 80, rr);
  const sdR = await prisma.demandePermission.findUniqueOrThrow({ where: { id: sR.valeur.id } });
  verifier("statut CONSOMMEE, heure réelle enregistrée", sdR.statut === "CONSOMMEE" && sdR.heureRetourReelle === "08:20" && sdR.dureeReelleMinutes === 80, sdR);
  verifier("second retour refusé", !(await retour(sR.valeur.id, collab.id, "08:30")).ok);
  const annC = await agir(rh, sR.valeur.id, { type: "ANNULER", motif: "Erreur de saisie" }, true);
  verifier("une permission consommée ne s'annule plus", !annC.ok, annC);

  console.log("Repli : responsable inactif");
  await prisma.user.update({ where: { id: resp.id }, data: { isActive: false } });
  const sRep = await soumettre(collab.id, jourLocal(10), "09:00", "10:00");
  verifier("sans responsable actif, la demande part directement à la RH", sRep.ok && sRep.valeur.statut === "EN_ATTENTE_RH", sRep);
  await prisma.user.update({ where: { id: resp.id }, data: { isActive: true } });

  console.log(`\n${ok} réussis, ${ko} échecs`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
