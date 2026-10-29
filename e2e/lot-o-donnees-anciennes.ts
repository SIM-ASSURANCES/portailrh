// Lot O — fabrique, sur une base JETABLE, des données « anciennes » (d'avant les lots B, C, D, L bis) pour tester le rattrapage :
// articles décidés sans statut/étape/montant validé à jour, règlements sans article (un cas simple, un cas ambigu), demande
// clôturée avant la règle « tous les articles terminés », lignes d'historique sans lien vers leur action signée.
// Lancé par e2e/lot-o.mjs : `cd backend && npx tsx ../e2e/lot-o-donnees-anciennes.ts` (DATABASE_URL = base jetable).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../backend/src/generated/prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost:55497/.test(url)) throw new Error("DATABASE_URL doit viser une base jetable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const user = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;
  const collab = await user("collaborateur@simassurances.test");
  const finance = await user("finance@simassurances.test");
  const dg = await user("dg@simassurances.test");

  const demande = (reference: string, montant: number, extra: Record<string, unknown> = {}) =>
    prisma.demande.create({
      data: {
        reference,
        montant,
        beneficiaireType: "COLLABORATEUR",
        etapeCircuit: "FINANCE",
        statut: "EN_ATTENTE_VALIDATION",
        createurId: collab,
        ...extra,
      } as never,
    });
  const ligne = (demandeId: string, libelle: string, prix: number, statutValidation: "VALIDEE" | "EN_ATTENTE" = "VALIDEE") =>
    prisma.ligneDemande.create({ data: { demandeId, libelle, quantite: 1, prixUnitaire: prix, statutValidation, decideParId: finance, decideAt: new Date() } });

  // A — articles validés, mais statut / étape / montant validé jamais mis à jour (avant le lot B)
  const a = await demande("OLD-A", 100000);
  await ligne(a.id, "A1", 50000);
  await ligne(a.id, "A2", 50000);

  // B — règlement confirmé sans article, UN SEUL article validé : rattachable sans doute possible
  const b = await demande("OLD-B", 40000, { montantValide: 40000, etapeCircuit: "TERMINEE", statut: "VALIDEE_NON_REGLEE" });
  await ligne(b.id, "B1", 40000);
  await prisma.reglement.create({ data: { demandeId: b.id, auteurId: finance, montant: 40000, mode: "CAISSE", estConfirme: true, confirmeAt: new Date(), motif: "Ancien règlement" } });

  // C — règlement sans article, DEUX articles validés : AMBIGU, jamais deviné
  const c = await demande("OLD-C", 50000, { montantValide: 50000, etapeCircuit: "TERMINEE", statut: "PARTIELLEMENT_REGLEE" });
  await ligne(c.id, "C1", 30000);
  await ligne(c.id, "C2", 20000);
  await prisma.reglement.create({ data: { demandeId: c.id, auteurId: finance, montant: 30000, mode: "BANQUE", estConfirme: true, confirmeAt: new Date(), motif: "Ancien règlement" } });

  // D — demande clôturée avant la règle « tous les articles terminés » : un article validé jamais réglé
  const d = await demande("OLD-D", 25000, { montantValide: 25000, etapeCircuit: "TERMINEE", statut: "CLOTUREE", validationCompleteParDG: true, motifCloture: "Ancienne clôture" });
  await ligne(d.id, "D1", 25000);

  // E — historique d'actions signées sans lien vers l'action signée
  const image = Buffer.from("iVBORw0KGgo=", "base64");
  const sig = async (userId: string, version: number) =>
    prisma.signatureUtilisateur.create({ data: { userId, version, image, largeur: 600, hauteur: 200, empreinte: `empreinte-${userId}-${version}` } });
  const sigFinance = await sig(finance, 1);
  const sigDg1 = await sig(dg, 1);
  const sigDg2 = await sig(dg, 2);
  const maintenant = Date.now();
  const action = (signataireId: string, signatureId: string, decalageMs: number) =>
    prisma.actionSignee.create({ data: { signataireId, signatureId, action: "validerLignesAction", demandeId: a.id, ip: "10.0.0.1", creeAt: new Date(maintenant + decalageMs) } });
  // E1 : une seule candidate -> rattachable
  await action(finance, sigFinance.id, 0);
  await prisma.historiqueEntry.create({ data: { entity: "Demande", entityId: a.id, action: "validation_ligne", detail: "ancienne validation", userId: finance, createdAt: new Date(maintenant + 1000) } });
  // E2 : deux candidates de versions différentes dans la minute -> ambiguë
  await action(dg, sigDg1.id, 10_000);
  await action(dg, sigDg2.id, 20_000);
  await prisma.historiqueEntry.create({ data: { entity: "Demande", entityId: a.id, action: "decision_ligne_dg", detail: "ancienne décision", userId: dg, createdAt: new Date(maintenant + 21_000) } });
  // E3 : antérieure à la mise en service des signatures -> « Antérieur à la signature », jamais touchée
  await prisma.historiqueEntry.create({ data: { entity: "Demande", entityId: a.id, action: "validation_ligne", detail: "avant les signatures", userId: finance, createdAt: new Date("2026-01-15T10:00:00Z") } });

  console.log("Données anciennes créées : OLD-A (statuts), OLD-B (règlement rattachable), OLD-C (ambigu), OLD-D (clôture), historique E1/E2/E3.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
