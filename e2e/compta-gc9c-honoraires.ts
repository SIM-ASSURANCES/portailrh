// Gestion Compta, lot GC-9c — HONORAIRES EN BASE sur une vraie base PostgreSQL JETABLE (jamais la base de dev). Lancé depuis la racine
// (voir e2e/compta-gc1a-schema.sh, étape 20) sur une base FRAÎCHE dont toutes les migrations sont appliquées : DATABASE_URL doit viser
// une base dont le nom contient « compta ». Données 100 % synthétiques.
//  - T6 bis : deux contrats santé gérés par NOVELIA, non encaissés puis encaissés par de VRAIS rattachements validés ;
//  - un rattachement seulement proposé ne change rien (RG-01) ;
//  - quatrième solde : créance du partenaire qui paie pour ses clients, lue dans cptCreances ;
//  - aucune écriture : le chargement est en lecture seule.
import { prisma } from "../backend/src/prisma";
import { validerRattachementsCpt } from "../backend/src/cptRattachement";
import { chargerRemunerationPartenaireCpt } from "../backend/src/cptRemunerationDb";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const AUJOURDHUI = "2026-11-26";
const texte = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai honoraires" } });
  const tech = await prisma.user.create({ data: { fullName: "Technique", email: "compta-gc9c-tech@simassurances.test", roleId: role.id } });
  const rf = await prisma.user.create({ data: { fullName: "RFCRH", email: "compta-gc9c-rf@simassurances.test", roleId: role.id } });
  const compte = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const sante = await prisma.cptProduit.create({ data: { code: "SANTE-GROUPE", libelle: "Santé groupe", branche: "SANTE" } });
  const client = await prisma.cptClient.create({ data: { nom: "Client Santé" } });
  const novelia = await prisma.cptPartenaire.create({ data: { nom: "NOVELIA", estGestionnaire: true, estClient: true, estApporteur: true } });
  const convention = (faitGenerateur: "EMISSION" | "ENCAISSEMENT", apporteurId: string | null) =>
    prisma.cptConvention.create({
      data: { partenaireId: novelia.id, produitCode: "SANTE-GROUPE", nature: "HONORAIRES", taux: "0.08", base: "TTC", faitGenerateur, modeReglement: "EN_UNE_FOIS", apporteurId, dateEffet: new Date("2020-01-01"), creeParId: rf.id },
    });
  await convention("EMISSION", null);
  await convention("ENCAISSEMENT", novelia.id);

  async function contrat(numPolice: string, apporteurId: string | null) {
    const c = await prisma.cptContrat.create({
      data: { numPolice, produitId: sante.id, natureContrat: "GROUPE", clientId: client.id, partenaireApporteurId: apporteurId, dateEffet: new Date("2026-01-01"), dateEcheance: new Date("2026-12-31"), primeNetteHt: 100000, primeTtc: 100000, creeParId: tech.id },
    });
    const e = await prisma.cptEcheance.create({
      data: { contratId: c.id, rang: 1, periodeDebut: new Date("2026-01-01"), periodeFin: new Date("2026-12-31"), datePrevue: new Date("2026-07-01"), primeTtc: 100000, primeHt: 100000, montantDu: 100000 },
    });
    return { c, e };
  }
  const sim = await contrat("POL-SIM", null);
  const nov = await contrat("POL-NOV", novelia.id);

  let n = 0;
  async function rattacher(echeanceId: string, montant: number, valider = true) {
    n++;
    const enc = await prisma.cptEncaissement.create({
      data: { reference: `CPE-2026-80000${n}`, compteId: compte.id, referenceReleve: `T_GC9C${n}`, dateValeur: new Date("2026-08-05"), montant, typeFlux: "ENCAISSEMENT", resteARattacher: montant, creeParId: tech.id },
    });
    const r = await prisma.cptRattachement.create({ data: { encaissementId: enc.id, echeanceId, montant, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "jeu d'essai" } });
    if (valider) await prisma.$transaction((tx) => validerRattachementsCpt(tx, [r.id], { userId: rf.id }), { timeout: 60_000 });
    return r;
  }
  const charger = async () => (await chargerRemunerationPartenaireCpt(prisma, novelia.id, AUJOURDHUI))!;
  const honoraire = (r: Awaited<ReturnType<typeof charger>>, police: string) => r.honoraires.contrats.find((c) => c.numPolice === police)!;

  // ---------- Non encaissés ----------
  const avant = await charger();
  verifier("T6 bis : exigible 8 000 sur le contrat SIM, en « non encaissées »", honoraire(avant, "POL-SIM").exigible === F(8000) && honoraire(avant, "POL-SIM").surPrimesNonEncaissees === F(8000), texte(honoraire(avant, "POL-SIM")));
  verifier("T6 bis : rien d'exigible sur le contrat NOVELIA", honoraire(avant, "POL-NOV").exigible === BigInt(0) && honoraire(avant, "POL-NOV").surPrimesNonEncaissees === BigInt(0));
  verifier("reste dû et ancienneté du client lus dans le calcul des créances (148 jours, 91 à 180)", honoraire(avant, "POL-SIM").resteDuClient === F(100000) && honoraire(avant, "POL-SIM").ancienneteClientJours === 148 && honoraire(avant, "POL-SIM").trancheClient === "T91_180");
  verifier("solde d'honoraires : dû 16 000, net à verser 8 000", avant.soldes.HONORAIRES.du === F(16000) && avant.soldes.HONORAIRES.montantReglable === F(8000));
  verifier("créance du partenaire (client) : le seul contrat qu'il a apporté, 100 000, jamais compensée", avant.creance.resteDu === F(100000) && avant.creance.nbContrats === 1 && avant.creance.joursAnciennete === 148);

  // ---------- Un rattachement seulement proposé n'a aucun effet ----------
  const propose = await rattacher(sim.e.id, 100000, false);
  verifier("RG-01 : un rattachement seulement proposé ne change rien", honoraire(await charger(), "POL-SIM").surPrimesEncaissees === BigInt(0));
  await prisma.$transaction((tx) => validerRattachementsCpt(tx, [propose.id], { userId: rf.id }), { timeout: 60_000 });

  // ---------- Bascule à l'encaissement ----------
  await rattacher(nov.e.id, 100000);
  const apres = await charger();
  for (const police of ["POL-SIM", "POL-NOV"]) {
    const h = honoraire(apres, police);
    verifier(`T6 bis : après encaissement, ${police} passe en « sur primes encaissées » (8 000)`, h.exigible === F(8000) && h.surPrimesEncaissees === F(8000) && h.surPrimesNonEncaissees === BigInt(0), texte(h));
  }
  verifier("après encaissement : net à verser 16 000, créance du partenaire nulle", apres.soldes.HONORAIRES.montantReglable === F(16000) && apres.creance.resteDu === BigInt(0));
  verifier("lecture seule : aucune ligne de rémunération créée par le chargement", (await prisma.cptLigneRemuneration.count()) === 0);

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-9c : ${resultats.length - ko} contrôle(s) réussi(s), ${ko} échec(s).`);
  if (ko > 0) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
