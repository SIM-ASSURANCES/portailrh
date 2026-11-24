// Gestion Compta, lot GC-3c — IMPORT DU BORDEREAU DE PRODUCTION sur une vraie base PostgreSQL JETABLE (jamais la base de dev).
// Lancé depuis la racine du dépôt par e2e/compta-gc1a-schema.sh (étape 10), sur une base FRAÎCHE « compta_imp » dont toutes les
// migrations sont appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données 100 % synthétiques.
//  1. un CSV de neuf lignes aux cas variés : contrats créés avec acte et échéancier, lignes rejetées, doublon, acte à traiter ;
//  2. recherche par mots sur les contrats créés ;
//  3. le même fichier ne s'importe qu'une fois, et l'échec n'a rien laissé ;
//  4. deux imports simultanés d'une même police : un seul contrat, aucune erreur d'unicité ;
//  5. COMPTA_PERF=1 : COMPTA_PERF_N lignes (10 000 par défaut), durée de l'import.
import { createHash } from "node:crypto";

import { prisma } from "../backend/src/prisma";
import { appliquerImportProductionCpt, CptImportProductionError } from "../backend/src/cptImportProduction";
import { lireTableurSelonFormat } from "../backend/src/cptImportLecture";
import { validerDefinitionFormat } from "../backend/src/cptFormatImport";
import { rechercherCpt } from "../backend/src/cptRecherche";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const ENTETES = ["Police", "Produit", "Type", "Client", "Tel", "Partenaire", "Fractionnement", "Effet", "Echeance", "Mode", "Reference", "DatePaiement", "TTC", "Accessoires", "Taxe", "Paye"] as const;
const COLONNES = [
  { entete: "Police", champ: "numPolice", type: "texte", obligatoire: true },
  { entete: "Produit", champ: "produit", type: "texte", obligatoire: true },
  { entete: "Type", champ: "typeOperation", type: "texte", obligatoire: false },
  { entete: "Client", champ: "client", type: "texte", obligatoire: false },
  { entete: "Tel", champ: "telephone", type: "texte", obligatoire: false },
  { entete: "Partenaire", champ: "partenaire", type: "texte", obligatoire: false },
  { entete: "Fractionnement", champ: "fractionnement", type: "texte", obligatoire: false },
  { entete: "Effet", champ: "dateEffet", type: "date", obligatoire: true },
  { entete: "Echeance", champ: "dateEcheance", type: "date", obligatoire: true },
  { entete: "Mode", champ: "modePaiement", type: "texte", obligatoire: false },
  { entete: "Reference", champ: "referencePaiement", type: "texte", obligatoire: false },
  { entete: "DatePaiement", champ: "datePaiement", type: "date", obligatoire: false },
  { entete: "TTC", champ: "primeTtc", type: "montant", obligatoire: true },
  { entete: "Accessoires", champ: "accessoires", type: "montant", obligatoire: false },
  { entete: "Taxe", champ: "taxe", type: "montant", obligatoire: false },
  { entete: "Paye", champ: "montantPaye", type: "montant", obligatoire: false },
];

type Ligne = Partial<Record<(typeof ENTETES)[number], string>>;
const csv = (lignes: Ligne[]) => Buffer.from([ENTETES.join(","), ...lignes.map((l) => ENTETES.map((e) => l[e] ?? "").join(","))].join("\n"), "utf8");

