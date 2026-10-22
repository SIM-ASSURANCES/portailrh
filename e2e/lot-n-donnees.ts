// Lot N — remplit une base JETABLE de données de test dans TOUTES les tables « purgées » du circuit, du pointage, de FeedbackApp,
// d'Encaissements et des journaux, ET de données de configuration à conserver (catégories, budgets validés avec historique et
// action signée, date de catégorisation, délégation, signatures enrôlées, notifications ADMIN, repère de signatures…).
// Lancé par e2e/lot-n.mjs : `cd backend && npx tsx ../e2e/lot-n-donnees.ts` (DATABASE_URL = base jetable).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../backend/src/generated/prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost:55497/.test(url)) throw new Error("DATABASE_URL doit viser la base jetable (localhost:55497).");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const u = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;
  const collab = await u("collaborateur@simassurances.test");
  const finance = await u("finance@simassurances.test");
  const assistant = await u("assistant-finance@simassurances.test");
  const dg = await u("dg@simassurances.test");
  const rh = await u("rh@simassurances.test");
  const maintenant = new Date();
  const jour = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()));

  // ---------------- CONFIGURATION À CONSERVER ----------------
  const categorie = await prisma.categorie.create({ data: { label: "Transport (lot N)" } });
  await prisma.objet.create({ data: { label: "Carburant (lot N)", categorieId: categorie.id } });
  const sigImage = Buffer.from("iVBORw0KGgo=", "base64");
  // Ajoute une version de signature (la suivante du compte : e2e/signatures-auto.mjs a pu en enrôler une avant).
  const nouvelleVersion = async (userId: string, empreinte: string) => {
    const derniere = await prisma.signatureUtilisateur.aggregate({ where: { userId }, _max: { version: true } });
    return prisma.signatureUtilisateur.create({ data: { userId, version: (derniere._max.version ?? 0) + 1, image: sigImage, largeur: 600, hauteur: 200, empreinte } });
  };
  const sigFinance = await nouvelleVersion(finance, "n-finance-a");
  await nouvelleVersion(finance, "n-finance-b");
  const sigDg = await nouvelleVersion(dg, "n-dg-a");
  // Budget de catégorie validé par le DG, avec son historique de validation ET l'action signée qui y est liée
  const budget = await prisma.budgetParametrage.create({
    data: { portee: "CATEGORIE", categorieId: categorie.id, montant: 500000, dateDebut: jour, modeSeuil: "POURCENTAGE", seuilOrange: 20, seuilRouge: 0, statut: "VALIDE", soumisParId: finance, decideParId: dg, decideAt: maintenant },
  });
  const budgetSigne = await prisma.actionSignee.create({ data: { signataireId: dg, signatureId: sigDg.id, action: "deciderBudgetsCategoriesAction", entite: "BudgetParametrage", entiteId: budget.id, ip: "10.0.0.1" } });
  await prisma.historiqueEntry.create({ data: { entity: "BudgetParametrage", entityId: budget.id, action: "budget_valide", detail: "validé par le DG (lot N)", userId: dg, actionSigneeId: budgetSigne.id } });
  // Seuils de caisse validés
  await prisma.budgetParametrage.create({ data: { portee: "GLOBAL", dateDebut: jour, modeSeuil: "MONTANT", seuilOrange: 100000, seuilRouge: 0, statut: "VALIDE", soumisParId: finance, decideParId: dg, decideAt: maintenant } });
  await prisma.parametreTresorerie.upsert({ where: { cle: "categorisation.obligatoire_a_partir_du" }, create: { cle: "categorisation.obligatoire_a_partir_du", valeurDate: new Date(Date.UTC(2027, 0, 15)), majParId: finance }, update: { valeurDate: new Date(Date.UTC(2027, 0, 15)) } });
  const permissionRh = await prisma.permission.findFirstOrThrow({ where: { key: "pointage.corriger_pointage" } });
  await prisma.permissionDelegation.create({ data: { donneurId: rh, beneficiaireId: collab, permissionId: permissionRh.id } });
  await prisma.notification.create({ data: { titre: "Alerte admin (lot N)", message: "à conserver", userId: finance, category: "ADMIN" } });
  await prisma.notification.create({ data: { titre: "Alerte système (lot N)", message: "à conserver", userId: finance, category: "SYSTEME" } });
  await prisma.historiqueEntry.create({ data: { entity: "User", entityId: collab, action: "audit_conserve", detail: "audit à conserver", userId: finance } });
  await prisma.marqueurUnique.upsert({ where: { cle: "lot-n.marqueur" }, create: { cle: "lot-n.marqueur" }, update: {} });
  const branche = await prisma.encBranche.create({ data: { code: "LOTN", libelle: "Branche lot N", creeParId: finance } });
  await prisma.encPartenaire.create({ data: { cleNom: "partenaire-lot-n", nom: "Partenaire lot N", creeParId: finance } });

  // ---------------- DONNÉES DE TEST (purgées) ----------------
  const demande = await prisma.demande.create({
    data: { reference: "TEST-N-1", montant: 100000, montantValide: 100000, beneficiaireType: "COLLABORATEUR", etapeCircuit: "TERMINEE", statut: "REGLEE", createurId: collab, descriptionDemandeur: "demande de test" } as never,
  });
  const ligne = await prisma.ligneDemande.create({ data: { demandeId: demande.id, libelle: "Article test", quantite: 1, prixUnitaire: 100000, statutValidation: "VALIDEE", decideParId: finance, decideAt: maintenant, categorieId: categorie.id } });
  const reglement = await prisma.reglement.create({ data: { demandeId: demande.id, ligneDemandeId: ligne.id, auteurId: assistant, montant: 100000, mode: "CAISSE", estConfirme: true, confirmeAt: maintenant, motif: "Règlement de test" } });
  await prisma.reglementCategorieAllocation.create({ data: { reglementId: reglement.id, categorieId: categorie.id, montant: 100000 } });
  await prisma.journalCaisse.create({ data: { type: "ENTREE", montant: 500000, source: "solde_ouverture", refId: "ouverture", userId: assistant } });
  await prisma.journalCaisse.create({ data: { type: "SORTIE", montant: 100000, source: "reglement", refId: reglement.id, userId: assistant, demandeId: demande.id } });
  await prisma.journalBanque.create({ data: { type: "SORTIE", montant: 1000, reglementId: reglement.id, creeParId: assistant } });
  const retour = await prisma.retourCaisse.create({ data: { reglementId: reglement.id, declarantId: collab, montantARetourner: 20000 } });
  await prisma.depenseLigne.create({ data: { retourCaisseId: retour.id, montant: 80000, objet: "Dépense test", date: maintenant, justification: "SANS_PIECE" } });
  const signalement = await prisma.signalementRetour.create({ data: { retourCaisseId: retour.id, commentaire: "erreur de test sur le retour", signaleParId: collab } });
  const pj = await prisma.pieceJointe.create({ data: { url: "lot-n-test.pdf", demandeId: demande.id } });
  const pj2 = await prisma.pieceJointe.create({ data: { url: "lot-n-test-2.pdf" } });
  await prisma.remboursementRetour.create({ data: { retourCaisseId: retour.id, signalementId: signalement.id, montant: 1000, motif: "remboursement de test", pieceJointeId: pj.id, proposeParId: assistant } });
  await prisma.retourExceptionnel.create({ data: { demandeId: demande.id, montant: 500, motif: "retour exceptionnel de test", saisiParId: assistant } });
  await prisma.retourExterne.create({ data: { montantChequeInitial: 5000, montantRetourne: 5000, motif: "retour externe de test", pieceJointeId: pj2.id, creeParId: finance, nomExterne: "Externe test" } as never });
  await prisma.budgetDepassement.create({ data: { demandeId: demande.id, statut: "UTILISE", resume: "dépassement de test", demandeParId: finance } });
  const action = await prisma.actionSignee.create({ data: { signataireId: finance, signatureId: sigFinance.id, action: "validerLignesAction", demandeId: demande.id, ip: "10.0.0.1" } });
  await prisma.historiqueEntry.create({ data: { entity: "Demande", entityId: demande.id, action: "validation_ligne", detail: "test", userId: finance, actionSigneeId: action.id } });
  await prisma.historiqueEntry.create({ data: { entity: "LigneDemande", entityId: ligne.id, action: "validation_ligne", detail: "test", userId: finance } });
  await prisma.historiqueEntry.create({ data: { entity: "JournalCaisse", entityId: "x", action: "alimentation", detail: "test", userId: finance } });
  await prisma.historiqueEntry.create({ data: { entity: "RetourExterne", entityId: "x", action: "retour_externe", detail: "test", userId: finance } });
  await prisma.notification.create({ data: { titre: "Trésorerie test", message: "à purger", userId: finance, category: "TRESORERIE" } });

  // Pointage / FeedbackApp / absences
  const pointage = await prisma.pointage.create({ data: { type: "ARRIVEE", source: "ORDINATEUR", heure: maintenant, estRetard: true, minutesRetard: 10, userId: collab } });
  await prisma.justificationPointage.create({ data: { pointageId: pointage.id } });
  await prisma.correctionPointage.create({ data: { pointageId: pointage.id, ancienneValeur: "08:00", nouvelleValeur: "08:10", motif: "correction de test", effectueParId: rh } });
  await prisma.absence.create({ data: { date: jour, userId: collab } });
  await prisma.plageAbsenceAutorisee.create({ data: { date: jour, heureDebut: "08:00", heureFin: "17:00", source: "CONGE", userId: collab } as never });
  // Congés (lot Q) : une demande validée avec sa plage d'absence liée, une demande rejetée (la purge du Pointage seul la refuserait aussi),
  // leur historique ; la notification de catégorie RH ci-dessous est celle de la RH. Jour férié : configuration conservée.
  const congeValide = await prisma.demandeConge.create({
    data: { reference: "CNG-LOTN-0001", nature: "CONGE", motif: "Congé de test (lot N)", dateDebut: jour, dateFin: jour, nbJoursOuvres: 1, statut: "VALIDEE", userId: collab, creeParId: collab, approuveParId: finance, approuveAt: maintenant, valideParId: rh, valideAt: maintenant },
  });
  await prisma.plageAbsenceAutorisee.create({ data: { date: jour, heureDebut: "08:00", heureFin: "17:00", source: "CONGE", userId: collab, demandeCongeId: congeValide.id } as never });
  const congeRejete = await prisma.demandeConge.create({
    data: { reference: "CNG-LOTN-0002", nature: "PERMISSION_EXCEPTIONNELLE", motif: "Permission de test (lot N)", dateDebut: jour, dateFin: jour, nbJoursOuvres: 1, statut: "REJETEE", motifRejet: "rejet de test", userId: collab, creeParId: collab, valideParId: rh, valideAt: maintenant },
  });
  await prisma.historiqueEntry.create({ data: { entity: "DemandeConge", entityId: congeValide.id, action: "validation", detail: "test", userId: rh } });
  await prisma.historiqueEntry.create({ data: { entity: "DemandeConge", entityId: congeRejete.id, action: "rejet", detail: "test", userId: rh } });
  await prisma.jourFerie.upsert({ where: { date: new Date(Date.UTC(2027, 0, 1)) }, create: { date: new Date(Date.UTC(2027, 0, 1)), libelle: "Jour de l'an (lot N)" }, update: {} });
  await prisma.feedback.create({ data: { content: "Avis de test suffisamment long pour passer.", source: "PUBLIC", recipientId: collab } as never });
  await prisma.notification.create({ data: { titre: "Pointage test", message: "à purger", userId: collab, category: "POINTAGE" } });
  await prisma.notification.create({ data: { titre: "RH test", message: "à purger", userId: rh, category: "RH" } });
  await prisma.historiqueEntry.create({ data: { entity: "Pointage", entityId: pointage.id, action: "pointage", detail: "test", userId: collab } });
  await prisma.historiqueEntry.create({ data: { entity: "JustificationPointage", entityId: "x", action: "soumission_justification", detail: "test", userId: collab } });

  // Techniques
  await prisma.executionTache.create({ data: { tache: "RELANCES_JUSTIFICATION", declenchement: "MANUEL", debut: maintenant, fin: maintenant, statut: "SUCCES" } });
  await prisma.journalTechnique.create({ data: { niveau: "ERREUR", source: "EMAIL", code: "SMTP_ECHEC", message: "incident de test" } });

  // Encaissements (module pas encore en service)
  const imp = await prisma.encImport.create({ data: { type: "PRODUCTION", statut: "VALIDE", nomFichier: "test.xlsx", sha256: "n".repeat(64), nbLignes: 1, importeParId: finance, importeAt: maintenant } as never });
  const contrat = await prisma.encContrat.create({ data: { numPolice: "POL-N-1", brancheId: branche.id, dateEffet: jour, S: 1000, T: 700, U: 100, V: 100, W: 50, X: 50, creeParImportId: imp.id } as never });
  await prisma.encContratMot.create({ data: { contratId: contrat.id, mot: "poln1" } });
  await prisma.encEncaissement.create({ data: { paiementId: "PAI-2026-000001", contratId: contrat.id, brancheId: branche.id, source: "FICHIER", datePaiement: jour, mode: "ORANGE_MONEY", Z: 1000, dateSaisie: maintenant, saisiParId: finance } as never });
  await prisma.encSignalement.create({ data: { importId: imp.id, analyse: "DOUBLON_POSSIBLE", niveau: "A_TRAITER", statut: "A_TRAITER", detail: "signalement de test" } as never });
  await prisma.encSequence.upsert({ where: { cle: "PAI-2026" }, create: { cle: "PAI-2026", valeur: 1 }, update: { valeur: 1 } });
  await prisma.encAudit.create({ data: { entite: "EncContrat", entiteId: contrat.id, action: "import_production", userId: finance } });
  await prisma.encPieceJointe.create({ data: { url: "enc-lot-n.xlsx", mime: "application/vnd.ms-excel", taille: 10, sha256: "m".repeat(64), deposeeParId: finance } });

  console.log("Base remplie (lot N).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
