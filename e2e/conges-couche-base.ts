// Congés — vérification de la COUCHE BASE (backend/src/congesDb.ts) sur une base PostgreSQL jetable, sans navigateur.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:5432/jetable npx tsx e2e/conges-couche-base.ts
//
// La base doit être migrée et seedée (comptes de test). Le script y ÉCRIT (demandes, plages, absences, pointages, jours fériés) :
// jamais la base de développement. Garde : le nom de la base doit contenir « jetable », « e2e » ou « conges ».
// Scénarios : plages provisoires (R10), circuit, observation RH, chevauchement (R5), date passée (R3), modification et resoumission
// (R8), annulation avant / après le début (R9), refus tardif avec ou sans jours comptés absents (R11), saisie RH (R12), repli DG (O1),
// concurrence (deux décisions, une soumission contre une saisie RH).

import {
  prisma,
  deciderConge,
  resoumettreConge,
  saisirCongeRH,
  soumettreConge,
  transactionConge,
  etatPlageConge,
  journeeCouverteParAbsence,
  MESSAGE_CONGE_DANS_LE_PASSE,
} from "../backend/src/index";

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

type Compte = { id: string; rolePermissions: string[] };
async function compte(email: string): Promise<Compte> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email: `${email}@simassurances.test` },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return { id: u.id, rolePermissions: u.role.permissions.map((p) => p.permission.key) };
}

const jc = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Prochain lundi à partir d'aujourd'hui + `semaines` semaines, en jour civil local. */
function lundi(semaines: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + 7 * semaines);
  return jc(d);
}
function plus(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return jc(new Date(a, m - 1, j + n));
}
const local = (jour: string) => {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(a, m - 1, j);
};
const colonne = (jour: string) => new Date(`${jour}T00:00:00.000Z`);

