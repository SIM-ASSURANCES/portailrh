// Gestion Compta, lot GC-4d — IMPORT DES RELEVÉS sur une vraie base PostgreSQL JETABLE (jamais la base de dev).
// Lancé depuis la racine du dépôt par e2e/compta-gc1a-schema.sh (étape 12), sur une base FRAÎCHE « compta_rel » dont toutes les
// migrations sont appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données 100 % synthétiques.
//  1. un relevé Wave aux cas variés : crédit, remboursement, transaction test, débit, ligne illisible, référence en double ;
//  2. le même fichier ne s'importe qu'une fois ; un relevé réexporté avec recouvrement ne recrée rien de ce qui existe (T9) ;
//  3. virement Wave → BNI : l'autre côté passe en virement interne, transfert créé (T9) ;
//  4. refus : compte d'un autre type, mois clôturé ; deux imports simultanés du même fichier ;
//  5. numérotation CPE par année, lignes hors période signalées ;
//  6. COMPTA_PERF=1 : COMPTA_PERF_N lignes (10 000 par défaut) avec N virements à apparier, durée de l'import.
import { createHash } from "node:crypto";

import { prisma } from "../backend/src/prisma";
import { appliquerImportReleveCpt, CptImportReleveError } from "../backend/src/cptImportReleve";
import { formatReleveProposeCpt, lireReleveCpt, type TypeReleveCpt } from "../backend/src/cptReleve";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const ENTETE_WAVE = "Horodatage,Identifiant de transaction,Type de transaction,Montant brut,Frais,Montant net,Contrepartie,Téléphone,Identifiant de session,Référence client";
const ENTETE_BANQUE = "Date de valeur,Référence,Libellé,Débit,Crédit";
const ENTETE_HORS_BUSINESS = "Horodatage,Identifiant de transaction,Montant,Frais,Contrepartie,Téléphone,Libellé";
const fichier = (entete: string, lignes: string[]) => Buffer.from([entete, ...lignes].join("\n"), "utf8");

