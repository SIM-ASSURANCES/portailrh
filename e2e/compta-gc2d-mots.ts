// Gestion Compta, lot GC-2d — INDEX DE RECHERCHE PAR MOTS : comparaison du remplissage SQL de la migration et du calcul TypeScript,
// puis (COMPTA_PERF=1) mesure des temps de recherche sur un jeu synthétique.
// Sur base JETABLE seulement (lancé depuis la racine du dépôt par e2e/compta-gc1a-schema.sh, étape 8, qui a déjà inséré les fiches
// d'essai et exécuté le remplissage SQL) : DATABASE_URL doit viser une base dont le nom contient « compta ».
//  1. chaque fiche : les mots écrits par la migration sont EXACTEMENT ceux de `motsIndexesCpt` (aucun en plus, aucun en moins) ;
//  2. la recherche (`rechercherCpt`) trouve par début de mot, plusieurs mots, téléphone sans « + », accents et apostrophes ;
//  3. COMPTA_PERF=1 : 150 000 clients synthétiques, remplissage SQL chronométré, recherches chronométrées (seuil 1 s).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "../backend/src/prisma";
import { LIBELLE_BRANCHE_CPT } from "../backend/src/cptReferentiels";
import { motsIndexesCpt, rechercherCpt, textesIndexClientCpt, textesIndexPartenaireCpt, textesIndexProduitCpt } from "../backend/src/cptRecherche";

