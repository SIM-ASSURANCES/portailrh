// Gestion Compta, lot GC-6b — RELANCES 7 / 30 / 60 JOURS et RÉSUMÉ DU LUNDI, couche base, sur une vraie base PostgreSQL JETABLE (jamais la
// base de développement). Lancé depuis la racine du dépôt (voir e2e/compta-gc1a-schema.sh, étape 15) sur une base FRAÎCHE dont toutes les
// migrations sont appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données 100 % synthétiques.
// L'horloge est SIMULÉE : chaque appel reçoit sa propre date (la tâche réelle reçoit `new Date()`).
//  1. module non mis en service : rien n'est lu, réservé ni marqué ;
//  2. premier passage : l'arriéré est réservé SANS envoi, le marqueur est posé ; un second passage ne fait rien ;
//  3. paliers : 7, 30 puis 60 jours, chacun une seule fois, jamais deux fois le même palier, les lignes traitées sortent ;
//  4. une ligne qui franchit plusieurs paliers d'un coup ne reçoit que le plus élevé ;
//  5. deux exécutions simultanées : un seul envoi ;
//  6. seuils paramétrés ; résumé du lundi : une fois par semaine, mêmes chiffres que les listes.
import { prisma } from "../backend/src/prisma";
import { reserverRelancesCpt, reserverResumeHebdoCpt, type ResultatReservationRelancesCpt } from "../backend/src/cptRelancesDb";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const T0 = new Date("2026-12-01T08:00:00Z"); // un mardi
const jour = (decalage: number, base: Date = T0) => new Date(base.getTime() + decalage * 86_400_000);
const jourTexte = (d: Date) => d.toISOString().slice(0, 10);
/** Synthèse comparable d'une réservation : « OBJET/PALIER: ref1,ref2 » triée. */
const synthese = (r: ResultatReservationRelancesCpt) => r.aEnvoyer.map((g) => `${g.objet}/${g.palier}:${g.references.join(",")}`).sort();

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai relances" } });
  const technique = await prisma.user.create({ data: { fullName: "Technique", email: "compta-gc6b-tech@simassurances.test", roleId: role.id } });
  const compte = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const produit = await prisma.cptProduit.create({ data: { code: "P1", libelle: "Produit 1", branche: "ACCIDENTS" } });
  const client = await prisma.cptClient.create({ data: { nom: "Kouassi Ama" } });
  let numero = 0;

  async function encaissement(reference: string, age: number, base: Date = T0) {
    numero++;
    return prisma.cptEncaissement.create({
      data: {
        reference,
        compteId: compte.id,
        referenceReleve: `T_REL_${numero}`,
        dateValeur: new Date(`${jourTexte(jour(-age, base))}T00:00:00Z`),
        montant: 2500,
        typeFlux: "ENCAISSEMENT",
        statut: "A_RATTACHER",
        resteARattacher: 2500,
        creeParId: technique.id,
      },
    });
  }
  async function contrat(numPolice: string, age: number, base: Date = T0) {
    const c = await prisma.cptContrat.create({
      data: {
        numPolice,
        produitId: produit.id,
        natureContrat: "INDIVIDUEL",
        clientId: client.id,
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        primeNetteHt: 10000,
        primeTtc: 10000,
        creeParId: technique.id,
        declarePaye: true,
        datePaiementDeclaree: new Date(`${jourTexte(jour(-age, base))}T00:00:00Z`),
        fractionnement: "COMPTANT",
      },
    });
    await prisma.cptEcheance.create({
      data: { contratId: c.id, rang: 1, periodeDebut: new Date("2026-01-01"), periodeFin: new Date("2026-12-31"), datePrevue: new Date("2026-01-05"), primeTtc: 10000, primeHt: 10000, montantDu: 10000 },
    });
    return c;
  }

  // Arriéré présent AVANT la mise en service : E1 40 j, E2 10 j, E3 3 j, EVIEUX 100 j ; C1 70 j, C2 9 j, C3 5 j.
  const e1 = await encaissement("CPE-2026-000001", 40);
  const e2 = await encaissement("CPE-2026-000002", 10);
  const e3 = await encaissement("CPE-2026-000003", 3);
  const evieux = await encaissement("CPE-2026-000004", 100);
  await contrat("POL-C1", 70);
  await contrat("POL-C2", 9);
  await contrat("POL-C3", 5);

  // ---------- 1. Module non mis en service ----------
  const avant = await reserverRelancesCpt(prisma, T0);
  verifier("1. module non mis en service : rien n'est traité", !avant.moduleMisEnService && avant.aEnvoyer.length === 0 && avant.examinees === 0);
  verifier("1. aucune réservation ni marqueur écrits", (await prisma.cptAlerteControle.count()) === 0 && (await prisma.marqueurUnique.count({ where: { cle: "compta.relances_initiales" } })) === 0);
  const resumeAvant = await reserverResumeHebdoCpt(prisma, T0);
  verifier("1. résumé du lundi : rien non plus avant la mise en service", !resumeAvant.moduleMisEnService && (await prisma.marqueurUnique.count({ where: { cle: { startsWith: "compta.controle_hebdo." } } })) === 0);

  await prisma.cptMiseEnService.create({ data: { activeeParId: technique.id, sauvegardeSha256: "a".repeat(64) } });

  // ---------- 2. Premier passage ----------
  const p1 = await reserverRelancesCpt(prisma, T0);
  verifier("2. premier passage : aucun envoi, arriéré réservé sans envoi", p1.premierPassage && p1.aEnvoyer.length === 0 && p1.moduleMisEnService, JSON.stringify(synthese(p1)));
  verifier("2. 5 lignes examinées (E1, E2, VIEUX, C1, C2 ; E3 et C3 trop récentes)", p1.examinees === 5, `${p1.examinees}`);
  // E1 40 j : relance + alerte ; E2 10 j : relance ; VIEUX 100 j : les trois ; C1 70 j : les trois ; C2 9 j : relance → 2 + 1 + 3 + 3 + 1.
  verifier("2. 10 paliers réservés sans envoi", p1.silencieuses === 10 && (await prisma.cptAlerteControle.count({ where: { envoyeeAt: null } })) === 10, `${p1.silencieuses}`);
  verifier("2. le marqueur du premier passage est posé", (await prisma.marqueurUnique.count({ where: { cle: "compta.relances_initiales" } })) === 1);
  const p1bis = await reserverRelancesCpt(prisma, T0);
  verifier("2. second passage le même jour : rien", !p1bis.premierPassage && p1bis.aEnvoyer.length === 0 && p1bis.silencieuses === 0);
  const p1ter = await reserverRelancesCpt(prisma, jour(1));
  verifier("2. le lendemain, sans nouveau palier franchi : rien non plus", p1ter.aEnvoyer.length === 0 && p1ter.silencieuses === 0, JSON.stringify(synthese(p1ter)));

  // ---------- 3. Paliers ----------
  // E3 a 3 jours à T0 : elle atteint 7 jours à T0+4 ; C3 (5 jours) atteint 7 jours à T0+2.
  const r2 = await reserverRelancesCpt(prisma, jour(2));
  verifier("3. à 7 jours : C3 est relancée (production), seule", JSON.stringify(synthese(r2)) === JSON.stringify(["CONTRAT/RELANCE:POL-C3"]), JSON.stringify(synthese(r2)));
  const r2bis = await reserverRelancesCpt(prisma, jour(2));
  verifier("3. second passage le même jour : aucune double relance", r2bis.aEnvoyer.length === 0);
  const r4 = await reserverRelancesCpt(prisma, jour(4));
  verifier("3. à 7 jours : E3 est relancée (commercial) ; C3 n'est pas renvoyée", JSON.stringify(synthese(r4)) === JSON.stringify(["ENCAISSEMENT/RELANCE:CPE-2026-000003"]), JSON.stringify(synthese(r4)));
  const r4bis = await reserverRelancesCpt(prisma, jour(5));
  verifier("3. le lendemain : toujours rien", r4bis.aEnvoyer.length === 0);

  // À T0+27 : E3 a 30 j (alerte), E2 37 j (alerte, relance déjà réservée), E1 67 j (escalade ; relance et alerte déjà réservées),
  // C2 36 j et C3 32 j (alerte), C1 97 j et VIEUX 127 j (tout est déjà réservé).
  const r27 = await reserverRelancesCpt(prisma, jour(27));
  verifier(
    "3. à 30 jours : alertes (RFCRH) pour E2, E3, C2, C3 ; escalade (DG) pour E1 seulement",
    JSON.stringify(synthese(r27)) ===
      JSON.stringify(["CONTRAT/ALERTE:POL-C2,POL-C3", "ENCAISSEMENT/ALERTE:CPE-2026-000002,CPE-2026-000003", "ENCAISSEMENT/ESCALADE:CPE-2026-000001"].sort()),
    JSON.stringify(synthese(r27))
  );
  // Une ligne traitée sort de la liste : E3 est soldée (rattachement validé), elle n'a donc plus de palier à 60 jours.
  await prisma.cptEncaissement.update({ where: { id: e3.id }, data: { statut: "SOLDE", resteARattacher: 0 } });
  // À T0+60 : E2 70 j, C2 69 j, C3 65 j atteignent 60 jours ; E3 (63 j) est soldée.
  const r60 = await reserverRelancesCpt(prisma, jour(60));
  verifier(
    "3. à 60 jours : escalade pour E2, C2, C3 ; E3, soldée, n'est plus relancée",
    JSON.stringify(synthese(r60)) === JSON.stringify(["CONTRAT/ESCALADE:POL-C2,POL-C3", "ENCAISSEMENT/ESCALADE:CPE-2026-000002"].sort()),
    JSON.stringify(synthese(r60))
  );
  const r60bis = await reserverRelancesCpt(prisma, jour(60));
  verifier("3. second passage à 60 jours : aucune double escalade", r60bis.aEnvoyer.length === 0);
  verifier("3. chaque (ligne, palier) n'existe qu'une fois", (await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM "CptAlerteControle" GROUP BY "objet", "objetId", "palier" HAVING count(*) > 1) d`)[0].n === 0n);
  verifier("3. E3 n'a jamais reçu de palier d'escalade", (await prisma.cptAlerteControle.count({ where: { objetId: e3.id, palier: "ESCALADE" } })) === 0);

  // ---------- 4. Plusieurs paliers franchis d'un coup ----------
  const base4 = jour(100);
  await encaissement("CPE-2026-000005", 45, base4); // 45 jours d'un coup
  const r4a = await reserverRelancesCpt(prisma, base4);
  verifier("4. 45 jours d'un coup : une seule notification, celle de l'alerte", JSON.stringify(synthese(r4a)) === JSON.stringify(["ENCAISSEMENT/ALERTE:CPE-2026-000005"]), JSON.stringify(synthese(r4a)));
  const nouvelle = await prisma.cptEncaissement.findUniqueOrThrow({ where: { reference: "CPE-2026-000005" } });
  const lignes = await prisma.cptAlerteControle.findMany({ where: { objetId: nouvelle.id }, orderBy: { palier: "asc" } });
  verifier("4. la relance en dessous est réservée sans envoi", lignes.length === 2 && lignes.find((l) => l.palier === "RELANCE")?.envoyeeAt === null && lignes.find((l) => l.palier === "ALERTE")?.envoyeeAt !== null);

  // ---------- 5. Concurrence ----------
  const base5 = jour(200);
  await encaissement("CPE-2026-000006", 7, base5);
  await encaissement("CPE-2026-000007", 7, base5);
  const [a, b] = await Promise.all([reserverRelancesCpt(prisma, base5), reserverRelancesCpt(prisma, base5)]);
  const envoyeesA = a.aEnvoyer.flatMap((g) => g.references);
  const envoyeesB = b.aEnvoyer.flatMap((g) => g.references);
  const toutes = [...envoyeesA, ...envoyeesB].sort();
  // CPE-…005 (45 jours à son passage, 145 jours ici) franchit aussi l'escalade à cette date : elle compte avec les deux nouvelles.
verifier("5. deux exécutions simultanées : chaque ligne est annoncée UNE seule fois", JSON.stringify(toutes) === JSON.stringify(["CPE-2026-000005", "CPE-2026-000006", "CPE-2026-000007"]), `A=${envoyeesA} B=${envoyeesB}`);
  const reservees5 = await prisma.cptAlerteControle.count({ where: { palier: "RELANCE", envoyeeAt: { not: null }, objetId: { in: (await prisma.cptEncaissement.findMany({ where: { reference: { in: ["CPE-2026-000006", "CPE-2026-000007"] } }, select: { id: true } })).map((x) => x.id) } } });
  verifier("5. exactement deux réservations de relance envoyées en base pour les deux nouvelles lignes", reservees5 === 2, `${reservees5}`);

  // ---------- 6. Seuils paramétrés, résumé du lundi ----------
  await prisma.cptParametre.update({ where: { cle: "relance.jours" }, data: { valeur: "3" } });
  const base6 = jour(300);
  await encaissement("CPE-2026-000008", 4, base6);
  const r6 = await reserverRelancesCpt(prisma, base6);
  verifier("6. seuil de relance ramené à 3 jours : une ligne de 4 jours est relancée", r6.aEnvoyer.some((g) => g.palier === "RELANCE" && g.references.includes("CPE-2026-000008")), JSON.stringify(synthese(r6)));
  await prisma.cptParametre.update({ where: { cle: "relance.jours" }, data: { valeur: "7" } });

  const lundi = new Date("2027-03-01T07:30:00Z"); // lundi
  const resume = await reserverResumeHebdoCpt(prisma, lundi);
  const attenduEnc = await prisma.cptEncaissement.count({ where: { typeFlux: "ENCAISSEMENT", statut: "A_RATTACHER", resteARattacher: { gt: 0 } } });
  verifier("6. résumé du lundi : message pour le commercial et pour la production", !resume.dejaFait && resume.encaissements !== null && resume.contrats !== null);
  verifier("6. le résumé annonce le même nombre que la liste (encaissements sans contrat)", resume.encaissements?.titre.startsWith(`Contrôle de la semaine : ${attenduEnc} encaissements sans contrat`) === true, resume.encaissements?.titre ?? "");
  const resumeMercredi = await reserverResumeHebdoCpt(prisma, new Date("2027-03-03T07:30:00Z"));
  verifier("6. rattrapé le mercredi de la même semaine : déjà fait, rien de plus", resumeMercredi.dejaFait && resumeMercredi.encaissements === null);
  const resumeSuivant = await reserverResumeHebdoCpt(prisma, new Date("2027-03-08T07:30:00Z"));
  verifier("6. la semaine suivante : un nouveau résumé", !resumeSuivant.dejaFait && resumeSuivant.encaissements !== null);
  const [r1, r2s] = await Promise.all([reserverResumeHebdoCpt(prisma, new Date("2027-03-15T07:30:00Z")), reserverResumeHebdoCpt(prisma, new Date("2027-03-15T07:31:00Z"))]);
  verifier("6. deux résumés simultanés : un seul passe", [r1, r2s].filter((x) => !x.dejaFait).length === 1);
  void e1;
  void e2;
  void evieux;

  console.log(resultats.join("\n"));
  const ko = resultats.filter((l) => l.startsWith("KO")).length;
  console.log(`\nGC-6b : ${resultats.length - ko}/${resultats.length} contrôles réussis.`);
  if (ko > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(resultats.join("\n"));
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
