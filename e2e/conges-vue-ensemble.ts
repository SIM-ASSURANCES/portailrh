// Congés — vérification de la VUE D'ENSEMBLE et de l'EXPORT (backend/src/congesVueEnsemble.ts, congesVueEnsembleDb.ts)
// sur une base PostgreSQL jetable, sans navigateur.
//
//   DATABASE_URL=postgresql://postgres:pw@localhost:55498/conges_jetable npx tsx e2e/conges-vue-ensemble.ts
//
// Garde : le nom de la base doit contenir « jetable », « e2e » ou « conges ».

import {
  COLONNES_EXPORT_CONGE,
  deciderConge,
  filtresCongesDepuisRecherche,
  ligneExportConge,
  listerCongesVueEnsemble,
  prisma,
  saisirCongeRH,
  soumettreConge,
  transactionConge,
  type ActionDecisionConge,
  type EntreeConge,
  type FiltresCongesRequete,
} from "../backend/src/index";

const url = process.env.DATABASE_URL ?? "";
if (!/(jetable|e2e|conges)/i.test(url.split("/").pop() ?? "")) {
  console.error("Refus : DATABASE_URL doit viser une base jetable (nom contenant jetable, e2e ou conges).");
  process.exit(2);
}

let ok = 0;
let ko = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  if (condition) {
    ok++;
    console.log(`  ok   ${nom}`);
  } else {
    ko++;
    console.log(`  ECHEC ${nom}`, detail ?? "");
  }
}

type Compte = { id: string; serviceId: string | null; rolePermissions: string[] };
async function compte(email: string): Promise<Compte> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email: `${email}@simassurances.test` },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return {
    id: u.id,
    serviceId: u.serviceId,
    rolePermissions: u.role.permissions.map((p) => p.permission.key),
  };
}

const jc = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function lundi(semaines: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + 7 * semaines);
  return jc(d);
}

function plus(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return jc(new Date(a, m - 1, j + n));
}

function entree(
  dateDebut: string,
  dateFin: string,
  nature: EntreeConge["nature"] = "CONGE",
  motif = "Congé annuel"
): EntreeConge {
  return { nature, motif, dateDebut, dateFin };
}

async function soumettre(userId: string, e: EntreeConge) {
  return transactionConge((tx) => soumettreConge(tx, { userId, entree: e, maintenant: new Date() }));
}

async function agir(acteur: Compte, demandeId: string, action: ActionDecisionConge) {
  return transactionConge((tx) =>
    deciderConge(tx, {
      demandeId,
      acteur,
      action,
      peutAnnulerApresDebut: acteur.rolePermissions.includes("conges.annuler"),
      maintenant: new Date(),
    })
  );
}

async function toutesLesPages(filtres: FiltresCongesRequete, taillePage: number): Promise<string[]> {
  const refs: string[] = [];
  let page = 1;
  while (true) {
    const res = await listerCongesVueEnsemble(prisma, filtres, { page, taille: taillePage });
    refs.push(...res.lignes.map((l) => l.reference));
    if (refs.length >= res.total || res.lignes.length === 0) break;
    page++;
  }
  return refs;
}