let compteurFichiers = 0;
async function importer(
  type: TypeReleveCpt,
  compteId: string,
  contenu: Buffer,
  userId: string,
  extra: { periode?: string } = {}
) {
  const lecture = lireReleveCpt(contenu, formatReleveProposeCpt(type));
  const empreinte = createHash("sha256").update(contenu).digest("hex");
  const piece = await prisma.cptPieceJointe.create({
    data: { url: `releve-${++compteurFichiers}-${empreinte.slice(0, 8)}.csv`, mime: "text/csv", taille: contenu.length, sha256: empreinte, deposeeParId: userId },
  });
  return prisma.$transaction(
    (tx) => appliquerImportReleveCpt(tx, { type, compteId, lecture: lecture.lecture, lignes: lecture.lignes, formatId: null, fichierId: piece.id, empreinte, userId, ...extra }),
    { timeout: 300_000, maxWait: 10_000 }
  );
}

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai relevés" } });
  const user = await prisma.user.create({ data: { fullName: "Compte d'essai", email: "compta-gc4d@simassurances.test", roleId: role.id } });
  const wave = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const bni = await prisma.cptCompte.create({ data: { libelle: "BNI", type: "BANQUE" } });
  const horsBusiness = await prisma.cptCompte.create({ data: { libelle: "Wave perso", type: "WAVE_HORS_BUSINESS" } });

  // ---------- 1. Le relevé Wave aux cas variés ----------
  const waveMars = fichier(ENTETE_WAVE, [
    "2026-03-02 10:15:00,T_WAVE000001,merchant_payment,100000,1000,99000,Awa Kone,+225 07 00 00 00 01,cos-aaa,POL-1",
    "2026-03-03 11:00:00,T_WAVE000002,refund,-2000,0,-2000,Yao Brou,,,",
    "2026-03-04 12:00:00,T_WAVE000003,api_checkout,100,2,98,TEST,,cos-bbb,",
    "2026-03-10 09:00:00,T_WAVE000004,transfer,-300000,0,-300000,SIM Assurances,,,",
    "2026-03-05 09:00:00,T_WAVE000005,merchant_payment,beaucoup,,,Illisible,,,",
    "2026-03-06 09:00:00,T_WAVE000001,merchant_payment,5,0,5,Doublon,,,",
  ]);
  const r1 = await importer("RELEVE_WAVE_BUSINESS", wave.id, waveMars, user.id);
  const b1 = r1.bilan;
  verifier("six lignes lues, deux rejetées (montant illisible, référence en double), quatre créées", b1.lignesLues === 6 && b1.lignesRejetees === 2 && b1.encaissementsCrees === 4, JSON.stringify({ l: b1.lignesLues, r: b1.lignesRejetees, c: b1.encaissementsCrees }));
  verifier("types : un crédit, un remboursement, un test, un débit", b1.parType.ENCAISSEMENT === 1 && b1.parType.REMBOURSEMENT === 1 && b1.parType.TEST === 1 && b1.parType.AUTRE_DEBIT === 1, JSON.stringify(b1.parType));
  verifier("le mois du relevé est mars 2026", b1.periode === "2026-03-01");

  const lignes1 = await prisma.cptEncaissement.findMany({ where: { compteId: wave.id }, orderBy: { reference: "asc" } });
  verifier("numéros CPE-2026-000001 à 000004 dans l'ordre du fichier", lignes1.map((l) => l.reference).join(",") === "CPE-2026-000001,CPE-2026-000002,CPE-2026-000003,CPE-2026-000004", lignes1.map((l) => l.reference).join(","));
  const credit = lignes1[0];
  verifier("le crédit : à rattacher, reste = montant, frais, payeur, téléphone, session, référence client conservés", credit.statut === "A_RATTACHER" && credit.resteARattacher.toString() === "100000" && credit.frais.toString() === "1000" && credit.payeur === "Awa Kone" && credit.telephone === "+2250700000001" && credit.sessionPaiement === "cos-aaa" && credit.referenceClient === "POL-1" && credit.typeSource === "merchant_payment");
  verifier("le remboursement est enregistré en valeur positive, sans objet, reste nul", lignes1[1].typeFlux === "REMBOURSEMENT" && lignes1[1].montant.toString() === "2000" && lignes1[1].statut === "SANS_OBJET" && lignes1[1].resteARattacher.toString() === "0");
  verifier("la transaction test et le débit sont sans objet", lignes1[2].typeFlux === "TEST" && lignes1[2].statut === "SANS_OBJET" && lignes1[3].typeFlux === "AUTRE_DEBIT" && lignes1[3].statut === "SANS_OBJET");
  verifier("chaque ligne porte son relevé et son numéro de ligne du fichier", lignes1.every((l) => l.releveId === r1.releveId) && lignes1.map((l) => l.ligneReleve).join(",") === "2,3,4,5");

  const releve1 = await prisma.cptReleve.findUnique({ where: { id: r1.releveId } });
  verifier("le relevé totalise les crédits créés (100 000 : la transaction test n'est pas de l'argent reçu) et les frais (1 002)", releve1?.nbLignes === 4 && releve1.totalCredits.toString() === "100000" && releve1.totalFrais.toString() === "1002", `${releve1?.totalCredits} / ${releve1?.totalFrais}`);

  const types1 = new Set((await prisma.cptAnomalie.findMany({ where: { importId: r1.importId }, select: { type: true } })).map((a) => a.type));
  for (const attendu of ["MONTANT_MANQUANT", "REFERENCE_EN_DOUBLE", "CELLULE_ILLISIBLE"]) verifier(`anomalie « ${attendu} » enregistrée`, types1.has(attendu));
  verifier("aucune trace des deux lignes rejetées", (await prisma.cptEncaissement.count({ where: { compteId: wave.id, referenceReleve: { in: ["T_WAVE000005"] } } })) === 0);

  const audits1 = await prisma.cptAudit.groupBy({ by: ["entite", "action"], _count: true, where: { entite: { in: ["CptEncaissement", "CptImport"] } } });
  const nb = (entite: string, action: string) => audits1.find((a) => a.entite === entite && a.action === action)?._count ?? 0;
  verifier("audit : 4 créations d'encaissement et 1 import de relevé", nb("CptEncaissement", "creation") === 4 && nb("CptImport", "import_releve") === 1);

  // ---------- 2. Un même fichier une seule fois ; recouvrement ----------
  const avant = { enc: await prisma.cptEncaissement.count(), imp: await prisma.cptImport.count(), rel: await prisma.cptReleve.count(), seq: (await prisma.cptSequence.findUnique({ where: { cle: "CPE-2026" } }))?.valeur };
  let message = "";
  try {
    await importer("RELEVE_WAVE_BUSINESS", wave.id, waveMars, user.id);
  } catch (e) {
    message = e instanceof CptImportReleveError ? e.message : String(e);
  }
  verifier("le même fichier importé deux fois est refusé", message.includes("déjà été importé"), message);
  const apres = { enc: await prisma.cptEncaissement.count(), imp: await prisma.cptImport.count(), rel: await prisma.cptReleve.count(), seq: (await prisma.cptSequence.findUnique({ where: { cle: "CPE-2026" } }))?.valeur };
  verifier("le refus n'a rien laissé : ni encaissement, ni import, ni relevé, ni numéro consommé", JSON.stringify(avant) === JSON.stringify(apres), JSON.stringify({ avant, apres }));

  const reexport = fichier(ENTETE_WAVE, [
    "2026-03-02 10:15:00,T_WAVE000001,merchant_payment,100000,1000,99000,Awa Kone,+225 07 00 00 00 01,cos-aaa,POL-1",
    "2026-03-03 11:00:00,T_WAVE000002,refund,-2000,0,-2000,Yao Brou,,,",
    "2026-03-12 14:00:00,T_WAVE000006,merchant_payment,25000,0,25000,Bamba Yao,,,POL-2",
  ]);
  const r2 = await importer("RELEVE_WAVE_BUSINESS", wave.id, reexport, user.id);
  verifier("un relevé réexporté : 2 lignes déjà importées ignorées, 1 nouvelle créée", r2.bilan.lignesDejaImportees === 2 && r2.bilan.encaissementsCrees === 1, JSON.stringify({ d: r2.bilan.lignesDejaImportees, c: r2.bilan.encaissementsCrees }));
  verifier("la numérotation continue (CPE-2026-000005)", (await prisma.cptEncaissement.findFirst({ where: { referenceReleve: "T_WAVE000006" } }))?.reference === "CPE-2026-000005");
  verifier("aucun doublon de ligne : 5 encaissements Wave", (await prisma.cptEncaissement.count({ where: { compteId: wave.id } })) === 5);
  const releve2 = await prisma.cptReleve.findUnique({ where: { id: r2.releveId } });
  verifier("le second relevé ne totalise que ses lignes créées (25 000)", releve2?.nbLignes === 1 && releve2.totalCredits.toString() === "25000");

  // ---------- 3. Virement Wave → BNI (T9) ----------
  const bniMars = fichier(ENTETE_BANQUE, [
    "2026-03-11,VIR-BNI-0001,VIREMENT RECU DE WAVE,,300000",
    "2026-03-12,CHQ-BNI-0002,REMISE CHEQUE CLIENT,,50000",
    "2026-03-15,FRS-BNI-0003,FRAIS DE TENUE DE COMPTE,1500,",
  ]);
  const r3 = await importer("RELEVE_BANQUE", bni.id, bniMars, user.id);
  verifier("relevé BNI : un virement apparié, un crédit client, des frais", r3.bilan.virementsApparies === 1 && r3.bilan.parType.VIREMENT_INTERNE_ENTRANT === 1 && r3.bilan.parType.ENCAISSEMENT === 1 && r3.bilan.parType.FRAIS === 1, JSON.stringify(r3.bilan.parType));
  const w4 = await prisma.cptEncaissement.findFirst({ where: { compteId: wave.id, referenceReleve: "T_WAVE000004" } });
  verifier("la ligne Wave déjà en base est devenue un virement interne sortant, sans objet", w4?.typeFlux === "VIREMENT_INTERNE_SORTANT" && w4.statut === "SANS_OBJET" && w4.resteARattacher.toString() === "0");
  const vir = await prisma.cptEncaissement.findFirst({ where: { compteId: bni.id, referenceReleve: "VIR-BNI-0001" } });
  const transfert = await prisma.cptTransfertInterne.findFirst({ where: { encaissementEntrantId: vir?.id } });
  verifier("le transfert interne relie la ligne Wave (sortant) et la ligne BNI (entrant), comptes source et cible corrects", transfert?.encaissementSortantId === w4?.id && transfert?.compteSourceId === wave.id && transfert?.compteCibleId === bni.id);
  verifier("la ligne BNI est un virement entrant sans objet, jamais une prime à rattacher", vir?.typeFlux === "VIREMENT_INTERNE_ENTRANT" && vir.statut === "SANS_OBJET");
  verifier("audit de la reconnaissance tracé sur la ligne Wave", (await prisma.cptAudit.count({ where: { entite: "CptEncaissement", entiteId: w4?.id, action: "reconnaissance_virement" } })) === 1);
  const releve3 = await prisma.cptReleve.findUnique({ where: { id: r3.releveId } });
  verifier("relevé BNI : crédits 350 000, aucun frais de carte (les frais de tenue sont un débit)", releve3?.totalCredits.toString() === "350000" && releve3.totalFrais.toString() === "0");
  const chq = await prisma.cptEncaissement.findFirst({ where: { compteId: bni.id, referenceReleve: "CHQ-BNI-0002" } });
  verifier("le crédit client BNI reste à rattacher", chq?.typeFlux === "ENCAISSEMENT" && chq.statut === "A_RATTACHER" && chq.resteARattacher.toString() === "50000");
  verifier("la même référence sur un autre compte n'est pas un doublon (RG-04 par compte)", (await prisma.cptEncaissement.count({ where: { referenceReleve: "VIR-BNI-0001" } })) === 1);
  verifier("le trigger de la base garde l'immuabilité : le montant d'une ligne ne change toujours pas", await (async () => {
    try {
      await prisma.cptEncaissement.update({ where: { id: chq!.id }, data: { montant: "1" } });
      return false;
    } catch (e) {
      return String(e).includes("CPT_IMMUABLE");
    }
  })());

  // ---------- 4. Refus, concurrence ----------
  const avant4 = { enc: await prisma.cptEncaissement.count(), imp: await prisma.cptImport.count() };
  let msgType = "";
  try {
    await importer("RELEVE_WAVE_BUSINESS", bni.id, fichier(ENTETE_WAVE, ["2026-03-20 10:00:00,T_AUTRE000001,merchant_payment,100,0,100,X,,,"]), user.id);
  } catch (e) {
    msgType = e instanceof CptImportReleveError ? e.message : String(e);
  }
  verifier("un relevé Wave ne s'importe pas dans le compte d'une banque", msgType.includes("ne peut pas recevoir un relevé de ce type"), msgType);
  verifier("ce refus n'a rien écrit", (await prisma.cptEncaissement.count()) === avant4.enc && (await prisma.cptImport.count()) === avant4.imp);

  await prisma.cptPeriode.create({ data: { mois: new Date("2026-02-01T00:00:00.000Z"), statut: "CLOTUREE", clotureeParId: user.id, clotureeAt: new Date() } });
  const rClos = await importer("RELEVE_WAVE_BUSINESS", wave.id, fichier(ENTETE_WAVE, ["2026-02-10 10:00:00,T_FEVR000001,merchant_payment,100,0,100,X,,,"]), user.id);
  verifier("un mois clôturé : la ligne est rejetée, rien n'est créé", rClos.bilan.encaissementsCrees === 0 && rClos.bilan.lignesRejetees === 1);
  verifier("anomalie « PERIODE_CLOTUREE » enregistrée", (await prisma.cptAnomalie.count({ where: { importId: rClos.importId, type: "PERIODE_CLOTUREE" } })) === 1);

  const concurrent = fichier(ENTETE_WAVE, ["2026-03-20 10:00:00,T_CONC000001,merchant_payment,777,0,777,X,,,"]);
  const [a, b] = await Promise.allSettled([importer("RELEVE_WAVE_BUSINESS", wave.id, concurrent, user.id), importer("RELEVE_WAVE_BUSINESS", wave.id, concurrent, user.id)]);
  const reussis = [a, b].filter((x) => x.status === "fulfilled").length;
  verifier("deux imports simultanés du même fichier : un seul réussit", reussis === 1, `${reussis} réussi(s)`);
  verifier("une seule ligne créée pour cette référence", (await prisma.cptEncaissement.count({ where: { compteId: wave.id, referenceReleve: "T_CONC000001" } })) === 1);

  // ---------- 5. Numérotation par année, hors période ----------
  const anneeCharniere = fichier(ENTETE_HORS_BUSINESS, ["2025-12-31 10:00:00,T_HB00000001,10000,0,A,,x", "2026-01-02 10:00:00,T_HB00000002,20000,0,B,,y"]);
  const r5 = await importer("RELEVE_WAVE_HORS_BUSINESS", horsBusiness.id, anneeCharniere, user.id, { periode: "2025-12-01" });
  const hb = await prisma.cptEncaissement.findMany({ where: { compteId: horsBusiness.id }, orderBy: { dateValeur: "asc" } });
  verifier("le numéro suit l'année de la date de valeur (CPE-2025-000001, puis la suite de 2026)", hb[0].reference === "CPE-2025-000001" && /^CPE-2026-0000\d\d$/.test(hb[1].reference), hb.map((x) => x.reference).join(","));
  verifier("la ligne datée de janvier est signalée « hors période » mais importée", r5.bilan.encaissementsCrees === 2 && (await prisma.cptAnomalie.count({ where: { importId: r5.importId, type: "HORS_PERIODE" } })) === 1);

  // ---------- 6. Performance ----------
  if (process.env.COMPTA_PERF === "1") {
    const N = Number(process.env.COMPTA_PERF_N ?? 10_000);
    const montant = (i: number) => 1000 + i;
    const banque = fichier(ENTETE_BANQUE, Array.from({ length: N }, (_, i) => `2026-05-05,PERF-BNI-${i},VIREMENT ${i},,${montant(i)}`));
    const t0 = Date.now();
    const rB = await importer("RELEVE_BANQUE", bni.id, banque, user.id);
    const d1 = Date.now() - t0;
    const wavePerf = fichier(ENTETE_WAVE, Array.from({ length: N }, (_, i) => `2026-05-05 10:00:00,T_PERF${String(i).padStart(8, "0")},transfer,-${montant(i)},0,-${montant(i)},SIM,,,`));
    const t1 = Date.now();
    const rW = await importer("RELEVE_WAVE_BUSINESS", wave.id, wavePerf, user.id);
    const d2 = Date.now() - t1;
    console.log(`Relevé bancaire de ${N} lignes : ${(d1 / 1000).toFixed(1)} s ; relevé Wave de ${N} débits avec ${rW.bilan.virementsApparies} virements à apparier : ${(d2 / 1000).toFixed(1)} s`);
    verifier(`relevé bancaire de ${N} lignes : toutes créées`, rB.bilan.encaissementsCrees === N, `${rB.bilan.encaissementsCrees}`);
    verifier(`relevé Wave de ${N} lignes : tous les virements appariés`, rW.bilan.virementsApparies === N, `${rW.bilan.virementsApparies}`);
    verifier(`deux imports de ${N} lignes + rapprochement en moins de 2 minutes`, d1 + d2 < 120_000, `${((d1 + d2) / 1000).toFixed(1)} s`);
  }

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-4d (import des relevés) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
