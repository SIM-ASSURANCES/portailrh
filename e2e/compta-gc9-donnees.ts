// Gestion Compta, lot GC-9 — jeu d'essai du script e2e/compta-gc9.mjs. L'encaissé passe par la VRAIE validation d'un rattachement
// (RG-01) et l'échéancier par `construireEcheancier` : rien n'est recopié à la main. Base JETABLE seulement.
//   phase « base »     : T6 ter (120 000 en 12 mensualités, 3 encaissées), T6 (courtier en commission, gestionnaire en honoraires),
//                        T6 bis (NOVELIA : un contrat apporté par SIM, un par NOVELIA, non encaissés), cabinet à compenser (commission
//                        « au prorata » non encaissée et honoraires exigibles à l'émission), courtier « client » avec une créance ;
//   phase « mois4 »    : 4ᵉ mensualité du T6 ter encaissée (1 000 de commission de plus à payer) ;
//   phase « t6bis »    : encaissement des deux contrats de NOVELIA ;
//   phase « resilier » : résiliation du contrat du cabinet à régulariser (honoraires jamais encaissés) ;
//   phase « cab-encaisse » : encaissement du premier contrat du cabinet (sa commission devient payable).
import { prisma } from "../backend/src/prisma";
import { construireEcheancier } from "../backend/src/cptEcheancier";
import { validerRattachementsCpt } from "../backend/src/cptRattachement";