async function main() {
  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  await prisma.jourFerie.deleteMany({});

  const collab = await compte("collaborateur");
  const resp = await compte("responsable-commercial");
  const rh = await compte("rh");
  const tech = await compte("responsable-technique");

  // 1. Demande validée qui commence AVANT la fenêtre et se termine DEDANS (chevauchement au début)
  const l1 = lundi(1);
  const s1 = await soumettre(collab.id, entree(l1, plus(l1, 3), "CONGE", "Congé chevauchant le début"));
  if (!s1.ok) throw new Error(s1.erreur);
  await agir(resp, s1.valeur.id, { type: "APPROUVER" });
  await agir(rh, s1.valeur.id, { type: "APPROUVER", observationRH: "Accordé RH" });

  // 2. Demande validée saisie par la RH (nature PERMISSION_EXCEPTIONNELLE)
  const l2 = lundi(2);
  const s2 = await transactionConge((tx) =>
    saisirCongeRH(tx, {
      acteurId: rh.id,
      userId: collab.id,
      entree: entree(l2, plus(l2, 1), "PERMISSION_EXCEPTIONNELLE", "Événement familial"),
      maintenant: new Date(),
    })
  );
  if (!s2.ok) throw new Error(s2.erreur);

  // 3. Demande validée d'un responsable (étape responsable non requise, autre service)
  const l3 = lundi(3);
  const s3 = await soumettre(tech.id, entree(l3, plus(l3, 2), "CONGE", "Congé responsable technique"));
  if (!s3.ok) throw new Error(s3.erreur);
  await agir(rh, s3.valeur.id, { type: "APPROUVER" });

  // 4. Demande en attente du responsable
  const l4 = lundi(4);
  const s4 = await soumettre(collab.id, entree(l4, plus(l4, 1), "CONGE", "En attente responsable"));
  if (!s4.ok) throw new Error(s4.erreur);

  // 5. Demande rejetée par la RH
  const l5 = lundi(5);
  const s5 = await soumettre(tech.id, entree(l5, plus(l5, 1), "PERMISSION_EXCEPTIONNELLE", "Demande refusée"));
  if (!s5.ok) throw new Error(s5.erreur);
  await agir(rh, s5.valeur.id, { type: "REJETER", motif: "Effectif insuffisant", observationRH: "Reporter" });

  // 6. Demande annulée
  const l6 = lundi(6);
  const s6 = await soumettre(collab.id, entree(l6, plus(l6, 1), "CONGE", "Demande annulée ensuite"));
  if (!s6.ok) throw new Error(s6.erreur);
  await agir(collab, s6.valeur.id, { type: "ANNULER", motif: "Changement de programme" });

  const debutGlobal = plus(l1, 2); // commence au milieu de s1 (chevauchement du début)
  const finGlobale = plus(l6, 5);

  console.log("Chevauchement et statut par défaut");
  const fDefaut = filtresCongesDepuisRecherche({ du: debutGlobal, au: finGlobale }, debutGlobal);
  if (!fDefaut.ok) throw new Error(fDefaut.erreur);
  const sansPagDefaut = await listerCongesVueEnsemble(prisma, fDefaut);
  const refsDefaut = sansPagDefaut.lignes.map((l) => l.reference);

  verifier(
    "congé qui chevauche le début de la période inclus",
    refsDefaut.includes(s1.valeur.reference),
    refsDefaut
  );
  verifier(
    "demande annulée absente avec le statut par défaut (VALIDEE)",
    !refsDefaut.includes(s6.valeur.reference) &&
      refsDefaut.length === 3 &&
      sansPagDefaut.lignes.every((l) => l.statut === "VALIDEE"),
    refsDefaut
  );

  console.log("Pagination contre export complet (3 jeux de filtres)");
  const fTous = filtresCongesDepuisRecherche(
    { du: debutGlobal, au: finGlobale, statut: "TOUS" },
    debutGlobal
  );
  if (!fTous.ok) throw new Error(fTous.erreur);

  const fServiceNature = filtresCongesDepuisRecherche(
    {
      du: debutGlobal,
      au: finGlobale,
      statut: "TOUS",
      service: collab.serviceId ?? "",
      nature: "CONGE",
    },
    debutGlobal
  );
  if (!fServiceNature.ok) throw new Error(fServiceNature.erreur);

  const jeux: { nom: string; filtres: FiltresCongesRequete }[] = [
    { nom: "jeu 1 (défaut VALIDEE)", filtres: fDefaut },
    { nom: "jeu 2 (tous les statuts)", filtres: fTous },
    { nom: "jeu 3 (service Commercial + nature CONGE)", filtres: fServiceNature },
  ];

  for (const j of jeux) {
    const complet = await listerCongesVueEnsemble(prisma, j.filtres);
    const pagesReunies = await toutesLesPages(j.filtres, 2);
    verifier(
      `${j.nom} : pagination (taille 2) renvoie exactement les mêmes références dans le même ordre que sans pagination`,
      complet.lignes.length > 0 &&
        JSON.stringify(complet.lignes.map((l) => l.reference)) === JSON.stringify(pagesReunies),
      { complet: complet.lignes.map((l) => l.reference), pagesReunies }
    );
  }

  console.log("Colonnes de ligneExportConge");
  const toutesLignes = (await listerCongesVueEnsemble(prisma, fTous)).lignes;
  verifier(
    "ligneExportConge produit 13 colonnes pour chaque ligne",
    toutesLignes.length === 6 &&
      toutesLignes.every((l) => {
        const exp = ligneExportConge(l);
        return (
          Object.keys(exp).length === 13 &&
          JSON.stringify(Object.keys(exp)) === JSON.stringify(COLONNES_EXPORT_CONGE.map((c) => c.cle))
        );
      })
  );

  await prisma.plageAbsenceAutorisee.deleteMany({});
  await prisma.demandeConge.deleteMany({});
  console.log(`\n${ok} vérification(s) réussie(s), ${ko} en échec.`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