async function main() {
  const collab = await compte("collaborateur");
  const resp = await compte("responsable-commercial");
  const rh = await compte("rh");
  const dg = await compte("dg");
  const maintenant = new Date();
  const aujourdhui = jc(maintenant);

  // Nettoyage des essais précédents de ce script.
  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  await prisma.absence.deleteMany({});
  await prisma.pointage.deleteMany({ where: { userId: collab.id } });
  await prisma.jourFerie.deleteMany({});
  // Compte créé il y a longtemps : la règle d'ancienneté des absences (aucune absence le jour de création ni avant) ne joue pas,
  // sauf dans le scénario qui la vérifie.
  const creeIlYALongtemps = new Date(maintenant.getTime() - 120 * 86_400_000);
  await prisma.user.update({ where: { id: collab.id }, data: { createdAt: creeIlYALongtemps } });
  await prisma.historiqueEntry.deleteMany({ where: { entity: "User", entityId: collab.id, action: { in: ["ACTIVATE", "INVITATION_ACTIVATED"] } } });
  const journee = { heureDebutMatin: "07:45", heureFinApresMidi: "16:45" };

  const entree = (dateDebut: string, dateFin: string, motif = "Repos") => ({ nature: "CONGE" as const, dateDebut, dateFin, motif });
  const soumettre = (userId: string, e: ReturnType<typeof entree>) => transactionConge((tx) => soumettreConge(tx, { userId, entree: e, maintenant: new Date() }));
  const agir = (u: Compte, demandeId: string, action: Parameters<typeof deciderConge>[1]["action"], peutAnnuler = false) =>
    transactionConge((tx) => deciderConge(tx, { demandeId, acteur: u, action, peutAnnulerApresDebut: peutAnnuler, maintenant: new Date() }));
  const plages = (demandeId: string) => prisma.plageAbsenceAutorisee.findMany({ where: { demandeCongeId: demandeId }, orderBy: { date: "asc" } });

  // ── Circuit normal et plages (R10) ───────────────────────────────────────────────────────────────────────────────────
  console.log("Circuit normal : collaborateur → responsable → RH");
  const d1 = lundi(2);
  const f1 = plus(d1, 4); // lundi à vendredi : 5 jours ouvrés
  const s1 = await soumettre(collab.id, entree(d1, f1));
  verifier("soumission acceptée, en attente du responsable", s1.ok && s1.valeur.statut === "EN_ATTENTE_RESPONSABLE" && s1.valeur.nbJoursOuvres === 5, s1);
  const id1 = s1.ok ? s1.valeur.id : "";
  verifier("destinataire : le responsable du service", s1.ok && s1.valeur.destinataires.length === 1 && s1.valeur.destinataires[0] === resp.id);
  let p1 = await plages(id1);
  verifier("une plage par jour (5), toutes provisoires, 00:00–23:59, source CONGE", p1.length === 5 && p1.every((p) => p.provisoire && p.heureDebut === "00:00" && p.heureFin === "23:59" && p.source === "CONGE"), p1.length);
  const dem1 = await prisma.demandeConge.findUniqueOrThrow({ where: { id: id1 } });
  verifier("créée par le demandeur, référence CNG-", dem1.creeParId === collab.id && /^CNG-\d{6}-\d{4}$/.test(dem1.reference) && dem1.etapeResponsableRequise);

  const refusRespObs = await agir(resp, id1, { type: "APPROUVER", observationRH: "Bon repos" });
  verifier("observation refusée au responsable (réservée à la RH)", !refusRespObs.ok && refusRespObs.erreur.includes("réservée à la RH"), refusRespObs);
  verifier("aucune écriture après ce refus", (await prisma.demandeConge.findUniqueOrThrow({ where: { id: id1 } })).statut === "EN_ATTENTE_RESPONSABLE");
  const autre = await agir(rh, id1, { type: "APPROUVER" });
  verifier("la RH ne décide pas à l'étape du responsable", !autre.ok, autre);
  const a1 = await agir(resp, id1, { type: "APPROUVER" });
  verifier("le responsable approuve : en attente de la RH", a1.ok && a1.valeur.statut === "EN_ATTENTE_RH" && a1.valeur.destinatairesSuivants.includes(rh.id), a1);
  p1 = await plages(id1);
  verifier("les plages restent provisoires après le responsable", p1.length === 5 && p1.every((p) => p.provisoire));
  const propre = await agir(collab, id1, { type: "APPROUVER" });
  verifier("le demandeur ne décide pas de sa demande", !propre.ok, propre);
  const v1 = await agir(rh, id1, { type: "APPROUVER", observationRH: "  Bon   repos " });
  verifier("la RH valide avec une observation nettoyée", v1.ok && v1.valeur.statut === "VALIDEE" && v1.valeur.observationRH === "Bon repos", v1);
  p1 = await plages(id1);
  verifier("à la validation, les plages deviennent définitives", p1.length === 5 && p1.every((p) => !p.provisoire));
  const dv1 = await prisma.demandeConge.findUniqueOrThrow({ where: { id: id1 } });
  verifier("approbateur, validateur et observation enregistrés", dv1.approuveParId === resp.id && dv1.valideParId === rh.id && dv1.observationRH === "Bon repos");
  const histo1 = await prisma.historiqueEntry.findMany({ where: { entity: "DemandeConge", entityId: id1 }, orderBy: { createdAt: "asc" } });
  verifier("historique : soumission, approbation responsable, accord RH", ["soumission", "approbation_responsable", "accord_rh"].every((a) => histo1.some((h) => h.action === a)), histo1.map((h) => h.action));

  // ── R5 chevauchement, R3 date passée ─────────────────────────────────────────────────────────────────────────────────
  console.log("Chevauchement et date passée");
  const chev = await soumettre(collab.id, entree(plus(d1, 4), plus(d1, 6)));
  verifier("chevauchement avec un congé validé refusé", !chev.ok && chev.erreur.includes("couvre déjà"), chev);
  const suivant = await soumettre(collab.id, entree(plus(d1, 7), plus(d1, 7)));
  verifier("période qui commence le lendemain de la fin : acceptée", suivant.ok, suivant);
  const hier = await soumettre(collab.id, entree(plus(aujourdhui, -1), plus(aujourdhui, 1)));
  verifier("début hier refusé avec la phrase de l'écran", !hier.ok && hier.erreur === MESSAGE_CONGE_DANS_LE_PASSE, hier);
  const sansOuvre = await soumettre(collab.id, entree(plus(lundi(6), 5), plus(lundi(6), 6))); // samedi–dimanche
  verifier("période sans jour ouvré refusée", !sansOuvre.ok && sansOuvre.erreur.includes("aucun jour ouvré"), sansOuvre);
  const courtMotif = await soumettre(collab.id, entree(lundi(7), lundi(7), "ab"));
  verifier("motif de 2 caractères refusé", !courtMotif.ok && courtMotif.champ === "motif", courtMotif);
  const inversee = await soumettre(collab.id, entree(lundi(7), plus(lundi(7), -1)));
  verifier("fin avant le début refusée", !inversee.ok && inversee.champ === "dateFin", inversee);
  if (suivant.ok) await agir(collab, suivant.valeur.id, { type: "ANNULER", motif: "Plus nécessaire" });

  // ── Refus avant le début : plages supprimées ─────────────────────────────────────────────────────────────────────────
  console.log("Refus avant le début");
  const d2 = lundi(4);
  const s2 = await soumettre(collab.id, entree(d2, plus(d2, 2)));
  const id2 = s2.ok ? s2.valeur.id : "";
  await agir(resp, id2, { type: "APPROUVER" });
  const r2 = await agir(rh, id2, { type: "REJETER", motif: "Période chargée", compterJoursPassesAbsents: true });
  verifier("refus accepté", r2.ok && r2.valeur.statut === "REJETEE" && r2.valeur.absencesCreees === 0, r2);
  verifier("plages supprimées au refus", (await plages(id2)).length === 0);
  const dr2 = await prisma.demandeConge.findUniqueOrThrow({ where: { id: id2 } });
  verifier("début futur : le choix « jours passés » est sans objet (null)", dr2.joursPassesComptesAbsents === null && dr2.motifRejet === "Période chargée");

  // ── Modification demandée puis resoumission (R8) ─────────────────────────────────────────────────────────────────────
  console.log("Modification demandée puis resoumission");
  const d3 = lundi(5);
  const s3 = await soumettre(collab.id, entree(d3, plus(d3, 2), "Premier motif"));
  const id3 = s3.ok ? s3.valeur.id : "";
  await agir(resp, id3, { type: "APPROUVER" });
  const m3 = await agir(rh, id3, { type: "DEMANDER_MODIFICATION", motif: "Réduisez la période", observationRH: "Voir avec le responsable" });
  verifier("modification demandée (O4) : plages retirées, la période n'est plus protégée", m3.ok && m3.valeur.statut === "MODIFICATION_DEMANDEE" && (await plages(id3)).length === 0, m3);
  const resoRefus = await transactionConge((tx) => resoumettreConge(tx, { demandeId: id3, acteurId: resp.id, entree: entree(d3, plus(d3, 1)), maintenant: new Date() }));
  verifier("seul le demandeur renvoie sa demande", !resoRefus.ok, resoRefus);
  const reso = await transactionConge((tx) => resoumettreConge(tx, { demandeId: id3, acteurId: collab.id, entree: entree(d3, plus(d3, 1), "Motif corrigé"), maintenant: new Date() }));
  verifier("resoumission : retour à la première étape", reso.ok && reso.valeur.statut === "EN_ATTENTE_RESPONSABLE" && reso.valeur.nbJoursOuvres === 2, reso);
  const p3 = await plages(id3);
  verifier("plages remplacées : 2 jours, provisoires", p3.length === 2 && p3.every((p) => p.provisoire));
  const dem3 = await prisma.demandeConge.findUniqueOrThrow({ where: { id: id3 } });
  verifier("décisions précédentes effacées, motif mis à jour", dem3.approuveParId === null && dem3.valideParId === null && dem3.observationRH === null && dem3.motifModification === null && dem3.motif === "Motif corrigé");

  // ── Annulation avant le début (R9) ───────────────────────────────────────────────────────────────────────────────────
  console.log("Annulation avant le début");
  const an = await agir(collab, id1, { type: "ANNULER", motif: "Changement de programme" });
  verifier("le demandeur annule un congé validé qui n'a pas commencé", an.ok && an.valeur.statut === "ANNULEE", an);
  verifier("toutes les plages supprimées", (await plages(id1)).length === 0);

  // ── Annulation après le début : seules les plages futures partent ────────────────────────────────────────────────────
  console.log("Annulation après le début");
  const debutPasse = plus(aujourdhui, -2);
  const finFutur = plus(aujourdhui, 3);
  const enCours = await prisma.demandeConge.create({
    data: {
      reference: "CNG-TEST-0001", nature: "CONGE", motif: "Congé commencé", dateDebut: colonne(debutPasse), dateFin: colonne(finFutur),
      nbJoursOuvres: 3, statut: "VALIDEE", etapeResponsableRequise: true, userId: collab.id, creeParId: collab.id, valideParId: rh.id, valideAt: new Date(),
    },
  });
  const joursEnCours: string[] = [];
  for (let j = debutPasse; j <= finFutur; j = plus(j, 1)) joursEnCours.push(j);
  await prisma.plageAbsenceAutorisee.createMany({
    data: joursEnCours.map((j) => ({ userId: collab.id, date: local(j), heureDebut: "00:00", heureFin: "23:59", source: "CONGE" as const, demandeCongeId: enCours.id })),
  });
  const refusDem = await agir(collab, enCours.id, { type: "ANNULER", motif: "Trop tard" });
  verifier("le demandeur n'annule plus un congé commencé", !refusDem.ok && refusDem.erreur.includes("déjà commencé"), refusDem);
  verifier("aucune plage supprimée par ce refus", (await plages(enCours.id)).length === joursEnCours.length);
  const refusSansDroit = await agir(rh, enCours.id, { type: "ANNULER", motif: "Sans droit" }, false);
  verifier("sans conges.annuler, la RH n'annule pas non plus", !refusSansDroit.ok, refusSansDroit);
  const anRH = await agir(rh, enCours.id, { type: "ANNULER", motif: "Retour anticipé du collaborateur" }, true);
  verifier("avec conges.annuler, annulation après le début", anRH.ok && anRH.valeur.statut === "ANNULEE", anRH);
  const reste = await plages(enCours.id);
  const attendu = joursEnCours.filter((j) => j <= aujourdhui);
  verifier(`seules les plages jusqu'à aujourd'hui restent (${attendu.length})`, reste.length === attendu.length && reste.every((p) => jc(p.date) <= aujourdhui), reste.map((p) => jc(p.date)));
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: enCours.id } });
  await prisma.demandeConge.delete({ where: { id: enCours.id } });

  // ── O4 : modification demandée après le début, puis renvoi ─────────────────────────────────────────────────────────────
  console.log("Modification demandée après le début (O4)");
  const debutO4 = plus(aujourdhui, -3);
  const finO4 = plus(aujourdhui, 2);
  const o4 = await prisma.demandeConge.create({
    data: {
      reference: "CNG-TEST-0010", nature: "CONGE", motif: "Congé déjà commencé", dateDebut: colonne(debutO4), dateFin: colonne(finO4),
      nbJoursOuvres: 4, statut: "EN_ATTENTE_RH", etapeResponsableRequise: false, userId: collab.id, creeParId: collab.id,
    },
  });
  const joursO4: string[] = [];
  for (let j = debutO4; j <= finO4; j = plus(j, 1)) joursO4.push(j);
  await prisma.plageAbsenceAutorisee.createMany({
    data: joursO4.map((j) => ({ userId: collab.id, date: local(j), heureDebut: "00:00", heureFin: "23:59", source: "CONGE" as const, demandeCongeId: o4.id, provisoire: true })),
  });
  const mO4 = await agir(rh, o4.id, { type: "DEMANDER_MODIFICATION", motif: "Dates à revoir" });
  const pO4 = await plages(o4.id);
  verifier(
    "O4 après le début : les jours passés gardent leur plage (3), aujourd'hui et la suite sont retirés",
    mO4.ok && pO4.length === 3 && pO4.every((p) => jc(p.date) < aujourdhui && p.provisoire),
    pO4.map((p) => jc(p.date))
  );
  const nouveauDebut = lundi(10);
  const rO4 = await transactionConge((tx) => resoumettreConge(tx, { demandeId: o4.id, acteurId: collab.id, entree: entree(nouveauDebut, plus(nouveauDebut, 1), "Nouvelles dates"), maintenant: new Date() }));
  const pO4b = await plages(o4.id);
  verifier(
    "renvoi : jours passés de l'ancienne période gardés (3) + nouvelle période (2)",
    rO4.ok && pO4b.length === 5 && pO4b.filter((p) => jc(p.date) < aujourdhui).length === 3,
    pO4b.map((p) => jc(p.date))
  );
  if (rO4.ok && rO4.valeur.statut === "EN_ATTENTE_RESPONSABLE") await agir(resp, o4.id, { type: "APPROUVER" });
  const vO4 = await agir(rh, o4.id, { type: "APPROUVER" });
  const pO4c = await plages(o4.id);
  verifier(
    "validation : la nouvelle période devient définitive, les jours passés restent provisoires",
    vO4.ok && pO4c.filter((p) => !p.provisoire).length === 2 && pO4c.filter((p) => jc(p.date) < aujourdhui).every((p) => p.provisoire),
    pO4c.map((p) => [jc(p.date), p.provisoire])
  );
  verifier(
    "affichage : « en congé » pour la nouvelle période, « jour protégé » pour les jours passés, jamais « en congé »",
    pO4c.every((p) => etatPlageConge({ provisoire: p.provisoire, statutDemande: "VALIDEE" }) === (jc(p.date) < aujourdhui ? "PROTEGE" : "EN_CONGE"))
  );
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: o4.id } });
  await prisma.demandeConge.delete({ where: { id: o4.id } });

  // ── R11 : refus tardif ───────────────────────────────────────────────────────────────────────────────────────────────
  console.log("Refus tardif (R11)");
  const debutR11 = plus(aujourdhui, -12);
  const finR11 = plus(aujourdhui, 2);
  const nouvelleDemandeEnAttenteRH = async (ref: string) => {
    const d = await prisma.demandeConge.create({
      data: {
        reference: ref, nature: "CONGE", motif: "Congé déjà commencé", dateDebut: colonne(debutR11), dateFin: colonne(finR11),
        nbJoursOuvres: 10, statut: "EN_ATTENTE_RH", etapeResponsableRequise: false, userId: collab.id, creeParId: collab.id,
      },
    });
    const jours: string[] = [];
    for (let j = debutR11; j <= finR11; j = plus(j, 1)) jours.push(j);
    await prisma.plageAbsenceAutorisee.createMany({
      data: jours.map((j) => ({ userId: collab.id, date: local(j), heureDebut: "00:00", heureFin: "23:59", source: "CONGE" as const, demandeCongeId: d.id, provisoire: true })),
    });
    return d.id;
  };
  // Un jour férié et un jour pointé dans la fenêtre.
  const veille = plus(aujourdhui, -1);
  const jourFerie = plus(aujourdhui, -9);
  const jourPointe = plus(aujourdhui, -8);
  await prisma.jourFerie.create({ data: { date: local(jourFerie), libelle: "Férié de test" } });
  await prisma.pointage.create({ data: { type: "ARRIVEE", source: "ORDINATEUR", heure: new Date(local(jourPointe).getTime() + 8 * 3600_000), userId: collab.id } });
  const plancher = process.env.SYSTEM_START_DATE || "2026-09-07";
  const attendues: string[] = [];
  for (let j = debutR11; j <= veille; j = plus(j, 1)) {
    const g = local(j).getDay();
    if (g === 0 || g === 6 || j === jourFerie || j === jourPointe || j < plancher) continue;
    attendues.push(j);
  }
  const idA = await nouvelleDemandeEnAttenteRH("CNG-TEST-0002");
  const rA = await agir(rh, idA, { type: "REJETER", motif: "Pas de dépôt préalable", compterJoursPassesAbsents: true });
  const absA = await prisma.absence.findMany({ where: { userId: collab.id }, orderBy: { date: "asc" } });
  verifier(`coché : ${attendues.length} absence(s) « à contrôler » (ouvrés passés, sans férié, sans jour pointé)`, rA.ok && rA.valeur.absencesCreees === attendues.length && absA.length === attendues.length && absA.every((a) => a.statut === "A_CONTROLER"), { absA: absA.map((a) => jc(a.date)), attendues, rA });
  verifier("jours exacts", JSON.stringify(absA.map((a) => jc(a.date))) === JSON.stringify(attendues));
  verifier("le choix est écrit sur la demande et dans l'historique", (await prisma.demandeConge.findUniqueOrThrow({ where: { id: idA } })).joursPassesComptesAbsents === true && (await prisma.historiqueEntry.count({ where: { entity: "DemandeConge", entityId: idA, action: "jours_passes" } })) === 1);
  verifier("plages supprimées par le refus", (await plages(idA)).length === 0);

  const idB = await nouvelleDemandeEnAttenteRH("CNG-TEST-0003");
  await prisma.absence.deleteMany({});
  const rB = await agir(rh, idB, { type: "REJETER", motif: "Pas de dépôt préalable", compterJoursPassesAbsents: false });
  verifier("décoché : aucune absence créée", rB.ok && rB.valeur.absencesCreees === 0 && (await prisma.absence.count()) === 0, rB);
  verifier("décoché : choix enregistré à faux", (await prisma.demandeConge.findUniqueOrThrow({ where: { id: idB } })).joursPassesComptesAbsents === false);
  const pB = await plages(idB);
  verifier(
    "décoché : les plages des jours passés restent (12), aujourd'hui et la suite sont retirés",
    pB.length === 12 && pB.every((p) => jc(p.date) < aujourdhui),
    pB.map((p) => jc(p.date))
  );
  const plageVeille = pB.filter((p) => jc(p.date) === veille);
  verifier(
    "décoché : la veille reste couverte, la tâche des absences (qui réexamine la veille) n'y créera rien",
    journeeCouverteParAbsence(plageVeille, journee)
  );
  verifier("décoché : ces jours s'affichent « jour protégé »", pB.every((p) => etatPlageConge({ provisoire: p.provisoire, statutDemande: "REJETEE" }) === "PROTEGE"));

  const idC = await nouvelleDemandeEnAttenteRH("CNG-TEST-0004");
  const rC = await agir(rh, idC, { type: "REJETER", motif: "Pas de dépôt préalable" });
  verifier("choix absent : traité comme décoché", rC.ok && rC.valeur.absencesCreees === 0 && (await prisma.absence.count()) === 0 && (await plages(idC)).length === 12);

  const idD = await nouvelleDemandeEnAttenteRH("CNG-TEST-0005");
  await prisma.absence.createMany({ data: attendues.slice(0, 2).map((j) => ({ userId: collab.id, date: local(j), statut: "CONFIRMEE" as const })) });
  const rD = await agir(rh, idD, { type: "REJETER", motif: "Pas de dépôt préalable", compterJoursPassesAbsents: true });
  verifier("jamais de doublon : les jours déjà en absence sont sautés", rD.ok && rD.valeur.absencesCreees === attendues.length - 2 && (await prisma.absence.count()) === attendues.length, rD);
  await prisma.absence.deleteMany({});

  // Règle d'ancienneté de la tâche des absences : aucune absence le jour de création du compte ni avant.
  const creeLe = plus(aujourdhui, -5);
  await prisma.user.update({ where: { id: collab.id }, data: { createdAt: new Date(local(creeLe).getTime() + 10 * 3600_000) } });
  const idE = await nouvelleDemandeEnAttenteRH("CNG-TEST-0006");
  const rE = await agir(rh, idE, { type: "REJETER", motif: "Pas de dépôt préalable", compterJoursPassesAbsents: true });
  const attenduesE = attendues.filter((j) => j > creeLe);
  const absE = await prisma.absence.findMany({ where: { userId: collab.id }, orderBy: { date: "asc" } });
  verifier(
    `coché, compte créé il y a 5 jours : seulement les jours après sa création (${attenduesE.length})`,
    rE.ok && JSON.stringify(absE.map((a) => jc(a.date))) === JSON.stringify(attenduesE),
    { absE: absE.map((a) => jc(a.date)), attenduesE }
  );
  await prisma.user.update({ where: { id: collab.id }, data: { createdAt: creeIlYALongtemps } });
  await prisma.user.update({ where: { id: collab.id }, data: { isActive: false } });
  await prisma.absence.deleteMany({});
  const idF = await nouvelleDemandeEnAttenteRH("CNG-TEST-0007");
  const rF = await agir(rh, idF, { type: "REJETER", motif: "Pas de dépôt préalable", compterJoursPassesAbsents: true });
  verifier("coché, compte désactivé : aucune absence (comme la tâche)", rF.ok && rF.valeur.absencesCreees === 0 && (await prisma.absence.count()) === 0, rF);
  await prisma.user.update({ where: { id: collab.id }, data: { isActive: true } });

  await prisma.absence.deleteMany({});
  await prisma.pointage.deleteMany({ where: { userId: collab.id } });
  await prisma.jourFerie.deleteMany({});
  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({ where: { reference: { startsWith: "CNG-TEST-" } } });

  // ── R12 : saisie RH ─────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("Saisie RH");
  const d6 = lundi(8);
  const saisie = await transactionConge((tx) => saisirCongeRH(tx, { acteurId: rh.id, userId: collab.id, entree: entree(d6, plus(d6, 1)), maintenant: new Date() }));
  verifier("saisie RH acceptée", saisie.ok && saisie.valeur.nbJoursOuvres === 2, saisie);
  const ds = saisie.ok ? await prisma.demandeConge.findUniqueOrThrow({ where: { id: saisie.valeur.id } }) : null;
  verifier("statut VALIDEE directement, saisieParRH, créée par la RH", !!ds && ds.statut === "VALIDEE" && ds.saisieParRH && ds.creeParId === rh.id && ds.userId === collab.id && ds.valideParId === rh.id);
  verifier("plages définitives", saisie.ok && (await plages(saisie.valeur.id)).length === 2 && (await plages(saisie.valeur.id)).every((p) => !p.provisoire));
  const soi = await transactionConge((tx) => saisirCongeRH(tx, { acteurId: rh.id, userId: rh.id, entree: entree(lundi(9), lundi(9)), maintenant: new Date() }));
  verifier("la RH ne se saisit pas un congé à elle-même", !soi.ok, soi);
  const passe = await transactionConge((tx) => saisirCongeRH(tx, { acteurId: rh.id, userId: collab.id, entree: entree(plus(aujourdhui, -3), plus(aujourdhui, -3)), maintenant: new Date() }));
  verifier("saisie RH d'une date passée refusée (R3)", !passe.ok && passe.erreur === MESSAGE_CONGE_DANS_LE_PASSE, passe);
  const chevRH = await transactionConge((tx) => saisirCongeRH(tx, { acteurId: rh.id, userId: collab.id, entree: entree(plus(d6, 1), plus(d6, 3)), maintenant: new Date() }));
  verifier("la saisie RH est soumise au chevauchement", !chevRH.ok && chevRH.erreur.includes("couvre déjà"), chevRH);

  // ── O1 : repli DG quand la RH est le demandeur ───────────────────────────────────────────────────────────────────────
  console.log("Repli DG (O1, provisoire)");
  const d7 = lundi(10);
  const s7 = await soumettre(rh.id, entree(d7, plus(d7, 1)));
  verifier("la demande de la RH (seule RH) part chez le DG", s7.ok && s7.valeur.statut === "EN_ATTENTE_RH" && s7.valeur.destinataires.length === 1 && s7.valeur.destinataires[0] === dg.id, s7);
  const id7 = s7.ok ? s7.valeur.id : "";
  verifier("la RH ne valide pas sa propre demande", !(await agir(rh, id7, { type: "APPROUVER" })).ok);
  const v7 = await agir(dg, id7, { type: "APPROUVER" });
  verifier("le DG valide à sa place", v7.ok && v7.valeur.statut === "VALIDEE", v7);

  // ── Concurrence ─────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("Concurrence");
  const d8 = lundi(12);
  const s8 = await soumettre(collab.id, entree(d8, plus(d8, 1)));
  const id8 = s8.ok ? s8.valeur.id : "";
  await agir(resp, id8, { type: "APPROUVER" });
  const deux = await Promise.all([agir(rh, id8, { type: "APPROUVER" }), agir(rh, id8, { type: "REJETER", motif: "Simultané" })]);
  verifier("deux décisions simultanées : une seule passe", deux.filter((r) => r.ok).length === 1, deux);
  const statutFinal = (await prisma.demandeConge.findUniqueOrThrow({ where: { id: id8 } })).statut;
  const plages8 = await plages(id8);
  verifier("état cohérent après la course (plages définitives si validée, supprimées si rejetée)", (statutFinal === "VALIDEE" && plages8.every((p) => !p.provisoire) && plages8.length === 2) || (statutFinal === "REJETEE" && plages8.length === 0), { statutFinal, plages8: plages8.length });

  const d9 = lundi(14);
  const course = await Promise.all([
    soumettre(collab.id, entree(d9, plus(d9, 1))),
    transactionConge((tx) => saisirCongeRH(tx, { acteurId: rh.id, userId: collab.id, entree: entree(d9, plus(d9, 1)), maintenant: new Date() })),
  ]);
  verifier("soumission et saisie RH simultanées pour le même salarié : une seule passe", course.filter((r) => r.ok).length === 1, course);
  const surPeriode = await prisma.demandeConge.count({ where: { userId: collab.id, dateDebut: colonne(d9) } });
  verifier("une seule demande en base sur cette période", surPeriode === 1, surPeriode);

  // Nettoyage.
  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  console.log(`\n${ok} vérification(s) réussie(s), ${ko} en échec.`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
