// Gestion Compta, lot GC-8b — TAXE EN BASE sur une vraie base PostgreSQL JETABLE (jamais la base de dev).
// Lancé depuis la racine du dépôt (voir e2e/compta-gc1a-schema.sh, étape 17) sur une base FRAÎCHE dont toutes les migrations sont
// appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données 100 % synthétiques.
//  - T1 (taxe sur 2 500 seulement), T3 (1,5 %), T5 (1 500 sans contrat : avance de 101, non redemandée au rattachement) ;
//  - reliquat exact sur trois rattachements d'une même échéance ; idempotence ; taux manquant puis rattrapage ;
//  - mois d'une ligne quand le mois de la date de valeur est déjà déclaré.
import { prisma } from "../backend/src/prisma";
import { validerRattachementsCpt } from "../backend/src/cptRattachement";
import { appliquerTaxeRattachementsCpt, rattraperTaxesManquantesCpt, taxerEncaissementCpt } from "../backend/src/cptTaxeDb";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai taxe" } });
  const tech = await prisma.user.create({ data: { fullName: "Technique", email: "compta-gc8b-tech@simassurances.test", roleId: role.id } });
  const rf = await prisma.user.create({ data: { fullName: "RFCRH", email: "compta-gc8b-rf@simassurances.test", roleId: role.id } });
  const compte = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const pAcc = await prisma.cptProduit.create({ data: { code: "RELAXMOTO", libelle: "Relax Moto", branche: "ACCIDENTS" } });
  const pCond = await prisma.cptProduit.create({ data: { code: "INDIVIDUELLE-CONDUCTEUR", libelle: "Individuelle conducteur", branche: "ACCIDENTS" } });
  const pSante = await prisma.cptProduit.create({ data: { code: "SANTE-GROUPE", libelle: "Santé groupe", branche: "SANTE" } });
  const pInc = await prisma.cptProduit.create({ data: { code: "INC-X", libelle: "Incendie X", branche: "INCENDIE" } });
  await prisma.cptTauxTca.createMany({
    data: [
      { branche: "ACCIDENTS", taux: "0.0725", dateEffet: new Date("2000-01-01"), creeParId: tech.id },
      { branche: "SANTE", natureContrat: "GROUPE", taux: "0.015", dateEffet: new Date("2000-01-01"), creeParId: tech.id },
    ],
  });
  const client = await prisma.cptClient.create({ data: { nom: "Client Taxe" } });

  async function contrat(numPolice: string, produitId: string, nature: "INDIVIDUEL" | "GROUPE", echeances: { du: number; taxe: number }[]) {
    const total = echeances.reduce((s, e) => s + e.du, 0);
    const c = await prisma.cptContrat.create({
      data: { numPolice, produitId, natureContrat: nature, clientId: client.id, dateEffet: new Date("2026-01-01"), dateEcheance: new Date("2026-12-31"), primeNetteHt: total, primeTtc: total, creeParId: tech.id },
    });
    const echs = [];
    for (const [i, e] of echeances.entries()) {
      echs.push(
        await prisma.cptEcheance.create({
          data: { contratId: c.id, rang: i + 1, periodeDebut: new Date("2026-01-01"), periodeFin: new Date("2026-01-28"), datePrevue: new Date("2026-01-05"), primeTtc: e.du, primeHt: e.du - e.taxe, taxe: e.taxe, montantDu: e.du },
        })
      );
    }
    return { c, echs };
  }
  let n = 0;
  const encaissement = (montant: number, dateValeur: string, pasUnePrime = 0) =>
    prisma.cptEncaissement.create({
      data: {
        reference: `CPE-2026-8${String(++n).padStart(5, "0")}`,
        compteId: compte.id,
        referenceReleve: `T_TAXE${String(n).padStart(6, "0")}`,
        dateValeur: new Date(dateValeur),
        montant,
        typeFlux: "ENCAISSEMENT",
        resteARattacher: montant - pasUnePrime,
        montantPasUnePrime: pasUnePrime,
        motifPasUnePrime: pasUnePrime ? "Frais de carte santé" : null,
        creeParId: tech.id,
      },
    });
  const rattacher = async (encaissementId: string, echeanceId: string, montant: number) => {
    const r = await prisma.cptRattachement.create({ data: { encaissementId, echeanceId, montant, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "essai" } });
    const res = await prisma.$transaction((tx) => validerRattachementsCpt(tx, [r.id], { userId: rf.id }), { timeout: 60_000 });
    return { id: r.id, ok: res.ok && res.resultats.every((x) => x.ok) };
  };
  const lignesDe = (where: object) => prisma.cptLigneTaxe.findMany({ where, orderBy: { creeAt: "asc" } });
  const somme = (l: { montant: unknown }[]) => l.reduce((s, x) => s + num(x.montant as never), 0);

  // ---------- T1 ----------
  const t1 = await contrat("POL-T1", pAcc.id, "INDIVIDUEL", [{ du: 2500, taxe: 169 }]);
  const e1 = await encaissement(4500, "2026-02-03", 2000);
  const r1 = await rattacher(e1.id, t1.echs[0].id, 2500);
  const l1 = await lignesDe({ encaissementId: e1.id });
  verifier("T1 : rattachement validé", r1.ok);
  verifier("T1 : une seule ligne, taxe 169 sur une base de 2 500 (les 2 000 « pas une prime » ne sont pas taxés)", l1.length === 1 && num(l1[0].montant) === 169 && num(l1[0].base) === 2500 && l1[0].origine === "RATTACHEMENT", JSON.stringify(l1.map((x) => [x.origine, num(x.base), num(x.montant)])));
  verifier("T1 : mois = mois de la date de valeur", l1[0]?.moisDeclaration.toISOString().slice(0, 10) === "2026-02-01");

  // ---------- T3 ----------
  const t3 = await contrat("POL-T3", pSante.id, "GROUPE", [{ du: 50000, taxe: 739 }, { du: 50000, taxe: 739 }]);
  const e3 = await encaissement(50000, "2026-02-10");
  await rattacher(e3.id, t3.echs[0].id, 50000);
  const l3 = await lignesDe({ encaissementId: e3.id });
  verifier("T3 : 50 000 à 1,5 % → taxe 739, taux 1,5 %", l3.length === 1 && num(l3[0].montant) === 739 && num(l3[0].taux) === 0.015);

  // ---------- T5 ----------
  const e5 = await encaissement(1500, "2026-02-12");
  const av = await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: e5.id, produitCode: "INDIVIDUELLE-CONDUCTEUR" }, { userId: tech.id }));
  verifier("T5 : 1 500 sans contrat → avance de taxe 101 dans le mois", av.ok && av.taxe === "101.00" && av.mois === "2026-02-01", JSON.stringify(av));
  const av2 = await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: e5.id, produitCode: "INDIVIDUELLE-CONDUCTEUR" }, { userId: tech.id }));
  verifier("T5 : une seconde avance sur le même encaissement est refusée", !av2.ok);
  const t5 = await contrat("POL-T5", pCond.id, "INDIVIDUEL", [{ du: 1500, taxe: 101 }]);
  await rattacher(e5.id, t5.echs[0].id, 1500);
  const l5 = await lignesDe({ encaissementId: e5.id });
  verifier("T5 : au rattachement, avance + rattachement + imputation", l5.map((x) => x.origine).join(",") === "AVANCE,RATTACHEMENT,IMPUTATION", l5.map((x) => x.origine).join(","));
  verifier("T5 : taxe NON redemandée — total de l'encaissement = 101", somme(l5) === 101, String(somme(l5)));
  verifier("T5 : l'imputation annule exactement la base de l'avance", l5.reduce((s, x) => s + num(x.base), 0) === 1500);

  // ---------- Reliquat exact ----------
  const rel = await contrat("POL-REL", pAcc.id, "INDIVIDUEL", [{ du: 10000, taxe: 725 }]);
  const parts = [3333, 3333, 3334];
  for (const m of parts) {
    const e = await encaissement(m, "2026-02-20");
    await rattacher(e.id, rel.echs[0].id, m);
  }
  const lrel = await lignesDe({ echeanceId: rel.echs[0].id });
  verifier("reliquat : trois rattachements, taxe totale exactement 725", somme(lrel) === 725 && lrel.length === 3, lrel.map((x) => num(x.montant)).join("+"));

  // ---------- Idempotence ----------
  const avant = await prisma.cptLigneTaxe.count();
  const rejeu = await prisma.$transaction((tx) => appliquerTaxeRattachementsCpt(tx, [r1.id], { userId: rf.id }));
  verifier("idempotence : un rattachement déjà taxé n'écrit rien", rejeu.lignesCreees === 0 && rejeu.dejaTaxes === 1 && (await prisma.cptLigneTaxe.count()) === avant);

  // ---------- Taux manquant puis rattrapage ----------
  const inc = await contrat("POL-INC", pInc.id, "INDIVIDUEL", [{ du: 2500, taxe: 278 }]);
  const eInc = await encaissement(2500, "2026-02-25");
  const rInc = await rattacher(eInc.id, inc.echs[0].id, 2500);
  verifier("taux manquant : le rattachement est validé mais aucune ligne n'est écrite", rInc.ok && (await lignesDe({ encaissementId: eInc.id })).length === 0);
  const eInc2 = await encaissement(1000, "2026-02-25");
  const avInc = await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: eInc2.id, produitCode: "INC-X" }, { userId: tech.id }));
  verifier("taux manquant : l'avance est refusée sans zéro deviné", !avInc.ok && /taux/i.test((avInc as { message: string }).message));
  await prisma.cptTauxTca.create({ data: { branche: "INCENDIE", taux: "0.125", dateEffet: new Date("2000-01-01"), creeParId: tech.id } });
  const rat = await prisma.$transaction((tx) => rattraperTaxesManquantesCpt(tx, { userId: rf.id }));
  const lInc = await lignesDe({ encaissementId: eInc.id });
  verifier("rattrapage : une fois le taux saisi, la ligne est écrite (taxe 278)", rat.lignesCreees === 1 && lInc.length === 1 && num(lInc[0].montant) === 278, JSON.stringify(rat));

  // ---------- Mois déjà déclaré ----------
  await prisma.$executeRawUnsafe(`INSERT INTO "CptDeclarationTca" (id, reference, mois, "montantDu", "montantDejaPaye", "montantAPayer", "nbLignes", "declareParId") VALUES ('d-fev', 'CPD-2026-01', '2026-02-01', 0, 0, 0, 0, '${rf.id}')`);
  const tard = await contrat("POL-TARD", pAcc.id, "INDIVIDUEL", [{ du: 2500, taxe: 169 }]);
  const eTard = await encaissement(2500, "2026-02-27");
  await rattacher(eTard.id, tard.echs[0].id, 2500);
  const lTard = await lignesDe({ encaissementId: eTard.id });
  verifier("mois déjà déclaré : la ligne va au premier mois non déclaré (mars)", lTard[0]?.moisDeclaration.toISOString().slice(0, 10) === "2026-03-01");

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-8b : ${resultats.length - ko} contrôle(s) réussi(s), ${ko} échec(s).`);
  if (ko > 0) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
