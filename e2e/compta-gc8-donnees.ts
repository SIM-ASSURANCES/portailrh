// Gestion Compta, lot GC-8 — jeu d'essai du script e2e/compta-gc8.mjs. Passe par les VRAIES fonctions de la couche base (validation d'un
// rattachement, avance de taxe) pour que la taxe soit celle du moteur, jamais recopiée à la main. Base JETABLE seulement.
//   phase « fevrier » : T1 (4 500 dont 2 000 « pas une prime »), T3 (groupe santé 1,5 %), T5 (1 500 sans contrat, avance de 101 puis rattachement),
//                       un contrat INCENDIE sans taux (liste « taux manquant ») ;
//   phase « mars »    : un contrat accidents de 1 500 (taxe 101) encaissé en mars.
import { prisma } from "../backend/src/prisma";
import { validerRattachementsCpt } from "../backend/src/cptRattachement";
import { taxerEncaissementCpt } from "../backend/src/cptTaxeDb";

const phase = process.argv[2];
if (!/e2e|compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable.");

async function main() {
  const rf = await prisma.user.findUniqueOrThrow({ where: { email: "compta-rfcrh@simassurances.test" } });
  const tech = await prisma.user.findUniqueOrThrow({ where: { email: "compta-production@simassurances.test" } });
  const compte = (await prisma.cptCompte.findFirst({ where: { libelle: "Wave Business" } })) ?? (await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } }));
  const produit = async (code: string, branche: "ACCIDENTS" | "SANTE" | "INCENDIE" | "DECES") =>
    (await prisma.cptProduit.findUnique({ where: { code } })) ?? prisma.cptProduit.create({ data: { code, libelle: code, branche } });
  const client = (await prisma.cptClient.findFirst({ where: { nom: "Client Taxe E2E" } })) ?? (await prisma.cptClient.create({ data: { nom: "Client Taxe E2E" } }));
  let n = (await prisma.cptEncaissement.count()) + 700;
  const encaissement = (montant: number, dateValeur: string, pasUnePrime = 0) =>
    prisma.cptEncaissement.create({
      data: {
        reference: `CPE-2026-${String(900000 + ++n)}`,
        compteId: compte.id,
        referenceReleve: `T_GC8${String(n).padStart(8, "0")}`,
        dateValeur: new Date(dateValeur),
        montant,
        typeFlux: "ENCAISSEMENT",
        resteARattacher: montant - pasUnePrime,
        montantPasUnePrime: pasUnePrime,
        motifPasUnePrime: pasUnePrime ? "Frais de carte santé" : null,
        creeParId: tech.id,
      },
    });
  async function contrat(numPolice: string, produitId: string, nature: "INDIVIDUEL" | "GROUPE", du: number, taxe: number) {
    const c = await prisma.cptContrat.create({
      data: { numPolice, produitId, natureContrat: nature, clientId: client.id, dateEffet: new Date("2026-01-01"), dateEcheance: new Date("2026-12-31"), primeNetteHt: du, primeTtc: du, creeParId: tech.id },
    });
    const e = await prisma.cptEcheance.create({
      data: { contratId: c.id, rang: 1, periodeDebut: new Date("2026-01-01"), periodeFin: new Date("2026-01-28"), datePrevue: new Date("2026-01-05"), primeTtc: du, primeHt: du - taxe, taxe, montantDu: du },
    });
    return { c, e };
  }
  const rattacher = async (encaissementId: string, echeanceId: string, montant: number) => {
    const r = await prisma.cptRattachement.create({ data: { encaissementId, echeanceId, montant, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "jeu d'essai" } });
    await prisma.$transaction((tx) => validerRattachementsCpt(tx, [r.id], { userId: rf.id }), { timeout: 60_000 });
  };

  if (phase === "fevrier") {
    await prisma.cptTauxTca.createMany({
      data: [
        { branche: "ACCIDENTS", taux: "0.0725", dateEffet: new Date("2000-01-01"), creeParId: rf.id },
        { branche: "SANTE", natureContrat: "GROUPE", taux: "0.015", dateEffet: new Date("2000-01-01"), creeParId: rf.id },
      ],
    });
    const pAcc = await produit("RELAXMOTO", "ACCIDENTS");
    const pCond = await produit("INDIVIDUELLE-CONDUCTEUR", "ACCIDENTS");
    const pSante = await produit("SANTE-GROUPE", "SANTE");
    const pInc = await produit("INC-X", "INCENDIE");
    const t1 = await contrat("POL-GC8-T1", pAcc.id, "INDIVIDUEL", 2500, 169);
    await rattacher((await encaissement(4500, "2026-02-03", 2000)).id, t1.e.id, 2500);
    const t3 = await contrat("POL-GC8-T3", pSante.id, "GROUPE", 50000, 739);
    await rattacher((await encaissement(50000, "2026-02-10")).id, t3.e.id, 50000);
    const e5 = await encaissement(1500, "2026-02-12");
    const t5 = await contrat("POL-GC8-T5", pCond.id, "INDIVIDUEL", 1500, 101);
    // Avance faite comme à l'écran : par produit, l'encaissement n'ayant pas encore de contrat.
    const av = await prisma.$transaction((tx) => taxerEncaissementCpt(tx, { encaissementId: e5.id, produitCode: pCond.code }, { userId: rf.id }));
    if (!av.ok) throw new Error(av.message);
    await rattacher(e5.id, t5.e.id, 1500);
    const inc = await contrat("POL-GC8-INC", pInc.id, "INDIVIDUEL", 2500, 278);
    await rattacher((await encaissement(2500, "2026-02-25")).id, inc.e.id, 2500);
  } else if (phase === "mars") {
    const pAcc = await produit("RELAXMOTO", "ACCIDENTS");
    const m = await contrat("POL-GC8-MARS", pAcc.id, "INDIVIDUEL", 1500, 101);
    await rattacher((await encaissement(1500, "2026-03-10")).id, m.e.id, 1500);
  } else {
    throw new Error("phase inconnue");
  }
  console.log(`phase ${phase} : jeu d'essai créé`);
}
main().finally(() => prisma.$disconnect());
