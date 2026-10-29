// Fiabilisation du pointage — phase 1 (2026-10-14) : la déconnexion pour inactivité est retirée, les deux durées de
// session doivent être GLISSANTES (1 jour sans la case, 30 jours avec). On lit l'expiration chiffrée DANS le jeton
// (`exp`, jamais le Max-Age du cookie, toujours 30 jours) : une seconde visite plus tard doit l'avoir fait avancer.
// Horloge « simulée » : l'expiration vaut `maintenant + durée` à chaque ré-encodage, une attente de quelques secondes
// entre deux visites prouve donc la même chose qu'une attente de deux heures. Base JETABLE uniquement (e2e/README.md).
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { decode } from "next-auth/jwt";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const secret =
  process.env.AUTH_SECRET ??
  readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^AUTH_SECRET="?([^"\r\n]+)"?/m)?.[1];
if (!secret) throw new Error("AUTH_SECRET introuvable (variable d'environnement ou .env racine).");

const NOM_COOKIE = "authjs.session-token";
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch();
const erreursJs = [];

async function expiration(ctx) {
  const cookie = (await ctx.cookies()).find((c) => c.name === NOM_COOKIE);
  if (!cookie) return null;
  const jeton = await decode({ token: cookie.value, secret, salt: NOM_COOKIE });
  return jeton?.exp ?? null;
}

async function scenario(nom, seSouvenir, dureeSecondes) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', "collaborateur@simassurances.test");
  await p.fill('input[name="password"]', "password123");
  const case_ = p.locator('input[name="rememberMe"]');
  if ((await case_.isChecked()) !== seSouvenir) await case_.setChecked(seSouvenir);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);

  await p.goto(`${B}/`);
  const exp1 = await expiration(ctx);
  await p.waitForTimeout(4000);
  await p.goto(`${B}/pointage/historique`);
  const exp2 = await expiration(ctx);

  verifier(`${nom} : jeton lisible`, exp1 !== null && exp2 !== null);
  if (exp1 !== null && exp2 !== null) {
    verifier(`${nom} : l'expiration a avancé après une nouvelle visite`, exp2 > exp1, `+${exp2 - exp1} s`);
    const restant = exp2 - Math.floor(Date.now() / 1000);
    verifier(
      `${nom} : durée restante ≈ ${dureeSecondes / 3600} h comptée depuis la dernière visite`,
      Math.abs(restant - dureeSecondes) < 60,
      `${restant} s`
    );
  }
  await ctx.close();
}

await scenario("Sans la case (1 jour)", false, 24 * 3600);
await scenario("Avec la case (30 jours)", true, 30 * 24 * 3600);

// Un ancien lien de déconnexion pour inactivité affiche la page de connexion normalement, sans erreur.
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${B}/login?error=inactivite`);
  const texte = await p.locator("body").innerText();
  verifier("Ancien lien ?error=inactivite : formulaire affiché", await p.locator('input[name="email"]').isVisible());
  verifier(
    "Ancien lien ?error=inactivite : aucun message d'erreur",
    !/incorrect|inactivité|Trop de tentatives/i.test(texte)
  );
  await ctx.close();
}
verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

await browser.close();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
