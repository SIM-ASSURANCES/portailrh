// Gestion Compta, lot GC-8f — RAPPELS DE LA TAXE (les 10 et 17), couche base, sur une vraie base PostgreSQL JETABLE (jamais la base de dev),
// à HORLOGE SIMULÉE : chaque appel reçoit sa propre date. Lancé depuis la racine (voir e2e/compta-gc1a-schema.sh, étape 18) sur une base
// FRAÎCHE dont toutes les migrations sont appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données synthétiques.
//  1. module non mis en service : rien n'est lu, réservé ni envoyé ;
//  2. premier passage après la mise en service : aucun envoi (pas d'arriéré), le marqueur est posé, le rappel du créneau est réservé en silence ;
//  3. le 17 : le rappel « déclarer » part une seule fois (deux exécutions simultanées, un seul envoi) ;
//  4. mois déclaré non payé : le rappel devient « payer » ; mois payé : plus aucun rappel ;
//  5. une tâche rattrapée le 12 vaut le créneau du 10 ; avant le 10, rien ; un mois sans taxe n'est jamais rappelé ;
//  6. jour limite paramétré : le message en tient compte.
import { prisma } from "../backend/src/prisma";
import { reserverRappelsTcaCpt } from "../backend/src/cptRappelTcaDb";
import { declarerMoisTcaCpt, enregistrerPaiementTcaCpt } from "../backend/src/cptTaxeDb";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const h = (iso: string) => new Date(`${iso}T08:00:00Z`);

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");
  const role = await prisma.role.create({ data: { name: "Rôle d'essai rappels taxe" } });
  const rf = await prisma.user.create({ data: { fullName: "RFCRH", email: "compta-gc8f-rf@simassurances.test", roleId: role.id } });
  const produit = await prisma.cptProduit.create({ data: { code: "P1", libelle: "Produit 1", branche: "ACCIDENTS" } });
  const compte = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const client = await prisma.cptClient.create({ data: { nom: "Client Rappel" } });
  const contrat = await prisma.cptContrat.create({ data: { numPolice: "POL-RAPPEL", produitId: produit.id, natureContrat: "INDIVIDUEL", clientId: client.id, dateEffet: new Date("2026-01-01"), dateEcheance: new Date("2026-12-31"), primeNetteHt: 2500, primeTtc: 2500, creeParId: rf.id } });
  const echeance = await prisma.cptEcheance.create({ data: { contratId: contrat.id, rang: 1, periodeDebut: new Date("2026-01-01"), periodeFin: new Date("2026-01-28"), datePrevue: new Date("2026-01-05"), primeTtc: 2500, primeHt: 2331, taxe: 169, montantDu: 2500 } });
  const enc = await prisma.cptEncaissement.create({ data: { reference: "CPE-2026-870001", compteId: compte.id, referenceReleve: "T_RAPPEL0001", dateValeur: new Date("2026-10-12"), montant: 2500, typeFlux: "ENCAISSEMENT", resteARattacher: 2500, creeParId: rf.id } });
  // Ligne de taxe d'octobre (via une avance par produit : c'est ce qui rend le mois « à déclarer »).
  await prisma.cptTauxTca.create({ data: { branche: "ACCIDENTS", taux: "0.0725", dateEffet: new Date("2000-01-01"), creeParId: rf.id } });
  const { taxerEncaissementCpt } = await import("../backend/src/cptTaxeDb");
  const av = await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: enc.id, produitCode: "P1" }, { userId: rf.id }));
  verifier("jeu d'essai : taxe d'octobre calculée (169)", av.ok && av.taxe === "169.00");
  void echeance;

  // 1. Module hors service.
  const r1 = await reserverRappelsTcaCpt(prisma, h("2026-11-10"));
  verifier("1. module non mis en service : aucun rappel, aucune réservation", !r1.moduleMisEnService && r1.aEnvoyer.length === 0 && (await prisma.marqueurUnique.count({ where: { cle: { startsWith: "compta.rappel" } } })) === 0);

  await prisma.cptMiseEnService.create({ data: { activeeParId: rf.id, sauvegardeSha256: "sha-synthetique-rappel" } });

  // 2. Premier passage : aucun envoi.
  const r2 = await reserverRappelsTcaCpt(prisma, h("2026-11-10"));
  verifier("2. premier passage : aucun envoi, le rappel du 10 est réservé en silence", r2.premierPassage && r2.aEnvoyer.length === 0 && r2.silencieux === 1, JSON.stringify(r2));
  verifier("2. le marqueur du premier passage est posé", (await prisma.marqueurUnique.count({ where: { cle: "compta.rappels_tca_initiaux" } })) === 1);
  const r2bis = await reserverRappelsTcaCpt(prisma, h("2026-11-10"));
  verifier("2. second passage le même jour : rien (déjà réservé)", r2bis.aEnvoyer.length === 0 && r2bis.dejaFait && !r2bis.premierPassage);

  // 3. Le 17 : un seul rappel, même avec deux exécutions simultanées.
  const [a, b] = await Promise.all([reserverRappelsTcaCpt(prisma, h("2026-11-17")), reserverRappelsTcaCpt(prisma, h("2026-11-17"))]);
  const envois = [...a.aEnvoyer, ...b.aEnvoyer];
  verifier("3. le 17 : deux exécutions simultanées, un seul rappel « déclarer »", envois.length === 1 && envois[0].type === "DECLARER" && envois[0].permission === "cpt.declarer_tca", JSON.stringify(envois.map((e) => e.type)));
  verifier("3. le message cite le mois, le jour limite et les jours restants", /2026-10/.test(envois[0].message.titre) && /20\/11\/2026 \(il reste 3 jours\)/.test(envois[0].message.message), envois[0].message.message);
  const r3 = await reserverRappelsTcaCpt(prisma, h("2026-11-18"));
  verifier("3. rattrapage le 18 : le créneau du 17 est déjà fait, pas de double rappel", r3.aEnvoyer.length === 0 && r3.dejaFait);

  // 4. Déclaration puis paiement.
  const decl = await prisma.$transaction((tx) => declarerMoisTcaCpt(tx, { mois: "2026-10-01" }, { userId: rf.id, maintenant: h("2026-11-18") }));
  verifier("4. déclaration d'octobre", decl.ok);
  const r4 = await reserverRappelsTcaCpt(prisma, h("2026-12-10")); // décembre : mois concerné = novembre (sans taxe) → rien
  verifier("5. un mois sans taxe n'est jamais rappelé (novembre au 10 décembre)", r4.aEnvoyer.length === 0 && !r4.dejaFait);
  // Pour tester « payer », on rejoue un créneau de novembre avec octobre déclaré : on simule le 10 novembre d'une autre année serait artificiel ;
  // on déclare donc d'abord octobre PUIS on réserve avec une horloge qui désigne octobre (le 10 novembre ... déjà réservé) : on utilise un mois neuf.
  await prisma.cptEncaissement.create({ data: { reference: "CPE-2026-870002", compteId: compte.id, referenceReleve: "T_RAPPEL0002", dateValeur: new Date("2026-11-05"), montant: 1000, typeFlux: "ENCAISSEMENT", resteARattacher: 1000, creeParId: rf.id } });
  const enc2 = await prisma.cptEncaissement.findUniqueOrThrow({ where: { reference: "CPE-2026-870002" } });
  await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: enc2.id, produitCode: "P1" }, { userId: rf.id }));
  const r5 = await reserverRappelsTcaCpt(prisma, h("2026-12-17"));
  verifier("4. novembre non déclaré au 17 décembre : rappel « déclarer »", r5.aEnvoyer.length === 1 && r5.aEnvoyer[0].type === "DECLARER" && /20\/12\/2026 \(il reste 3 jours\)/.test(r5.aEnvoyer[0].message.message), JSON.stringify(r5.aEnvoyer.map((e) => e.type)));
  const decl2 = await prisma.$transaction((tx) => declarerMoisTcaCpt(tx, { mois: "2026-11-01" }, { userId: rf.id, maintenant: h("2026-12-17") }));
  verifier("4. déclaration de novembre", decl2.ok);
  // Même mois et même créneau déjà réservé en « déclarer » : le rappel « payer » est un autre type, donc une autre réservation.
  const r6 = await reserverRappelsTcaCpt(prisma, h("2026-12-18"));
  verifier("4. mois déclaré non payé : le rappel devient « payer » (clé distincte)", r6.aEnvoyer.length === 1 && r6.aEnvoyer[0].type === "PAYER" && r6.aEnvoyer[0].permission === "cpt.payer_tca", JSON.stringify(r6.aEnvoyer.map((e) => e.type)));
  const pay = await prisma.$transaction((tx) => enregistrerPaiementTcaCpt(tx, { declarationId: decl2.ok ? decl2.declarationId : "", saisie: { quittanceNumero: "Q-RAPPEL", quittanceDate: "2026-12-18", quittanceMontant: "68", datePaiement: "2026-12-18" } }, { userId: rf.id, maintenant: h("2026-12-18") }));
  verifier("4. paiement de novembre", pay.ok);
  const r7 = await reserverRappelsTcaCpt(prisma, h("2026-12-19"));
  verifier("4. mois payé : plus aucun rappel", r7.aEnvoyer.length === 0);

  // 5. Avant le 10 : rien.
  const r8 = await reserverRappelsTcaCpt(prisma, h("2027-01-09"));
  verifier("5. avant le 10 : aucun créneau, aucun rappel", r8.creneau === null && r8.aEnvoyer.length === 0);

  // 6. Jour limite paramétré à 15.
  await prisma.$executeRaw`UPDATE "CptParametre" SET valeur = '15' WHERE cle = 'tca.jour_limite_paiement'`;
  await prisma.cptEncaissement.create({ data: { reference: "CPE-2026-870003", compteId: compte.id, referenceReleve: "T_RAPPEL0003", dateValeur: new Date("2026-12-04"), montant: 1000, typeFlux: "ENCAISSEMENT", resteARattacher: 1000, creeParId: rf.id } });
  const enc3 = await prisma.cptEncaissement.findUniqueOrThrow({ where: { reference: "CPE-2026-870003" } });
  await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: enc3.id, produitCode: "P1" }, { userId: rf.id }));
  const r9 = await reserverRappelsTcaCpt(prisma, h("2027-01-10"));
  verifier("6. jour limite paramétré à 15 : le message le dit", r9.aEnvoyer.length === 1 && /15\/01\/2027 \(il reste 5 jours\)/.test(r9.aEnvoyer[0].message.message), r9.aEnvoyer[0]?.message.message);

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-8f rappels : ${resultats.length - ko} contrôle(s) réussi(s), ${ko} échec(s).`);
  if (ko > 0) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
