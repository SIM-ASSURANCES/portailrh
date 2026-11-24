// Gestion Compta, lot GC-5c — RATTACHEMENT EN BASE sur une vraie base PostgreSQL JETABLE (jamais la base de dev).
// Lancé depuis la racine du dépôt (voir e2e/compta-gc1a-schema.sh, étape 14) sur une base FRAÎCHE dont toutes les migrations sont
// appliquées : DATABASE_URL doit viser une base dont le nom contient « compta ». Données 100 % synthétiques.
//  1. le moteur écrit des propositions (référence exacte, groupe, montant et date, probable) et laisse un encaissement sans proposition ;
//  2. un second passage n'ajoute rien (idempotent) ;
//  3. étape 1 puis étape 2 : validation refusée sans confirmation, confirmation sans reçu refusée, le compte qui confirme ne valide pas ;
//  4. un groupe se valide d'un bloc ; l'avancement (reste à rattacher, montant réglé, échéance soldée) est recalculé ;
//  5. plafond de l'échéance respecté, rejet avec motif, identification manuelle, « pas une prime » (T1) ;
//  6. concurrence : deux validations qui se disputent la même échéance, deux validations du même rattachement — une seule passe.
import { prisma } from "../backend/src/prisma";
import {
  classerPasUnePrimeCpt,
  confirmerRattachementsCpt,
  identifierManuellementCpt,
  lancerRapprochementCpt,
  rejeterRattachementsCpt,
  validerRattachementsCpt,
} from "../backend/src/cptRattachement";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
/** FCFA → centimes (les fonctions de la couche base travaillent en centimes entiers). */
const fcfa = (n: number) => BigInt(n) * BigInt(100);