let compteurFichiers = 0;
async function importer(contenu: Buffer, userId: string) {
  const definition = validerDefinitionFormat({ ligneEntete: 1, colonnes: COLONNES });
  if (!definition.ok) throw new Error(definition.erreurs.join(" | "));
  const lecture = lireTableurSelonFormat(contenu, definition.definition);
  const empreinte = createHash("sha256").update(contenu).digest("hex");
  const piece = await prisma.cptPieceJointe.create({
    data: { url: `essai-${++compteurFichiers}-${empreinte.slice(0, 8)}.csv`, mime: "text/csv", taille: contenu.length, sha256: empreinte, deposeeParId: userId },
  });
  return prisma.$transaction((tx) => appliquerImportProductionCpt(tx, { lecture, formatId: null, fichierId: piece.id, empreinte, userId }), { timeout: 300_000, maxWait: 10_000 });
}

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai import" } });
  const user = await prisma.user.create({ data: { fullName: "Compte d'essai", email: "compta-gc3c@simassurances.test", roleId: role.id } });
  await prisma.cptProduit.create({ data: { code: "P1", libelle: "Produit un", branche: "ACCIDENTS" } });
  await prisma.cptPartenaire.create({ data: { nom: "Courtier A", estApporteur: true } });

  // ---------- 1. Le fichier aux cas variés ----------
  const fichier = csv([
    { Police: "POL-001", Produit: "P1", Client: "Awa Kone", Tel: "0700000001", Partenaire: "Courtier A", Fractionnement: "Mensuel", Effet: "2026-01-01", Echeance: "2026-12-31", Mode: "Wave", Reference: "T_ABCDEFGHIJ1", DatePaiement: "2026-01-02", TTC: "120000", Paye: "10000" },
    { Police: "POL-002", Produit: "ZZZ", Client: "Inconnu", Effet: "2026-01-01", Echeance: "2026-12-31", TTC: "5000" },
    { Police: "POL-003", Produit: "P1", Client: "Bamba Yao", Tel: "0700000002", Partenaire: "Courtier Fantôme", Fractionnement: "Comptant", Effet: "2026-02-01", Echeance: "2027-01-31", TTC: "60000" },
    { Police: "POL-004", Produit: "P1", Client: "Date Inverse", Effet: "2026-06-01", Echeance: "2026-01-01", TTC: "5000" },
    { Police: "POL-001", Produit: "P1", Client: "Awa Kone", Tel: "0700000001", Partenaire: "Courtier A", Fractionnement: "Mensuel", Effet: "2026-01-01", Echeance: "2026-12-31", Mode: "Wave", Reference: "T_ABCDEFGHIJ1", DatePaiement: "2026-01-02", TTC: "120000", Paye: "10000" },
    { Police: "POL-005", Produit: "P1", Effet: "2026-03-01", Echeance: "2026-12-31", TTC: "0" },
    { Police: "POL-006", Produit: "P1", Type: "Retrait", Client: "Retrait Seul", Effet: "2026-03-01", Echeance: "2026-12-31", TTC: "-5000" },
    { Police: "POL-007", Produit: "P1", Fractionnement: "Libre", Effet: "2026-04-01", Echeance: "2026-12-31", TTC: "90000" },
    { Police: "POL-001", Produit: "P1", Type: "Renouvellement", Client: "Awa Kone", Tel: "0700000001", Effet: "2027-01-01", Echeance: "2027-12-31", TTC: "130000" },
  ]);
  const { importId, bilan } = await importer(fichier, user.id);

  verifier("neuf lignes lues", bilan.lignesLues === 9, `${bilan.lignesLues}`);
  verifier("quatre contrats créés (POL-001, 003, 005, 007)", bilan.contratsCrees === 4, `${bilan.contratsCrees}`);
  verifier("trois lignes rejetées (produit inconnu, dates inversées, retrait sans contrat)", bilan.lignesRejetees === 3, `${bilan.lignesRejetees}`);
  verifier("un doublon exact de POL-001 reconnu comme inchangé", bilan.lignesInchangees === 1, `${bilan.lignesInchangees}`);
  verifier("un renouvellement sur police connue laissé au lot des actes", bilan.actesATraiter === 1, `${bilan.actesATraiter}`);
  verifier("quatre actes d'origine créés", bilan.actesCrees === 4, `${bilan.actesCrees}`);
  verifier("treize échéances (12 + 1, la prime offerte et la fraction libre n'en ont pas)", bilan.echeancesCreees === 13, `${bilan.echeancesCreees}`);
  verifier("trois clients créés (Awa Kone, Bamba Yao, client non renseigné)", bilan.clientsCrees === 3, `${bilan.clientsCrees}`);

  const contratsEnBase = await prisma.cptContrat.count({ where: { importId } });
  verifier("quatre contrats en base, tous rattachés à l'import", contratsEnBase === 4, `${contratsEnBase}`);
  const pol1 = await prisma.cptContrat.findUnique({ where: { numPolice: "POL-001" }, include: { echeances: { orderBy: { rang: "asc" } }, actes: true, partenaireApporteur: true, client: true } });
  verifier("POL-001 : 12 échéances de 10 000", pol1?.echeances.length === 12 && pol1.echeances.every((e) => e.montantDu.toString() === "10000"), `${pol1?.echeances.length}`);
  verifier("POL-001 : somme des échéances = prime TTC", pol1 !== null && pol1.echeances.reduce((a, e) => a + Number(e.montantDu), 0) === 120000);
  verifier("POL-001 : un acte d'affaire nouvelle, apporteur et client rattachés", pol1?.actes.length === 1 && pol1.actes[0].type === "AFFAIRE_NOUVELLE" && pol1.partenaireApporteur?.nom === "Courtier A" && pol1.client.nom === "Awa Kone");
  verifier("POL-001 : paiement déclaré enregistré (référence Wave)", pol1?.declarePaye === true && pol1.referencePaiementDeclaree === "T_ABCDEFGHIJ1" && pol1.modePaiementDeclare === "WAVE");
  const pol3 = await prisma.cptContrat.findUnique({ where: { numPolice: "POL-003" } });
  verifier("POL-003 : partenaire inconnu → contrat sans apporteur", pol3 !== null && pol3.partenaireApporteurId === null);
  const pol5 = await prisma.cptContrat.findUnique({ where: { numPolice: "POL-005" }, include: { echeances: true } });
  verifier("POL-005 (prime offerte) : contrat sans échéance", pol5 !== null && pol5.echeances.length === 0);
  verifier("aucune trace des polices rejetées", (await prisma.cptContrat.count({ where: { numPolice: { in: ["POL-002", "POL-004", "POL-006"] } } })) === 0);

  const types = new Set((await prisma.cptAnomalie.findMany({ where: { importId }, select: { type: true } })).map((a) => a.type));
  for (const attendu of ["PRODUIT_INCONNU", "DATES_INCOHERENTES", "ACTE_SANS_CONTRAT", "PARTENAIRE_INCONNU", "LIGNE_EN_DOUBLE", "ACTE_A_TRAITER", "ECHEANCIER_NON_GENERE"]) {
    verifier(`anomalie « ${attendu} » enregistrée`, types.has(attendu));
  }
  const toutesAnomalies = await prisma.cptAnomalie.count({ where: { importId, statut: "A_TRAITER" } });
  verifier("toutes les anomalies sont « à traiter » et comptées au bilan", toutesAnomalies === bilan.anomaliesCreees, `${toutesAnomalies}/${bilan.anomaliesCreees}`);

  const imp = await prisma.cptImport.findUnique({ where: { id: importId } });
  verifier("l'import porte son bilan et le statut VALIDE", imp?.statut === "VALIDE" && imp.bilan !== null);
  const audits = await prisma.cptAudit.groupBy({ by: ["entite", "action"], _count: true, where: { entite: { in: ["CptContrat", "CptImport", "CptClient"] } } });
  const nb = (entite: string, action: string) => audits.find((a) => a.entite === entite && a.action === action)?._count ?? 0;
  verifier("audit : 4 créations de contrat, 3 de client, 1 import", nb("CptContrat", "creation") === 4 && nb("CptClient", "creation") === 3 && nb("CptImport", "import_production") === 1);

  // ---------- 2. Recherche ----------
  const parMot = async (saisie: string) => (await rechercherCpt(prisma, saisie, { entite: "CONTRAT" })).map((r) => r.entiteId);
  verifier("recherche « pol 001 » trouve POL-001", pol1 !== null && (await parMot("pol 001")).includes(pol1.id));
  verifier("recherche par client (« kone ») trouve le contrat", pol1 !== null && (await parMot("kone")).includes(pol1.id));
  verifier("recherche par référence de paiement (« t_abcd ») trouve le contrat", pol1 !== null && (await parMot("t_abcd")).includes(pol1.id));
  verifier("recherche par apporteur (« courtier ») trouve les contrats concernés", pol1 !== null && (await parMot("courtier")).includes(pol1.id));

  // ---------- 3. Un même fichier, une seule fois ----------
  let refus = "";
  try {
    await importer(fichier, user.id);
  } catch (e) {
    refus = e instanceof CptImportProductionError ? e.message : `erreur inattendue : ${String(e)}`;
  }
  verifier("le même fichier est refusé", refus.includes("déjà été importé"), refus);
  verifier("le refus n'a rien laissé (4 contrats, 1 import)", (await prisma.cptContrat.count()) === 4 && (await prisma.cptImport.count()) === 1);

  // ---------- 4. Deux imports simultanés d'une même police ----------
  const cible = (client: string) => csv([{ Police: "POL-100", Produit: "P1", Client: client, Effet: "2026-05-01", Echeance: "2026-12-31", TTC: "30000" }]);
  const [a, b] = await Promise.allSettled([importer(cible("Client Un"), user.id), importer(cible("Client Deux"), user.id)]);
  verifier("deux imports simultanés de POL-100 réussissent tous les deux", a.status === "fulfilled" && b.status === "fulfilled", `${a.status}/${b.status}${a.status === "rejected" ? ` ${String(a.reason)}` : ""}${b.status === "rejected" ? ` ${String(b.reason)}` : ""}`);
  verifier("un seul contrat POL-100", (await prisma.cptContrat.count({ where: { numPolice: "POL-100" } })) === 1);
  if (a.status === "fulfilled" && b.status === "fulfilled") {
    const crees = [a.value.bilan.contratsCrees, b.value.bilan.contratsCrees].sort();
    verifier("l'un crée le contrat, l'autre le reconnaît", crees[0] === 0 && crees[1] === 1, JSON.stringify(crees));
  }

  // ---------- 5. Performance (facultative) ----------
  if (process.env.COMPTA_PERF === "1") {
    const N = Number(process.env.COMPTA_PERF_N ?? 10000);
    const lignes: Ligne[] = Array.from({ length: N }, (_, i) => ({
      Police: `PERF-${String(i).padStart(6, "0")}`,
      Produit: "P1",
      Client: `Client ${i % 3000}`,
      Tel: `07${String(i % 3000).padStart(8, "0")}`,
      Partenaire: "Courtier A",
      Fractionnement: i % 3 === 0 ? "Mensuel" : "Comptant",
      Effet: "2026-07-01",
      Echeance: "2027-06-30",
      TTC: String(60000 + (i % 50) * 1000),
    }));
    const contenu = csv(lignes);
    const t0 = Date.now();
    const r = await importer(contenu, user.id);
    const duree = Date.now() - t0;
    console.log(`Import de ${N} lignes : ${(duree / 1000).toFixed(1)} s — ${r.bilan.contratsCrees} contrats, ${r.bilan.echeancesCreees} échéances, ${r.bilan.clientsCrees} clients, ${r.bilan.anomaliesCreees} anomalies`);
    verifier(`import de ${N} lignes : tous les contrats créés`, r.bilan.contratsCrees === N, `${r.bilan.contratsCrees}`);
    verifier(`import de ${N} lignes en moins de 2 minutes`, duree < 120_000, `${(duree / 1000).toFixed(1)} s`);
  }

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-3c (import de production) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
