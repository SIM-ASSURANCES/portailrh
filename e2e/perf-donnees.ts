// Lot N+O (partie 4, performance) — remplit une base JETABLE `perf` (seed déjà passé) d'un volume réaliste pour un an d'activité
// d'une entreprise d'une centaine de personnes : 150 comptes en plus, 4 000 demandes à 3 articles, ~2 400 règlements confirmés,
// retours et dépenses, journal de caisse, 16 000 lignes d'historique, notifications, 30 000 pointages, justifications, absences.
// Lancé par e2e/perf-navigation.mjs : `cd backend && npx tsx ../e2e/perf-donnees.ts` (DATABASE_URL = base jetable).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../backend/src/generated/prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost:55497/.test(url)) throw new Error("DATABASE_URL doit viser la base jetable (localhost:55497).");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const par = <T,>(liste: T[], taille: number) => Array.from({ length: Math.ceil(liste.length / taille) }, (_, i) => liste.slice(i * taille, (i + 1) * taille));
const choisir = <T,>(liste: readonly T[], i: number) => liste[i % liste.length];

async function main() {
  const t0 = Date.now();
  const modele = await prisma.user.findFirstOrThrow({ where: { email: "collaborateur@simassurances.test" }, select: { passwordHash: true, roleId: true } });
  const finance = (await prisma.user.findFirstOrThrow({ where: { email: "finance@simassurances.test" }, select: { id: true } })).id;
  const assistant = (await prisma.user.findFirstOrThrow({ where: { email: "assistant-finance@simassurances.test" }, select: { id: true } })).id;
  const services = await prisma.service.findMany({ select: { id: true } });

  await prisma.user.createMany({
    data: Array.from({ length: 150 }, (_, i) => ({
      fullName: `Employé Perf ${i + 1}`,
      email: `perf${i + 1}@simassurances.test`,
      passwordHash: modele.passwordHash,
      roleId: modele.roleId,
      serviceId: choisir(services, i).id,
      isActive: true,
    })),
  });
  const employes = (await prisma.user.findMany({ where: { email: { startsWith: "perf" } }, select: { id: true } })).map((u) => u.id);

  const ETAPES = ["TERMINEE", "TERMINEE", "TERMINEE", "TERMINEE", "TERMINEE", "TERMINEE", "SERVICE", "FINANCE", "DG", "A_CORRIGER"] as const;
  const demandes = Array.from({ length: 4000 }, (_, i) => {
    const etape = choisir(ETAPES, i);
    const terminee = etape === "TERMINEE";
    return {
      reference: `PERF-${String(i + 1).padStart(6, "0")}`,
      montant: 90000 + (i % 50) * 1000,
      montantValide: terminee ? 90000 + (i % 50) * 1000 : null,
      beneficiaireType: "COLLABORATEUR" as const,
      etapeCircuit: etape,
      statut: terminee ? (i % 6 === 0 ? ("CLOTUREE" as const) : ("REGLEE" as const)) : ("EN_ATTENTE_VALIDATION" as const),
      createurId: choisir(employes, i),
      createdAt: new Date(Date.now() - (i % 360) * 86400000),
    };
  });
  for (const lot of par(demandes, 1000)) await prisma.demande.createMany({ data: lot as never });
  const ids = await prisma.demande.findMany({ where: { reference: { startsWith: "PERF-" } }, select: { id: true, etapeCircuit: true, statut: true, createurId: true, montant: true }, orderBy: { reference: "asc" } });

  const lignes = ids.flatMap((d, i) =>
    [0, 1, 2].map((k) => ({
      demandeId: d.id,
      libelle: `Article ${i + 1}.${k + 1}`,
      quantite: 1,
      prixUnitaire: Number(d.montant) / 3,
      statutValidation: d.etapeCircuit === "TERMINEE" ? ("VALIDEE" as const) : ("EN_ATTENTE" as const),
      decideParId: d.etapeCircuit === "TERMINEE" ? finance : null,
      decideAt: d.etapeCircuit === "TERMINEE" ? new Date() : null,
    }))
  );
  for (const lot of par(lignes, 2000)) await prisma.ligneDemande.createMany({ data: lot });

  const terminees = ids.filter((d) => d.etapeCircuit === "TERMINEE");
  const reglements = terminees.map((d, i) => ({
    demandeId: d.id,
    auteurId: assistant,
    montant: Number(d.montant),
    mode: i % 3 === 0 ? ("BANQUE" as const) : ("CAISSE" as const),
    estConfirme: true,
    confirmeAt: new Date(Date.now() - (i % 300) * 86400000),
    motif: `Règlement ${i + 1}`,
  }));
  for (const lot of par(reglements, 1500)) await prisma.reglement.createMany({ data: lot });
  const regs = await prisma.reglement.findMany({ where: { demande: { reference: { startsWith: "PERF-" } } }, select: { id: true, mode: true, montant: true } });
  await prisma.journalCaisse.createMany({ data: [{ type: "ENTREE", montant: 900_000_000, source: "solde_ouverture", refId: "perf", userId: assistant }] });
  const caisse = regs.filter((r) => r.mode === "CAISSE");
  for (const lot of par(caisse, 1500)) await prisma.journalCaisse.createMany({ data: lot.map((r) => ({ type: "SORTIE", montant: Number(r.montant), source: "reglement", refId: r.id, userId: assistant })) });
  const avecRetour = caisse.filter((_, i) => i % 3 === 0);
  for (const lot of par(avecRetour, 1000)) await prisma.retourCaisse.createMany({ data: lot.map((r, i) => ({ reglementId: r.id, declarantId: choisir(employes, i), montantARetourner: 5000 })) });
  const retours = await prisma.retourCaisse.findMany({ where: { reglement: { demande: { reference: { startsWith: "PERF-" } } } }, select: { id: true } });
  for (const lot of par(retours, 1500)) await prisma.depenseLigne.createMany({ data: lot.map((r) => ({ retourCaisseId: r.id, montant: 20000, objet: "Dépense perf", date: new Date(), justification: "SANS_PIECE" as const })) });

  const histo = ids.flatMap((d, i) =>
    ["creation", "validation_service", "decision_circuit", "reglement"].slice(0, 2 + (i % 3)).map((action) => ({ entity: "Demande", entityId: d.id, action, detail: `perf ${action}`, userId: d.createurId }))
  );
  for (const lot of par(histo, 3000)) await prisma.historiqueEntry.createMany({ data: lot });

  const notifications = employes.flatMap((u) => Array.from({ length: 30 }, (_, k) => ({ titre: `Notification ${k + 1}`, message: "perf", userId: u, category: "TRESORERIE" as const, estLue: k > 5 })));
  for (const lot of par(notifications, 3000)) await prisma.notification.createMany({ data: lot });

  const pointages = employes.flatMap((u, i) =>
    Array.from({ length: 100 }, (_, k) => {
      const jour = new Date(Date.now() - (k + 1) * 86400000);
      const arrivee = new Date(jour);
      arrivee.setUTCHours(7 + (k % 7 === 0 ? 1 : 0), 40 + (i % 20), 0, 0);
      const depart = new Date(jour);
      depart.setUTCHours(16, 50, 0, 0);
      return [
        { type: "ARRIVEE" as const, source: "ORDINATEUR" as const, heure: arrivee, estRetard: k % 7 === 0, minutesRetard: k % 7 === 0 ? 10 : null, userId: u },
        { type: "DEPART" as const, source: "ORDINATEUR" as const, heure: depart, userId: u },
      ];
    }).flat()
  );
  for (const lot of par(pointages, 3000)) await prisma.pointage.createMany({ data: lot });
  const retards = await prisma.pointage.findMany({ where: { estRetard: true, user: { email: { startsWith: "perf" } } }, select: { id: true }, take: 2500 });
  for (const lot of par(retards, 1500)) await prisma.justificationPointage.createMany({ data: lot.map((p, i) => ({ pointageId: p.id, statut: i % 3 === 0 ? ("SOUMISE" as const) : ("ACCEPTEE" as const), motif: "perf" })) });
  await prisma.absence.createMany({ data: employes.flatMap((u, i) => Array.from({ length: 10 }, (_, k) => ({ date: new Date(Date.now() - (k * 9 + (i % 9) + 1) * 86400000), userId: u }))) });

  console.log(`Base perf remplie en ${((Date.now() - t0) / 1000).toFixed(0)} s : ${employes.length} comptes, ${ids.length} demandes, ${lignes.length} articles, ${regs.length} règlements, ${histo.length} historiques, ${pointages.length} pointages.`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
