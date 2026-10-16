// Congés — A1 (relecture du 2026-10-16) : la RH ne modifie jamais ses propres droits à congé.
// Base JETABLE seulement (voir e2e/README.md). Parcours : rh@ voit sa propre ligne de solde et sa date d'embauche grisées
// avec la phrase du serveur ; l'action rejouée (bouton dégrisé à la main, formulaire envoyé) est refusée par le serveur ;
// un autre compte reste ajustable.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/conges_|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const PHRASE_SOLDE = "Vous ne pouvez pas ajuster votre propre solde : un autre compte RH ou le DG doit le faire.";
const PHRASE_DATE = "Vous ne pouvez pas modifier votre propre date d'embauche.";

import { readFileSync } from "node:fs";
const manifeste = JSON.parse(readFileSync(new URL("../frontend/.next/server/server-reference-manifest.json", import.meta.url), "utf8"));
const ids = Object.fromEntries(Object.entries(manifeste.node).map(([id, v]) => [v.exportedName, id]));

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const rh = (await q(`SELECT id FROM "User" WHERE email = 'rh@simassurances.test'`))[0].id;
const collab = (await q(`SELECT id FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].id;

// Soldes de l'exercice en cours pour les deux comptes (dotation créée par la RH via l'écran, comme en usage réel).
await q(`DELETE FROM "AjustementSolde"`);
await q(`DELETE FROM "SoldeConge"`);
const dateEmbaucheRh = (await q(`SELECT "dateEmbauche" FROM "User" WHERE id = $1`, [rh]))[0].dateEmbauche;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.9.${10 + (Date.now() % 200)}` } });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreursJs.push(e.message));
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "rh@simassurances.test");
await p.fill('input[name="password"]', "password123");
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);

// ── Soldes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
await p.goto(`${B}/conges/soldes`);
await p.getByRole("button", { name: "Initialiser les soldes de l'exercice" }).click();
await p.waitForFunction(() => !document.body.innerText.includes("Aucun solde ouvert"), null, { timeout: 20000 });
const soldeRh = (await q(`SELECT id, "soldeRestant" FROM "SoldeConge" WHERE "userId" = $1 ORDER BY id LIMIT 1`, [rh]))[0];
const soldeCollab = (await q(`SELECT id, "soldeRestant" FROM "SoldeConge" WHERE "userId" = $1 ORDER BY id LIMIT 1`, [collab]))[0];
verifier("Soldes initialisés pour la RH et le collaborateur (dotation sans garde « pas pour soi »)", Boolean(soldeRh && soldeCollab));

await p.goto(`${B}/conges/soldes`);
const carteRh = p.locator("li", { hasText: "RH Test" }).filter({ hasText: "Exercice du" }).first();
verifier("Sa propre ligne : « Ajuster le solde » est grisé", await carteRh.getByRole("button", { name: "Ajuster le solde" }).isDisabled());
verifier("Sa propre ligne : la phrase du serveur est affichée", (await carteRh.innerText()).includes(PHRASE_SOLDE));

const carteCollab = p.locator("li", { hasText: "Collaborateur Test" }).filter({ hasText: "Exercice du" }).first();
verifier("La ligne d'un autre compte reste ajustable", await carteCollab.getByRole("button", { name: "Ajuster le solde" }).isEnabled());

// Action rejouée directement (contournement de l'écran) : POST de la vraie Server Action avec la session de la RH.
const rejouer = async (nomAction, args) => {
  const id = ids[nomAction];
  const corps = await p.evaluate(
    async ({ id, args, url }) => {
      const r = await fetch(url, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return r.text();
    },
    { id, args, url: `${B}/conges/soldes` }
  );
  return corps;
};
const reponseSolde = await rejouer("ajusterSoldeAction", [{ soldeCongeId: soldeRh.id, montant: 100, motif: "Tentative sur mon propre solde" }]);
verifier("Ajustement de son propre solde rejoué : refusé avec la phrase", reponseSolde.includes(PHRASE_SOLDE), reponseSolde.slice(0, 160));
const apres = (await q(`SELECT "soldeRestant" FROM "SoldeConge" WHERE id = $1`, [soldeRh.id]))[0].soldeRestant;
verifier("Son solde est inchangé en base", apres === soldeRh.soldeRestant, `${soldeRh.soldeRestant} → ${apres}`);
verifier("Aucun AjustementSolde écrit", (await q(`SELECT count(*)::int AS n FROM "AjustementSolde" WHERE "soldeCongeId" = $1`, [soldeRh.id]))[0].n === 0);

// Un autre compte : l'ajustement passe.
await carteCollab.getByRole("button", { name: "Ajuster le solde" }).click();
await carteCollab.getByLabel("Ajustement (jours)").fill("2");
await carteCollab.getByLabel("Motif").fill("Régularisation e2e");
await carteCollab.getByRole("button", { name: "Enregistrer l'ajustement" }).click();
await p.getByText("Solde ajusté").first().waitFor({ timeout: 15000 });
const collabApres = (await q(`SELECT "soldeRestant" FROM "SoldeConge" WHERE id = $1`, [soldeCollab.id]))[0].soldeRestant;
verifier("L'ajustement du solde d'un autre compte est accepté", collabApres === soldeCollab.soldeRestant + 2, `${soldeCollab.soldeRestant} → ${collabApres}`);

// ── Date d'embauche ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Le formulaire ne s'affiche que pour un compte sans date : on retire celle de la RH (base jetable), puis on la remet.
await q(`UPDATE "User" SET "dateEmbauche" = NULL WHERE id = $1`, [rh]);
await p.goto(`${B}/conges/soldes`);
const carteDate = p.locator("li", { hasText: "RH Test" }).filter({ has: p.getByLabel("Date d'embauche") }).first();
verifier("Sa propre date d'embauche : le champ est grisé", await carteDate.getByLabel("Date d'embauche").isDisabled());
verifier("Sa propre date d'embauche : la phrase du serveur est affichée", (await carteDate.innerText()).includes(PHRASE_DATE));
const reponseDate = await rejouer("modifierDateEmbaucheAction", [rh, "2020-01-01"]);
verifier("Date d'embauche rejouée : refusée avec la phrase", reponseDate.includes(PHRASE_DATE), reponseDate.slice(0, 160));
const dateApres = (await q(`SELECT "dateEmbauche" FROM "User" WHERE id = $1`, [rh]))[0].dateEmbauche;
verifier("Sa date d'embauche reste vide en base", dateApres === null);
await q(`UPDATE "User" SET "dateEmbauche" = $2 WHERE id = $1`, [rh, dateEmbaucheRh]);

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