async function main() {
  if (!/compta/i.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  const role = await prisma.role.create({ data: { name: "Rôle d'essai rattachements" } });
  const mk = (email: string, nom: string) => prisma.user.create({ data: { fullName: nom, email, roleId: role.id } });
  const technique = await mk("compta-gc5c-tech@simassurances.test", "Technique");
  const commercial = await mk("compta-gc5c-com@simassurances.test", "Commercial");
  const rfcrh = await mk("compta-gc5c-rf@simassurances.test", "RFCRH");
  const compte = await prisma.cptCompte.create({ data: { libelle: "Wave Business", type: "WAVE_BUSINESS" } });
  const produit = await prisma.cptProduit.create({ data: { code: "P1", libelle: "Produit 1", branche: "ACCIDENTS" } });
  const partenaire = await prisma.cptPartenaire.create({ data: { nom: "Courtier Un", estApporteur: true } });
  const clients = {
    ama: await prisma.cptClient.create({ data: { nom: "Kouassi Ama" } }),
    issa: await prisma.cptClient.create({ data: { nom: "Traoré Issa" } }),
    grp: await prisma.cptClient.create({ data: { nom: "Groupe SA" } }),
  };

  async function contrat(numPolice: string, clientId: string, p: { ref?: string; datePaiement?: string; partenaireId?: string; echeances: number[] }) {
    const total = p.echeances.reduce((s, x) => s + x, 0);
    const c = await prisma.cptContrat.create({
      data: {
        numPolice,
        produitId: produit.id,
        natureContrat: "INDIVIDUEL",
        clientId,
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        primeNetteHt: total,
        primeTtc: total,
        creeParId: technique.id,
        referencePaiementDeclaree: p.ref ?? null,
        datePaiementDeclaree: p.datePaiement ? new Date(p.datePaiement) : null,
        partenaireApporteurId: p.partenaireId ?? null,
        fractionnement: p.echeances.length > 1 ? "MENSUEL" : "COMPTANT",
      },
    });
    const echs = [];
    for (const [i, montant] of p.echeances.entries()) {
      echs.push(
        await prisma.cptEcheance.create({
          data: {
            contratId: c.id,
            rang: i + 1,
            periodeDebut: new Date(`2026-0${i + 1}-01`),
            periodeFin: new Date(`2026-0${i + 1}-28`),
            datePrevue: new Date(`2026-0${i + 1}-05`),
            primeTtc: montant,
            primeHt: montant,
            montantDu: montant,
          },
        })
      );
    }
    return { c, echs };
  }
  let n = 0;
  const encaissement = (referenceReleve: string, montant: number, dateValeur: string, payeur: string | null = null) =>
    prisma.cptEncaissement.create({
      data: {
        reference: `CPE-2026-9${String(++n).padStart(5, "0")}`,
        compteId: compte.id,
        referenceReleve,
        dateValeur: new Date(dateValeur),
        montant,
        typeFlux: "ENCAISSEMENT",
        resteARattacher: montant,
        payeur,
        creeParId: technique.id,
      },
    });

  // ---------- Jeu de données ----------
  const k1 = await contrat("POL-K1", clients.ama.id, { ref: "T_REFEXACT0001", echeances: [2500, 2500] });
  const k2a = await contrat("POL-K2A", clients.grp.id, { datePaiement: "2026-03-09", partenaireId: partenaire.id, echeances: [1000] });
  const k2b = await contrat("POL-K2B", clients.grp.id, { datePaiement: "2026-03-09", partenaireId: partenaire.id, echeances: [2000] });
  const k3 = await contrat("POL-K3", clients.issa.id, { datePaiement: "2026-03-08", echeances: [2500] });
  const e1 = await encaissement("T_REFEXACT0001", 2500, "2026-03-10"); // référence exacte
  const e2 = await encaissement("T_GROUPE000001", 3000, "2026-03-10"); // 1 000 + 2 000, même partenaire, même jour
  const e3 = await encaissement("T_AUTRE0000003", 2500, "2026-03-10"); // montant et date → POL-K3
  const e4 = await encaissement("T_INCONNU0004", 7777, "2026-03-10", "Zzz"); // rien ne correspond
  const e5 = await encaissement("T_PROBABLE005", 1234, "2026-03-12", "AMA KOUASSI"); // même nom que POL-K1

  // ---------- 1. Propositions ----------
  const bilan = await prisma.$transaction((tx) => lancerRapprochementCpt(tx, { userId: technique.id }), { timeout: 60_000 });
  verifier("5 encaissements examinés, 5 propositions, 1 sans proposition", bilan.encaissementsExamines === 5 && bilan.propositionsCreees === 5 && bilan.encaissementsSansProposition === 1, JSON.stringify(bilan));
  verifier(
    "méthodes : référence exacte 1, groupe 2, montant et date 1, probable 1",
    bilan.parMethode.REFERENCE_EXACTE === 1 && bilan.parMethode.GROUPE === 2 && bilan.parMethode.MONTANT_DATE === 1 && bilan.parMethode.PROBABLE === 1,
    JSON.stringify(bilan.parMethode),
  );
  const prop = async (encId: string) => prisma.cptRattachement.findMany({ where: { encaissementId: encId }, orderBy: { id: "asc" } });
  const p1 = await prop(e1.id);
  verifier("E1 : une proposition « preuve » sur la 1ʳᵉ échéance de POL-K1, à l'état PROPOSE, proposée par le moteur", p1.length === 1 && p1[0].niveauPreuve === "PREUVE" && p1[0].statut === "PROPOSE" && p1[0].proposeParId === null && p1[0].echeanceId === k1.echs[0].id);
  const p2 = await prop(e2.id);
  verifier("E2 : deux propositions d'un même groupe (déduction)", p2.length === 2 && p2[0].groupe !== null && p2[0].groupe === p2[1].groupe && p2.every((x) => x.niveauPreuve === "DEDUCTION"));
  const p3 = await prop(e3.id);
  verifier("E3 : montant et date vers POL-K3 (déduction), non résolu par E1 qui a sa référence", p3.length === 1 && p3[0].methode === "MONTANT_DATE" && p3[0].echeanceId === k3.echs[0].id);
  const p5 = await prop(e5.id);
  verifier("E5 : probable vers POL-K1, montant limité à celui de l'encaissement (1 234)", p5.length === 1 && p5[0].methode === "PROBABLE" && p5[0].niveauPreuve === "A_CONFIRMER" && p5[0].montant.toString() === "1234");
  verifier("E4 : aucune proposition, reste « à identifier »", (await prop(e4.id)).length === 0);

  // ---------- 2. Idempotence ----------
  const bilan2 = await prisma.$transaction((tx) => lancerRapprochementCpt(tx, { userId: technique.id }), { timeout: 60_000 });
  verifier("second passage : aucune proposition de plus", bilan2.propositionsCreees === 0 && (await prisma.cptRattachement.count()) === 5, JSON.stringify(bilan2));

  // ---------- 3. Étapes 1 et 2 ----------
  const valider = (ids: string[], userId: string) => prisma.$transaction((tx) => validerRattachementsCpt(tx, ids, { userId }), { timeout: 60_000 });
  const confirmer = (ids: string[], userId: string, recu: string | null) =>
    prisma.$transaction((tx) => confirmerRattachementsCpt(tx, ids, { userId, recuReference: recu }), { timeout: 60_000 });
  const rejeter = (ids: string[], userId: string, motif: string) => prisma.$transaction((tx) => rejeterRattachementsCpt(tx, ids, { userId, motif }), { timeout: 60_000 });
  const premier = (r: Awaited<ReturnType<typeof valider>>) => (r.ok ? r.resultats[0] : { ok: false, message: r.message, ids: [] as string[] });

  const v3a = premier(await valider([p3[0].id], rfcrh.id));
  verifier("E3 : validation d'une déduction sans confirmation refusée (RG-02)", !v3a.ok && /confirmation/i.test(v3a.message ?? ""), v3a.message);
  const c3a = await confirmer([p3[0].id], commercial.id, "  ");
  verifier("E3 : confirmation sans reçu refusée", !c3a.ok && /reçu/i.test(c3a.ok ? "" : c3a.message), c3a.ok ? "" : c3a.message);
  const c3b = await confirmer([p3[0].id], commercial.id, "REÇU-0042");
  verifier("E3 : confirmation avec le reçu (étape 1)", c3b.ok && c3b.resultats[0].ok);
  const c3c = premier(await confirmer([p3[0].id], commercial.id, "REÇU-0042"));
  verifier("E3 : une seconde confirmation est refusée", !c3c.ok);
  const v3b = premier(await valider([p3[0].id], commercial.id));
  verifier("E3 : le compte qui a confirmé ne peut pas valider", !v3b.ok && /confirmé/.test(v3b.message ?? ""), v3b.message);
  const apres0 = await prisma.cptEncaissement.findUnique({ where: { id: e3.id } });
  verifier("E3 : rien n'est payé tant que le RFCRH n'a pas validé (RG-01)", apres0?.resteARattacher.toString() === "2500" && apres0.statut === "A_RATTACHER");
  const v3c = premier(await valider([p3[0].id], rfcrh.id));
  verifier("E3 : validation par le RFCRH (étape 2)", v3c.ok);
  const e3b = await prisma.cptEncaissement.findUnique({ where: { id: e3.id } });
  const k3e = await prisma.cptEcheance.findUnique({ where: { id: k3.echs[0].id } });
  verifier("E3 : encaissement soldé, échéance soldée à 2 500", e3b?.statut === "SOLDE" && e3b.resteARattacher.toString() === "0" && k3e?.etat === "SOLDEE" && k3e.montantRegle.toString() === "2500");

  // ---------- 4. Preuve directe et groupe ----------
  const v1 = premier(await valider([p1[0].id], rfcrh.id));
  const e1b = await prisma.cptEncaissement.findUnique({ where: { id: e1.id } });
  verifier("E1 : un niveau « preuve » se valide directement ; encaissement soldé", v1.ok && e1b?.statut === "SOLDE");
  const v2 = await valider([p2[0].id], rfcrh.id);
  const groupeValide = await prisma.cptRattachement.findMany({ where: { encaissementId: e2.id } });
  verifier("E2 : le groupe est d'abord refusé en bloc (non confirmé), aucun membre n'est validé", v2.ok && v2.resultats.length === 1 && !v2.resultats[0].ok && groupeValide.every((x) => x.statut === "PROPOSE"));
  const conf2 = await confirmer([p2[0].id], commercial.id, "REÇU-GROUPE");
  verifier("E2 : la confirmation d'un membre confirme tout le groupe", conf2.ok && (await prisma.cptRattachement.count({ where: { encaissementId: e2.id, statut: "CONFIRME" } })) === 2);
  const v2b = await valider([p2[1].id], rfcrh.id);
  verifier("E2 : un seul identifiant valide les deux membres du groupe", v2b.ok && v2b.resultats[0].ok && v2b.resultats[0].ids.length === 2);
  const e2b = await prisma.cptEncaissement.findUnique({ where: { id: e2.id } });
  verifier("E2 : encaissement de 3 000 soldé, les deux échéances (1 000 et 2 000) soldées", e2b?.statut === "SOLDE" && (await prisma.cptEcheance.count({ where: { id: { in: [k2a.echs[0].id, k2b.echs[0].id] }, etat: "SOLDEE" } })) === 2);

  // ---------- 5. Plafond de l'échéance, rejet, identification manuelle, « pas une prime » ----------
  await confirmer([p5[0].id], commercial.id, "REÇU-PROBABLE");
  const v5 = premier(await valider([p5[0].id], rfcrh.id)); // POL-K1 échéance 1 est soldée par E1 : le plafond s'applique
  verifier("E5 : au-delà du montant dû de l'échéance (déjà soldée par E1) → refusé", !v5.ok && /échéance/.test(v5.message ?? ""), v5.message);
  const r5a = premier(await rejeter([p5[0].id], rfcrh.id, "  "));
  verifier("E5 : rejet sans motif refusé", !r5a.ok);
  const r5b = premier(await rejeter([p5[0].id], rfcrh.id, "Cette échéance est déjà soldée"));
  verifier("E5 : rejet avec motif (retour au commercial)", r5b.ok);
  const r5c = premier(await valider([p5[0].id], rfcrh.id));
  verifier("E5 : un rattachement rejeté est définitif", !r5c.ok);

  const ident = await prisma.$transaction(
    (tx) => identifierManuellementCpt(tx, { userId: commercial.id, encaissementId: e5.id, parts: [{ echeanceId: k1.echs[1].id, montant: fcfa(1234) }], justification: "Le payeur a présenté son reçu Wave", recuReference: "REÇU-77" }),
    { timeout: 60_000 },
  );
  verifier("E5 : identification manuelle vers l'échéance 2 de POL-K1, confirmée dans le même geste (reçu joint)", ident.ok, ident.ok ? "" : ident.message);
  if (ident.ok) {
    const lu = await prisma.cptRattachement.findUnique({ where: { id: ident.ids[0] } });
    verifier("E5 : méthode « manuelle », niveau « à confirmer », statut CONFIRME, proposée et confirmée par le commercial", lu?.methode === "MANUELLE" && lu.niveauPreuve === "A_CONFIRMER" && lu.statut === "CONFIRME" && lu.proposeParId === commercial.id && lu.confirmeParId === commercial.id);
    const vm = premier(await valider(ident.ids, rfcrh.id));
    const k1e2 = await prisma.cptEcheance.findUnique({ where: { id: k1.echs[1].id } });
    verifier("E5 : validée par le RFCRH ; échéance 2 à 1 234 réglés, encore ouverte (reste 1 266)", vm.ok && k1e2?.montantRegle.toString() === "1234" && k1e2.etat === "OUVERTE", vm.message);
  }
  const sansJustif = await prisma.$transaction(
    (tx) => identifierManuellementCpt(tx, { userId: commercial.id, encaissementId: e4.id, parts: [{ echeanceId: k1.echs[1].id, montant: fcfa(1) }], justification: "court", recuReference: "R" }),
    { timeout: 60_000 },
  );
  verifier("identification manuelle sans justification suffisante refusée", !sansJustif.ok);
  const sansRecu = await prisma.$transaction(
    (tx) => identifierManuellementCpt(tx, { userId: commercial.id, encaissementId: e4.id, parts: [{ echeanceId: k1.echs[1].id, montant: fcfa(1) }], justification: "Une justification assez longue" }),
    { timeout: 60_000 },
  );
  verifier("identification manuelle sans reçu refusée", !sansRecu.ok);

  // T1 : 4 500 payés dont 2 000 de frais de carte santé = « pas une prime »
  const e6 = await encaissement("T_FRAIS0000006", 4500, "2026-03-15");
  const pup = (montant: number, motif: string) =>
    prisma.$transaction((tx) => classerPasUnePrimeCpt(tx, { userId: commercial.id, encaissementId: e6.id, montant: fcfa(montant), motif }), { timeout: 60_000 });
  verifier("T1 : « pas une prime » sans motif suffisant refusé (RG-03)", !(await pup(2000, "ab")).ok);
  verifier("T1 : « pas une prime » au-delà du reste refusé", !(await pup(9000, "Frais de carte santé")).ok);
  verifier("T1 : 2 000 classés « pas une prime » avec leur motif", (await pup(2000, "Frais de carte santé")).ok);
  const e6b = await prisma.cptEncaissement.findUnique({ where: { id: e6.id } });
  verifier("T1 : reste 2 500 à rattacher, toujours à rattacher, motif conservé", e6b?.montantPasUnePrime.toString() === "2000" && e6b.resteARattacher.toString() === "2500" && e6b.statut === "A_RATTACHER" && e6b.motifPasUnePrime === "Frais de carte santé");
  verifier("T1 : les 2 500 restants classés à leur tour → encaissement soldé", (await pup(2500, "Remboursement reçu à tort")).ok && (await prisma.cptEncaissement.findUnique({ where: { id: e6.id } }))?.statut === "SOLDE");

  // ---------- 6. Concurrence ----------
  const k5 = await contrat("POL-K5", clients.issa.id, { echeances: [2500] });
  const e7 = await encaissement("T_CONCUR000007", 2500, "2026-03-20");
  const e8 = await encaissement("T_CONCUR000008", 2500, "2026-03-20");
  const creer = (encId: string) =>
    prisma.cptRattachement.create({ data: { encaissementId: encId, echeanceId: k5.echs[0].id, montant: 2500, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "essai de concurrence" } });
  const r7 = await creer(e7.id);
  const r8 = await creer(e8.id);
  const [x, y] = await Promise.all([valider([r7.id], rfcrh.id), valider([r8.id], rfcrh.id)]);
  const reussis = [x, y].filter((r) => r.ok && r.resultats[0].ok).length;
  verifier("deux validations qui se disputent la même échéance : une seule passe", reussis === 1, `${reussis} réussie(s)`);
  const k5e = await prisma.cptEcheance.findUnique({ where: { id: k5.echs[0].id } });
  verifier("l'échéance n'est réglée qu'une fois (2 500, soldée)", k5e?.montantRegle.toString() === "2500" && k5e.etat === "SOLDEE");

  const e9 = await encaissement("T_CONCUR000009", 2500, "2026-03-21");
  const k6 = await contrat("POL-K6", clients.issa.id, { echeances: [2500] });
  const r9 = await prisma.cptRattachement.create({ data: { encaissementId: e9.id, echeanceId: k6.echs[0].id, montant: 2500, methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", justification: "essai de concurrence" } });
  const [z1, z2] = await Promise.all([valider([r9.id], rfcrh.id), valider([r9.id], rfcrh.id)]);
  const reussis2 = [z1, z2].filter((r) => r.ok && r.resultats[0].ok).length;
  verifier("deux validations simultanées du même rattachement : une seule passe", reussis2 === 1, `${reussis2} réussie(s)`);
  verifier("une seule ligne d'audit de validation pour ce rattachement", (await prisma.cptAudit.count({ where: { entite: "CptRattachement", entiteId: r9.id, action: "validation" } })) === 1);

  // ---------- Audit ----------
  const audits = await prisma.cptAudit.groupBy({ by: ["action"], where: { entite: "CptRattachement" }, _count: true });
  const nb = (a: string) => audits.find((x) => x.action === a)?._count ?? 0;
  verifier("audit : rapprochements, confirmations, validations, rejet et identification tracés", nb("rapprochement") === 2 && nb("confirmation") >= 3 && nb("validation") >= 5 && nb("rejet") === 1 && nb("identification_manuelle") === 1, JSON.stringify(audits));

  console.log(resultats.join("\n"));
  if (resultats.some((r) => r.startsWith("KO"))) process.exit(1);
  console.log(`\nGC-5c : ${resultats.length} contrôles réussis.`);
}

main()
  .catch((e) => {
    console.log(resultats.join("\n"));
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