const resultats: string[] = [];
const verifier = (nom: string, ok: boolean, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const trie = (m: string[]) => [...m].sort();

async function motsEnBase(entite: string, id: string): Promise<string[]> {
  const lignes = await prisma.cptMot.findMany({ where: { entite, entiteId: id }, select: { mot: true } });
  return trie(lignes.map((l) => l.mot));
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/compta/i.test(url)) throw new Error("DATABASE_URL doit viser une base jetable Gestion Compta.");

  // ---------- 1. SQL = TypeScript, fiche par fiche ----------
  const partenaires = await prisma.cptPartenaire.findMany();
  const clients = await prisma.cptClient.findMany({ include: { partenaireOrigine: { select: { nom: true } } } });
  const produits = await prisma.cptProduit.findMany();
  verifier("des fiches d'essai existent (partenaires, clients, produits)", partenaires.length >= 2 && clients.length >= 2 && produits.length >= 2, `${partenaires.length}/${clients.length}/${produits.length}`);

  for (const p of partenaires) {
    const attendu = trie(motsIndexesCpt(textesIndexPartenaireCpt(p)));
    const obtenu = await motsEnBase("PARTENAIRE", p.id);
    verifier(`partenaire « ${p.nom} » : mots SQL = mots TypeScript`, JSON.stringify(attendu) === JSON.stringify(obtenu), JSON.stringify({ attendu, obtenu }));
  }
  for (const c of clients) {
    const attendu = trie(motsIndexesCpt(textesIndexClientCpt({ ...c, partenaireOrigineNom: c.partenaireOrigine?.nom ?? null })));
    const obtenu = await motsEnBase("CLIENT", c.id);
    verifier(`client « ${c.nom} » : mots SQL = mots TypeScript`, JSON.stringify(attendu) === JSON.stringify(obtenu), JSON.stringify({ attendu, obtenu }));
  }
  for (const x of produits) {
    const attendu = trie(motsIndexesCpt(textesIndexProduitCpt({ ...x, libelleBranche: LIBELLE_BRANCHE_CPT[x.branche] })));
    const obtenu = await motsEnBase("PRODUIT", x.id);
    verifier(`produit « ${x.code} » : mots SQL = mots TypeScript`, JSON.stringify(attendu) === JSON.stringify(obtenu), JSON.stringify({ attendu, obtenu }));
  }

  // ---------- 2. Recherche ----------
  const ids = async (saisie: string, entite?: "CLIENT" | "PARTENAIRE" | "PRODUIT") =>
    (await rechercherCpt(prisma, saisie, { entite })).map((r) => `${r.entite}:${r.entiteId}`);
  const clientNguessan = clients.find((c) => c.nom.includes("Guessan"));
  const produitSecur = produits.find((x) => x.code.startsWith("SECUR"));
  if (clientNguessan) {
    verifier("« nguessan » trouve « N'Guessan » (apostrophe ignorée)", (await ids("nguessan")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("« guessan » (partie du mot composé) le trouve aussi", (await ids("guessan")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("« NGUE » (début de mot, casse ignorée)", (await ids("NGUE", "CLIENT")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("un fragment au milieu d'un mot ne trouve rien (« uessan »)", !(await ids("uessan")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("le téléphone se retrouve sans le « + » (« 22507 »)", (await ids("22507", "CLIENT")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("plusieurs mots (ET) : « aya nguessan »", (await ids("aya nguessan")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("plusieurs mots : un mot absent écarte la fiche (« aya zzzz »)", !(await ids("aya zzzz")).includes(`CLIENT:${clientNguessan.id}`));
    verifier("restreindre à PRODUIT écarte le client", !(await ids("nguessan", "PRODUIT")).includes(`CLIENT:${clientNguessan.id}`));
  } else {
    verifier("la fiche d'essai « N'Guessan » existe", false);
  }
  if (produitSecur) {
    verifier("« securite » (accent ignoré) trouve le produit", (await ids("securite")).includes(`PRODUIT:${produitSecur.id}`));
    verifier("« secur pro » trouve le produit SECUR-PRO", (await ids("secur pro")).includes(`PRODUIT:${produitSecur.id}`));
    verifier("la branche fait partie des mots (« deces »)", (await ids("deces", "PRODUIT")).includes(`PRODUIT:${produitSecur.id}`));
  } else {
    verifier("le produit d'essai SECUR-PRO existe", false);
  }
  verifier("saisie vide : aucun résultat", (await ids("   ")).length === 0);
  verifier("les jokers « % » et « _ » sont cherchés tels quels", (await ids("%")).length === 0 && (await ids("_")).length === 0);

  // ---------- 3. Performance (facultative) ----------
  if (process.env.COMPTA_PERF === "1") {
    const N = Number(process.env.COMPTA_PERF_N ?? 150000);
    const conteneur = process.env.COMPTA_PG_CONTENEUR ?? "pg-compta-gc1a";
    const psql = (args: string[], input?: string) =>
      execFileSync("docker", ["exec", "-i", conteneur, "psql", "-U", "postgres", "-d", "compta", "-v", "ON_ERROR_STOP=1", "-q", ...args], { encoding: "utf8", input }).trim();
    psql([
      "-c",
      `INSERT INTO "CptClient" (id, nom, telephone, "pieceIdentite", "majAt")
       SELECT 'perf' || i,
              (ARRAY['Koné','Traoré','N''Guessan','Ouattara','Bamba','Yao','Diallo','Coulibaly','Aka','Soro'])[i % 10 + 1] || ' ' ||
              (ARRAY['Aya','Marie','Jean-Marc','Fatou','Kouadio','Awa','Ibrahim','Salif','Adjoua','Yves'])[(i / 10) % 10 + 1] || ' ' || i,
              '+22507' || lpad(i::text, 8, '0'), 'CNI-' || lpad(i::text, 8, '0'), now()
       FROM generate_series(1, ${N}) AS i`,
    ]);
    const fichier = path.resolve(process.cwd(), "backend/prisma/migrations/20261101150000_compta_recherche_mots/migration.sql");
    const remplissage = readFileSync(fichier, "utf8").split(/^(?=INSERT INTO "CptMot")/m).pop() ?? "";
    const t0 = Date.now();
    psql([], remplissage);
    const dureeRemplissage = Date.now() - t0;
    psql(["-c", `ANALYZE "CptMot"`]);
    const mots = psql(["-t", "-A", "-c", `SELECT count(*) FROM "CptMot"`]);
    console.log(`Remplissage SQL de ${N} clients : ${(dureeRemplissage / 1000).toFixed(1)} s, ${mots} mots`);

    for (const saisie of ["kone", "kone aya", "kone aya 1234", "22507000", "cni 0000", "jeanmarc", "zzzz", "k"]) {
      let pire = 0;
      let n = 0;
      for (let i = 0; i < 3; i++) {
        const d0 = Date.now();
        n = (await rechercherCpt(prisma, saisie, { limite: 500 })).length;
        pire = Math.max(pire, Date.now() - d0);
      }
      console.log(`  « ${saisie} » : ${n} résultat(s), pire de 3 passages ${pire} ms`);
      verifier(`recherche « ${saisie} » en moins d'une seconde (${N} clients)`, pire < 1000, `${pire} ms`);
    }
  }

  console.log(resultats.join("\n"));
  const ko = resultats.filter((r) => r.startsWith("KO")).length;
  console.log(`\nGC-2d (index de mots) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
  await prisma.$disconnect();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