const phase = process.argv[2];
if (!/e2e|compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable.");

async function main() {
  const rf = await prisma.user.findUniqueOrThrow({ where: { email: "compta-rfcrh@simassurances.test" } });
  const tech = await prisma.user.findUniqueOrThrow({ where: { email: "compta-production@simassurances.test" } });
  const compte = (await prisma.cptCompte.findFirst({ where: { libelle: "Banque E2E" } })) ?? (await prisma.cptCompte.create({ data: { libelle: "Banque E2E", type: "BANQUE" } }));

  async function encaisser(numPolice: string, rang: number) {
    const e = await prisma.cptEcheance.findFirstOrThrow({ where: { rang, contrat: { numPolice } } });
    const montant = Number(e.montantDu.toString()) - Number(e.montantRegle.toString());
    const n = (await prisma.cptEncaissement.count()) + 1;
    const enc = await prisma.cptEncaissement.create({
      data: { reference: `CPE-2026-${String(700000 + n)}`, compteId: compte.id, referenceReleve: `VIR-GC9-${n}`, dateValeur: new Date("2026-03-15"), montant, typeFlux: "ENCAISSEMENT", resteARattacher: montant, creeParId: tech.id },
    });
    const r = await prisma.cptRattachement.create({ data: { encaissementId: enc.id, echeanceId: e.id, montant, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "jeu d'essai" } });
    const v = await prisma.$transaction((tx) => validerRattachementsCpt(tx, [r.id], { userId: rf.id }), { timeout: 60_000 });
    if (!v.ok || v.resultats.some((x) => !x.ok)) throw new Error(JSON.stringify(v));
  }

  if (phase === "base") {
    const produit = (code: string, branche: "ACCIDENTS" | "SANTE") => prisma.cptProduit.create({ data: { code, libelle: code, branche } });
    await produit("FLOTTE", "ACCIDENTS");
    await produit("MULTI", "ACCIDENTS");
    await produit("SANTE-GR", "SANTE");
    await produit("CABINET", "ACCIDENTS");
    await produit("SANS-CONVENTION", "ACCIDENTS");
    const client = await prisma.cptClient.create({ data: { nom: "Client Rémunération" } });
    const partenaire = (nom: string, p: { estClient?: boolean; estGestionnaire?: boolean } = {}) => prisma.cptPartenaire.create({ data: { nom, estApporteur: true, ...p } });
    const convention = (partenaireId: string, produitCode: string, nature: "COMMISSION" | "HONORAIRES", taux: string, o: { base?: "TTC" | "PRIME_NETTE"; fait?: "EMISSION" | "ENCAISSEMENT"; mode?: "EN_UNE_FOIS" | "AU_PRORATA"; apporteurId?: string | null } = {}) =>
      prisma.cptConvention.create({
        data: { partenaireId, produitCode, nature, taux, base: o.base ?? "TTC", faitGenerateur: o.fait ?? "EMISSION", modeReglement: o.mode ?? "AU_PRORATA", apporteurId: o.apporteurId ?? null, dateEffet: new Date("2020-01-01"), creeParId: rf.id },
      });
    async function contrat(numPolice: string, produitCode: string, apporteurId: string | null, prime: number, o: { mensuel?: boolean; accessoires?: number; taxe?: number } = {}) {
      const p = await prisma.cptProduit.findUniqueOrThrow({ where: { code: produitCode } });
      const plan = construireEcheancier({ fractionnement: o.mensuel ? "MENSUEL" : "COMPTANT", dateEffet: "2026-01-01", dateEcheance: "2026-12-31", primeTtc: prime, accessoires: o.accessoires ?? 0, taxe: o.taxe ?? 0 });
      if (!plan.ok) throw new Error(plan.erreur);
      await prisma.cptContrat.create({
        data: {
          numPolice,
          produitId: p.id,
          natureContrat: "INDIVIDUEL",
          clientId: client.id,
          partenaireApporteurId: apporteurId,
          dateEffet: new Date("2026-01-01"),
          dateEcheance: new Date("2026-12-31"),
          fractionnement: o.mensuel ? "MENSUEL" : "COMPTANT",
          primeNetteHt: prime - (o.accessoires ?? 0) - (o.taxe ?? 0),
          accessoiresHt: o.accessoires ?? 0,
          taxe: o.taxe ?? 0,
          primeTtc: prime,
          creeParId: tech.id,
          echeances: {
            create: plan.echeances.map((e) => ({ rang: e.rang, periodeDebut: new Date(e.periodeDebut), periodeFin: new Date(e.periodeFin), datePrevue: new Date(e.datePrevue), primeTtc: e.primeTtc, primeHt: e.primeHt, accessoires: e.accessoires, taxe: e.taxe, montantDu: e.montantDu })),
          },
        },
      });
    }

    // T6 ter
    const courtierTer = await partenaire("Courtier T6ter");
    await convention(courtierTer.id, "FLOTTE", "COMMISSION", "0.1");
    await contrat("POL-T6TER", "FLOTTE", courtierTer.id, 120000, { mensuel: true });
    for (const rang of [1, 2, 3]) await encaisser("POL-T6TER", rang);
    // T6
    const courtier = await partenaire("Courtier T6", { estClient: true });
    const gestionnaire = await partenaire("Gestionnaire T6", { estGestionnaire: true });
    await convention(courtier.id, "MULTI", "COMMISSION", "0.15", { base: "PRIME_NETTE", mode: "EN_UNE_FOIS" });
    await convention(gestionnaire.id, "MULTI", "HONORAIRES", "0.05", { mode: "EN_UNE_FOIS" });
    await contrat("POL-T6", "MULTI", courtier.id, 200000, { accessoires: 10000, taxe: 3000 });
    await encaisser("POL-T6", 1);
    // Créance du courtier « client » : un second contrat qu'il a apporté (sans convention), non encaissé.
    await contrat("POL-T6-CREANCE", "SANS-CONVENTION", courtier.id, 50000);
    // T6 bis
    const novelia = await partenaire("NOVELIA", { estGestionnaire: true });
    await convention(novelia.id, "SANTE-GR", "HONORAIRES", "0.08", { mode: "EN_UNE_FOIS" });
    await convention(novelia.id, "SANTE-GR", "HONORAIRES", "0.08", { mode: "EN_UNE_FOIS", fait: "ENCAISSEMENT", apporteurId: novelia.id });
    await contrat("POL-BIS-SIM", "SANTE-GR", null, 100000);
    await contrat("POL-BIS-NOV", "SANTE-GR", novelia.id, 100000);
    // Alerte d'écart de taux (9t) : un produit et un courtier à 10 % de commission, sans convention d'honoraires.
    await produit("ALERTE", "ACCIDENTS");
    const courtierAlerte = await partenaire("Courtier Alerte");
    await convention(courtierAlerte.id, "ALERTE", "COMMISSION", "0.1");
    // Cabinet à compenser
    const cabinet = await partenaire("Cabinet Compensation", { estGestionnaire: true });
    await convention(cabinet.id, "CABINET", "COMMISSION", "0.1");
    await convention(cabinet.id, "CABINET", "HONORAIRES", "0.05", { mode: "EN_UNE_FOIS" });
    await contrat("POL-CAB", "CABINET", cabinet.id, 100000);
    await contrat("POL-CAB-RESIL", "CABINET", null, 40000);
  } else if (phase === "mois4") {
    await encaisser("POL-T6TER", 4);
  } else if (phase === "t6bis") {
    await encaisser("POL-BIS-SIM", 1);
    await encaisser("POL-BIS-NOV", 1);
  } else if (phase === "cab-encaisse") {
    await encaisser("POL-CAB", 1);
  } else if (phase === "resilier") {
    await prisma.cptContrat.update({ where: { numPolice: "POL-CAB-RESIL" }, data: { statut: "RESILIE" } });
  } else {
    throw new Error("phase inconnue");
  }
  console.log(`phase ${phase} : jeu d'essai créé`);
}
main().finally(() => prisma.$disconnect());
