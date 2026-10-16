// Congés — vérification de la COUCHE BASE (backend/src/congesDb.ts) sur une base PostgreSQL jetable, sans navigateur.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:5432/jetable npx tsx e2e/conges-couche-base.ts
//
// La base doit être migrée et seedée (comptes de test). Le script y ÉCRIT (demandes, soldes, plages) : jamais la base de
// développement. Garde : le nom de la base doit contenir « jetable », « e2e » ou « conges ».

import { prisma, ajouterObservationDG, initialiserSoldesExercice, soumettreConge, resoumettreConge, deciderConge, accorderCongeOffice, ajusterSolde, transactionAbsence, MESSAGE_CONGE_DANS_LE_PASSE } from "../backend/src/index";

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

async function compte(email: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email: `${email}@simassurances.test` },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return { id: u.id, rolePermissions: u.role.permissions.map((p) => p.permission.key) };
}

/** Prochain lundi à partir d'aujourd'hui + `semaines` semaines, en jour civil local. */
function lundi(semaines: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + 7 * semaines);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plus(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  const d = new Date(a, m - 1, j + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const collab = await compte("collaborateur");
  const resp = await compte("responsable-commercial");
  const rh = await compte("rh");
  const dg = await compte("dg");
  const annuel = await prisma.typeConge.findUniqueOrThrow({ where: { code: "ANNUEL" } });
  const maintenant = new Date();

  // Nettoyage des essais précédents de ce script.
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { OR: [{ demandeCongeId: { not: null } }, { demandePermissionId: { not: null } }] } });
  await prisma.demandePermission.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  await prisma.ajustementSolde.deleteMany({});
  await prisma.soldeConge.deleteMany({});

  const agir = (utilisateur: { id: string; rolePermissions: string[] }, demandeId: string, action: Parameters<typeof deciderConge>[1]["action"], peutAnnuler = false) =>
    transactionAbsence((tx) => deciderConge(tx, { demandeId, acteur: { id: utilisateur.id, rolePermissions: utilisateur.rolePermissions }, action, peutAnnulerApresDebut: peutAnnuler, maintenant: new Date() }));

  console.log("Circuit normal : collaborateur → responsable → RH");
  const debut = lundi(2);
  const fin = plus(debut, 2); // lundi à mercredi : 3 jours ouvrables
  const s1 = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: debut, dateFin: fin, motif: "Repos annuel" }, maintenant }));
  verifier("soumission acceptée", s1.ok, s1);
  if (!s1.ok) throw new Error("arrêt");
  const d1 = s1.valeur;
  verifier("étape responsable d'abord", d1.statut === "EN_ATTENTE_RESPONSABLE");
  verifier("destinataire = le responsable seul", d1.destinataires.length === 1 && d1.destinataires[0] === resp.id, d1.destinataires);
  verifier("référence CNG-AAAAMM-NNNN", /^CNG-\d{6}-\d{4}$/.test(d1.reference), d1.reference);
  verifier("3 jours décomptés", d1.nbJours === 3, d1.nbJours);

  const r1 = await agir(rh, d1.id, { type: "APPROUVER" });
  verifier("la RH ne valide pas depuis l'étape responsable (B3)", !r1.ok, r1);
  const r1b = await agir(collab, d1.id, { type: "APPROUVER" });
  verifier("personne ne décide sa propre demande", !r1b.ok, r1b);
  const r2 = await agir(resp, d1.id, { type: "APPROUVER" });
  verifier("le responsable approuve → en attente RH", r2.ok && r2.valeur.statut === "EN_ATTENTE_RH", r2);
  verifier("la RH est prévenue (ni le demandeur ni le DG)", r2.ok && r2.valeur.destinatairesSuivants.includes(rh.id) && !r2.valeur.destinatairesSuivants.includes(collab.id) && !r2.valeur.destinatairesSuivants.includes(dg.id), r2.ok && r2.valeur.destinatairesSuivants);

  console.log("Accord simultané (B4) : un seul débit, un seul jeu de plages");
  const [a, b] = await Promise.all([agir(rh, d1.id, { type: "APPROUVER" }), agir(rh, d1.id, { type: "APPROUVER" })]);
  verifier("exactement un accord réussit", [a, b].filter((x) => x.ok).length === 1, [a, b]);
  const solde = await prisma.soldeConge.findFirstOrThrow({ where: { userId: collab.id, typeCongeId: annuel.id } });
  verifier("solde débité une seule fois (30 → 27)", solde.soldeRestant === 27, solde.soldeRestant);
  const plages = await prisma.plageAbsenceAutorisee.count({ where: { demandeCongeId: d1.id } });
  verifier("3 plages créées une seule fois, liées à la demande", plages === 3, plages);
  const dem1 = await prisma.demandeConge.findUniqueOrThrow({ where: { id: d1.id } });
  verifier("statut VALIDEE, ligne de solde mémorisée", dem1.statut === "VALIDEE" && dem1.soldeCongeId === solde.id && dem1.joursDebites === 3, dem1);

  console.log("Chevauchement et solde");
  const chev = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: plus(debut, 1), dateFin: plus(debut, 4), motif: "Chevauche" }, maintenant }));
  verifier("chevauchement refusé", !chev.ok, chev);
  await prisma.soldeConge.update({ where: { id: solde.id }, data: { soldeRestant: 1 } });
  const trop = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(5), dateFin: plus(lundi(5), 2), motif: "Trop long" }, maintenant }));
  verifier("solde insuffisant refusé", !trop.ok, trop);
  await prisma.soldeConge.update({ where: { id: solde.id }, data: { soldeRestant: 27 } });

  console.log("Pièce jointe piégée (B1)");
  const piege = await transactionAbsence((tx) =>
    soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(6), dateFin: lundi(6), motif: "Piège", piecesJointes: [{ url: "../../../../proc/self/environ" }] }, maintenant })
  );
  verifier("nom de pièce piégé refusé", !piege.ok, piege);

  console.log("Annulation avant le début : solde recrédité, plages supprimées par clé (I3)");
  const ann = await agir(collab, d1.id, { type: "ANNULER", motif: "Plans changés" });
  verifier("annulation par le demandeur", ann.ok && ann.valeur.statut === "ANNULEE" && ann.valeur.effet === "DEFAIRE_ACCORD", ann);
  const solde2 = await prisma.soldeConge.findUniqueOrThrow({ where: { id: solde.id } });
  verifier("solde recrédité (27 → 30)", solde2.soldeRestant === 30, solde2.soldeRestant);
  verifier("plages supprimées", (await prisma.plageAbsenceAutorisee.count({ where: { demandeCongeId: d1.id } })) === 0);

  console.log("Références simultanées (I1)");
  const autres = await Promise.all(
    ["finance", "assistant-finance", "enc-finance", "enc-technique", "responsable-technique"].map(async (e) => (await compte(e)).id)
  );
  const lots = await Promise.all(
    autres.map((id, i) =>
      transactionAbsence((tx) => soumettreConge(tx, { userId: id, entree: { typeCongeId: annuel.id, dateDebut: lundi(8 + i), dateFin: lundi(8 + i), motif: "Simultané" }, maintenant }))
    )
  );
  const refs = lots.filter((x) => x.ok).map((x) => (x.ok ? x.valeur.reference : ""));
  verifier("5 soumissions simultanées, 5 références distinctes", lots.every((x) => x.ok) && new Set(refs).size === 5, lots);

  console.log("Demandeur responsable de son service : étape responsable non requise");
  const sResp = await transactionAbsence((tx) => soumettreConge(tx, { userId: resp.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(10), dateFin: lundi(10), motif: "Responsable" }, maintenant }));
  verifier("directement à la RH", sResp.ok && sResp.valeur.statut === "EN_ATTENTE_RH", sResp);

  console.log("Demandeur RH sans autre compte RH : le DG décide");
  const sRh = await transactionAbsence((tx) => soumettreConge(tx, { userId: rh.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(11), dateFin: lundi(11), motif: "RH demandeur" }, maintenant }));
  verifier("soumise (étape RH tenue par le DG)", sRh.ok, sRh);
  if (sRh.ok) {
    const refusRh = await agir(rh, sRh.valeur.id, { type: "APPROUVER" });
    verifier("la RH demandeur ne décide pas sa demande", !refusRh.ok, refusRh);
    const okDg = await agir(dg, sRh.valeur.id, { type: "APPROUVER" });
    verifier("le DG accorde", okDg.ok && okDg.valeur.statut === "VALIDEE", okDg);
  }

  console.log("Modification demandée puis rejet");
  if (sResp.ok) {
    const mod = await agir(rh, sResp.valeur.id, { type: "DEMANDER_MODIFICATION", motif: "Précisez l'intérim" });
    verifier("modification demandée", mod.ok && mod.valeur.statut === "MODIFICATION_DEMANDEE", mod);
    const rejetSurModif = await agir(rh, sResp.valeur.id, { type: "REJETER", motif: "non" });
    verifier("aucune décision sur une demande à modifier", !rejetSurModif.ok);
  }

  console.log("Congé d'office (RH) et ajustement");
  const off = await transactionAbsence((tx) => accorderCongeOffice(tx, { acteurId: rh.id, userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(12), dateFin: plus(lundi(12), 1), motif: "Fermeture annuelle" }, maintenant }));
  verifier("congé d'office accordé", off.ok, off);
  const soi = await transactionAbsence((tx) => accorderCongeOffice(tx, { acteurId: rh.id, userId: rh.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(13), dateFin: lundi(13), motif: "Pour moi" }, maintenant }));
  verifier("jamais pour soi-même", !soi.ok);
  const s3 = await prisma.soldeConge.findUniqueOrThrow({ where: { id: solde.id } });
  verifier("solde débité de 2 (30 → 28)", s3.soldeRestant === 28, s3.soldeRestant);
  const aj = await transactionAbsence((tx) => ajusterSolde(tx, { soldeCongeId: solde.id, montant: -100, motif: "Trop", acteurId: rh.id }));
  verifier("ajustement qui passerait sous zéro refusé", !aj.ok);
  const aj2 = await transactionAbsence((tx) => ajusterSolde(tx, { soldeCongeId: solde.id, montant: 2, motif: "Régularisation 2025", acteurId: rh.id }));
  verifier("ajustement +2 → 30", aj2.ok && aj2.valeur.soldeRestant === 30, aj2);

  console.log("Observations (C3) : RH à sa décision, DG à tout moment, ajout seul");
  const debutO = lundi(26);
  const sO = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: debutO, dateFin: debutO, motif: "Pour les observations" }, maintenant }));
  if (!sO.ok) throw new Error("préparation C3 : " + JSON.stringify(sO));
  const idO = sO.valeur.id;
  const decider = (acteur: { id: string; rolePermissions: string[] }, action: Parameters<typeof deciderConge>[1]["action"], observation?: string | null) =>
    transactionAbsence((tx) => deciderConge(tx, { demandeId: idO, acteur, action, peutAnnulerApresDebut: false, observation, maintenant: new Date() }));
  const tropLong = await decider(resp, { type: "APPROUVER" }, "x".repeat(501));
  verifier("observation de 501 caractères refusée, rien d'écrit", !tropLong.ok && (await prisma.demandeConge.findUniqueOrThrow({ where: { id: idO } })).statut === "EN_ATTENTE_RESPONSABLE", tropLong);
  const apRESP = await decider(resp, { type: "APPROUVER" }, "  Bon dossier,   à valider. ");
  verifier("le responsable approuve avec une observation", apRESP.ok, apRESP);
  const apRH = await decider(rh, { type: "APPROUVER" }, "RAS côté RH, solde suffisant.");
  verifier("la RH valide avec ses observations", apRH.ok && apRH.valeur.statut === "VALIDEE", apRH);
  const obs = await prisma.observationAbsence.findMany({ where: { demandeCongeId: idO }, orderBy: { createdAt: "asc" } });
  verifier("deux observations, étapes RESPONSABLE puis RH, auteurs exacts", obs.length === 2 && obs[0].etape === "RESPONSABLE" && obs[0].auteurId === resp.id && obs[1].etape === "RH" && obs[1].auteurId === rh.id, obs);
  verifier("espaces nettoyés", obs[0].texte === "Bon dossier, à valider.", obs[0]?.texte);
  const sansObs = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(27), dateFin: lundi(27), motif: "Sans observation" }, maintenant }));
  if (sansObs.ok) {
    await decider2(sansObs.valeur.id, resp, undefined);
    verifier("observation facultative : décision sans observation, aucune ligne créée", (await prisma.observationAbsence.count({ where: { demandeCongeId: sansObs.valeur.id } })) === 0);
    await prisma.demandeConge.delete({ where: { id: sansObs.valeur.id } });
  }
  async function decider2(id: string, acteur: { id: string; rolePermissions: string[] }, observation?: string | null) {
    return transactionAbsence((tx) => deciderConge(tx, { demandeId: id, acteur, action: { type: "APPROUVER" }, peutAnnulerApresDebut: false, observation, maintenant: new Date() }));
  }

  // DG : à tout moment, statut inchangé, destinataires = demandeur + RH, jamais lui-même.
  const avantDG = await prisma.demandeConge.findUniqueOrThrow({ where: { id: idO } });
  const obsDG = await transactionAbsence((tx) => ajouterObservationDG(tx, { nature: "CONGE", demandeId: idO, acteur: dg, texte: "  À suivre   de près.  " }));
  verifier("le DG ajoute une observation sur une demande déjà validée", obsDG.ok, obsDG);
  const apresDG = await prisma.demandeConge.findUniqueOrThrow({ where: { id: idO } });
  verifier("statut, étapes et décideurs inchangés après l'observation du DG", apresDG.statut === avantDG.statut && apresDG.valideParId === avantDG.valideParId && apresDG.approuveParId === avantDG.approuveParId && apresDG.etapeDepuis.getTime() === avantDG.etapeDepuis.getTime());
  if (obsDG.ok) {
    verifier("destinataires : le demandeur et la RH, pas le DG", obsDG.valeur.destinataires.includes(collab.id) && obsDG.valeur.destinataires.includes(rh.id) && !obsDG.valeur.destinataires.includes(dg.id), obsDG.valeur.destinataires);
    const ligneDG = await prisma.observationAbsence.findUniqueOrThrow({ where: { id: obsDG.valeur.observationId } });
    verifier("observation du DG : étape DG, texte nettoyé", ligneDG.etape === "DG" && ligneDG.texte === "À suivre de près.", ligneDG);
  }
  verifier("une entrée d'historique par observation (3)", (await prisma.historiqueEntry.count({ where: { entity: "DemandeConge", entityId: idO, action: "observation" } })) === 3);
  const obsRH = await transactionAbsence((tx) => ajouterObservationDG(tx, { nature: "CONGE", demandeId: idO, acteur: rh, texte: "Je ne suis pas le DG" }));
  verifier("un compte RH (non DG) ne peut pas observer hors décision", !obsRH.ok, obsRH);
  const obsDemandeur = await transactionAbsence((tx) => ajouterObservationDG(tx, { nature: "CONGE", demandeId: idO, acteur: collab, texte: "Je réponds" }));
  verifier("le demandeur ne peut pas ajouter d'observation", !obsDemandeur.ok, obsDemandeur);
  const obsVide = await transactionAbsence((tx) => ajouterObservationDG(tx, { nature: "CONGE", demandeId: idO, acteur: dg, texte: "   " }));
  verifier("observation vide du DG refusée", !obsVide.ok, obsVide);
  // DG sur sa propre demande : le DG du seed dépose une demande, puis tente d'y observer.
  const sDG = await transactionAbsence((tx) => soumettreConge(tx, { userId: dg.id, entree: { typeCongeId: annuel.id, dateDebut: lundi(28), dateFin: lundi(28), motif: "Congé du DG" }, maintenant }));
  if (sDG.ok) {
    const propre = await transactionAbsence((tx) => ajouterObservationDG(tx, { nature: "CONGE", demandeId: sDG.valeur.id, acteur: dg, texte: "Mon propre congé" }));
    verifier("le DG n'observe jamais sa propre demande", !propre.ok, propre);
    await prisma.demandeConge.delete({ where: { id: sDG.valeur.id } });
  }
  // Annulation avec une observation : refusée (une observation accompagne une décision responsable/RH).
  const annulObs = await decider(rh, { type: "ANNULER", motif: "Annulation de test" }, "Observation interdite ici");
  verifier("une observation n'accompagne pas une annulation", !annulObs.ok && (await prisma.demandeConge.findUniqueOrThrow({ where: { id: idO } })).statut === "VALIDEE", annulObs);

  // Ajout seul : le déclencheur refuse la modification et la suppression directe, mais pas la cascade de la demande.
  const uneObs = obs[0].id;
  let erreurUpdate = "";
  try { await prisma.$executeRaw`UPDATE "ObservationAbsence" SET "texte" = 'modifiée' WHERE id = ${uneObs}`; } catch (e) { erreurUpdate = String(e); }
  verifier("modification d'une observation refusée par la base", /OBSERVATION_IMMUABLE/.test(erreurUpdate), erreurUpdate.slice(0, 120));
  let erreurDelete = "";
  try { await prisma.observationAbsence.delete({ where: { id: uneObs } }); } catch (e) { erreurDelete = String(e); }
  verifier("suppression directe d'une observation refusée par la base", /OBSERVATION_IMMUABLE/.test(erreurDelete), erreurDelete.slice(0, 120));
  verifier("les observations sont toujours là", (await prisma.observationAbsence.count({ where: { demandeCongeId: idO } })) === 3);
  await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: idO } });
  await prisma.demandeConge.delete({ where: { id: idO } });
  verifier("la suppression de la demande emporte ses observations (cascade admise)", (await prisma.observationAbsence.count({ where: { demandeCongeId: idO } })) === 0);

  console.log("Pas de congé dans le passé (art. 12)");
  const hier = plus(new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0"), -1);
  const passe = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: hier, dateFin: hier, motif: "Déjà pris" }, maintenant }));
  verifier("soumission avec une date de début passée refusée", !passe.ok && passe.erreur === MESSAGE_CONGE_DANS_LE_PASSE && passe.champ === "dateDebut", passe);
  // Resoumission : la date corrigée ne peut pas non plus être dans le passé.
  const futur = lundi(30);
  const dem = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: futur, dateFin: futur, motif: "À corriger" }, maintenant }));
  if (dem.ok) {
    await prisma.demandeConge.update({ where: { id: dem.valeur.id }, data: { statut: "MODIFICATION_DEMANDEE", motifModification: "Précisez" } });
    const reso = await transactionAbsence((tx) => resoumettreConge(tx, { demandeId: dem.valeur.id, acteurId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: hier, dateFin: hier, motif: "Corrigé" }, maintenant }));
    verifier("resoumission avec une date passée refusée", !reso.ok && reso.erreur === MESSAGE_CONGE_DANS_LE_PASSE, reso);
    await prisma.demandeConge.delete({ where: { id: dem.valeur.id } });
  } else verifier("préparation de la resoumission", false, dem);
  const officePasse = await transactionAbsence((tx) => accorderCongeOffice(tx, { acteurId: rh.id, userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: hier, dateFin: hier, motif: "Régularisation du passé" }, maintenant }));
  verifier("congé d'office avec une date passée accordé (régularisation)", officePasse.ok, officePasse);
  if (officePasse.ok) {
    await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: officePasse.valeur.id } });
    await prisma.demandeConge.delete({ where: { id: officePasse.valeur.id } });
  }

  console.log("Congé annuel : 12 mois de service (art. 12)");
  const embaucheInitiale = (await prisma.user.findUniqueOrThrow({ where: { id: collab.id }, select: { dateEmbauche: true } })).dateEmbauche;
  const debutA = lundi(20);
  /** Date d'embauche située `mois` mois avant `jour`, décalée de `jours` jours (colonne DATE : minuit UTC). */
  const embauche = (jour: string, mois: number, jours: number) => {
    const [an, m, j] = jour.split("-").map(Number);
    return new Date(Date.UTC(an, m - 1 - mois, j + jours));
  };
  try {
    // Il manque exactement un jour pour 12 mois révolus au début du congé.
    await prisma.user.update({ where: { id: collab.id }, data: { dateEmbauche: embauche(debutA, 12, 1) } });
    const refuse = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: debutA, dateFin: debutA, motif: "Trop tôt" }, maintenant }));
    verifier("11 mois et 30 jours : demande refusée", !refuse.ok && /12 mois d'ancienneté/.test(refuse.erreur), refuse);
    const officeOk = await transactionAbsence((tx) => accorderCongeOffice(tx, { acteurId: rh.id, userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: debutA, dateFin: debutA, motif: "Régularisation" }, maintenant }));
    verifier("même salarié : congé d'office (RH) accordé", officeOk.ok, officeOk);
    if (officeOk.ok) {
      await prisma.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: officeOk.valeur.id } });
      await prisma.demandeConge.delete({ where: { id: officeOk.valeur.id } });
    }
    // Douze mois révolus exactement : accepté.
    await prisma.user.update({ where: { id: collab.id }, data: { dateEmbauche: embauche(debutA, 12, 0) } });
    const accepte = await transactionAbsence((tx) => soumettreConge(tx, { userId: collab.id, entree: { typeCongeId: annuel.id, dateDebut: debutA, dateFin: debutA, motif: "Douze mois révolus" }, maintenant }));
    verifier("12 mois révolus : demande acceptée", accepte.ok, accepte);
  } finally {
    await prisma.user.update({ where: { id: collab.id }, data: { dateEmbauche: embaucheInitiale } });
  }

  console.log("Nombre de jours par an paramétrable (C1) : soldes créés ensuite seulement");
  const avantJours = (await prisma.typeConge.findUniqueOrThrow({ where: { id: annuel.id } })).nbJoursDefaut;
  const existant = await prisma.soldeConge.findFirstOrThrow({ where: { userId: collab.id, typeCongeId: annuel.id }, orderBy: { exercice: "desc" } });
  // Le lendemain de la fin du dernier exercice existant : l'initialisation crée forcément l'exercice SUIVANT.
  const dansUnAn = plus(existant.dateFinExercice.toISOString().slice(0, 10), 1);
  try {
    await prisma.typeConge.update({ where: { id: annuel.id }, data: { nbJoursDefaut: 28 } });
    const init = await transactionAbsence((tx) => initialiserSoldesExercice(tx, { reference: dansUnAn, acteurId: rh.id }));
    verifier("initialisation du nouvel exercice réussie", init.ok, init);
    const nouveau = await prisma.soldeConge.findFirst({ where: { userId: collab.id, typeCongeId: annuel.id, exercice: { gt: existant.exercice } } });
    verifier("le solde du NOUVEL exercice reçoit la nouvelle valeur (28)", nouveau?.soldeInitial === 28 && nouveau?.soldeRestant === 28, nouveau);
    const inchange = await prisma.soldeConge.findUniqueOrThrow({ where: { id: existant.id } });
    verifier("le solde EXISTANT n'est pas touché", inchange.soldeInitial === existant.soldeInitial && inchange.soldeRestant === existant.soldeRestant, inchange);
  } finally {
    await prisma.soldeConge.deleteMany({ where: { userId: collab.id, typeCongeId: annuel.id, exercice: { gt: existant.exercice } } });
    await prisma.soldeConge.deleteMany({ where: { typeCongeId: annuel.id, exercice: { gt: existant.exercice } } });
    await prisma.typeConge.update({ where: { id: annuel.id }, data: { nbJoursDefaut: avantJours } });
  }

  const hist = await prisma.historiqueEntry.count({ where: { entity: "DemandeConge" } });
  verifier("historique écrit à chaque transition", hist >= 10, hist);

  console.log(`\n${ok} vérifications réussies, ${ko} échec(s).`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
