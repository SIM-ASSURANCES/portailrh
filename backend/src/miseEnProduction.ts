import { PERMISSIONS_SIGNATAIRES } from "./signatureConstantes";

/**
 * Logique PURE du contrôle « prêt pour la mise en production » (lot N, 2026-10-30). Aucun accès base ici : le script
 * `prisma/verifier-mise-en-production.ts` lit la base (en LECTURE SEULE) puis passe les données à ces fonctions. Chaque
 * vérification renvoie un `Point` : OK, AVERTISSEMENT (à regarder, ne bloque pas), À CORRIGER (bloque : code de sortie non nul)
 * ou INFO (liste à contrôler à la main). Les valeurs secrètes (variables d'environnement) ne sont JAMAIS reprises dans un message.
 */

export type VerdictPoint = "OK" | "A_CORRIGER" | "AVERTISSEMENT" | "INFO";

export interface Point {
  id: string;
  titre: string;
  verdict: VerdictPoint;
  detail: string;
  /** Lignes de détail (comptes manquants, migrations en défaut…). */
  elements?: string[];
}

const point = (id: string, titre: string, verdict: VerdictPoint, detail: string, elements?: string[]): Point => ({
  id,
  titre,
  verdict,
  detail,
  ...(elements && elements.length > 0 ? { elements } : {}),
});

/** Noms de rôles de la configuration cible (seed et runbook). */
export const ROLE_FINANCE = "Finance";
export const ROLE_DG = "DG";
export const ROLE_ASSISTANT_FINANCE = "Assistant Finance";

export const PERMISSIONS_FINANCE_REQUISES = [
  "treso.soumettre_dg",
  "treso.decider_finance",
  "treso.cloturer_demande",
  "treso.modifier_budget_categorie",
  "treso.reorienter_demande",
] as const;
export const PERMISSION_FINANCE_INTERDITE = "treso.approuver_validation_complete";
export const PERMISSIONS_DG_REQUISES = ["treso.approuver_validation_complete", "systeme.reinitialiser", "treso.valider_budget"] as const;
export const PERMISSION_DG_SEUL = "treso.valider_budget";
export const PERMISSION_RH = "pointage.corriger_pointage";

export const SERVICES_ATTENDUS = ["Commercial", "Informatique", "Direction DG", "Finance", "RH", "Technique", "Comptabilité", "Marketing"] as const;
export const DOMAINE_COMPTES_DE_TEST = "@simassurances.test";

// ---------- Migrations ----------

/** `attendues` = dossiers de `prisma/migrations`, `appliquees` = lignes terminées de `_prisma_migrations`. */
export function verifierMigrations(attendues: readonly string[], appliquees: readonly string[], nonTerminees: readonly string[] = []): Point {
  const ok = new Set(appliquees);
  const manquantes = attendues.filter((m) => !ok.has(m)).sort();
  const inconnues = appliquees.filter((m) => !attendues.includes(m)).sort();
  if (manquantes.length === 0 && nonTerminees.length === 0) {
    return point("migrations", "Migrations", "OK", `${attendues.length} migration(s) appliquée(s)${inconnues.length ? `, ${inconnues.length} inconnue(s) du dépôt (base plus récente que ce code ?)` : ""}.`, inconnues.length ? inconnues : undefined);
  }
  return point(
    "migrations",
    "Migrations",
    "A_CORRIGER",
    `${manquantes.length} migration(s) non appliquée(s)${nonTerminees.length ? `, ${nonTerminees.length} en échec` : ""} : lancer « prisma migrate deploy ».`,
    [...manquantes.map((m) => `non appliquée : ${m}`), ...nonTerminees.map((m) => `échec ou inachevée : ${m}`)]
  );
}

// ---------- Rôles et permissions ----------

export interface RoleConfig {
  name: string;
  permissions: readonly string[];
}

export function verifierRoleFinance(roles: readonly RoleConfig[]): Point {
  const finance = roles.find((r) => r.name === ROLE_FINANCE);
  if (!finance) return point("role-finance", `Rôle « ${ROLE_FINANCE} »`, "A_CORRIGER", `Le rôle « ${ROLE_FINANCE} » n'existe pas.`);
  const problemes: string[] = [];
  if (finance.permissions.includes(PERMISSION_FINANCE_INTERDITE)) problemes.push(`porte ${PERMISSION_FINANCE_INTERDITE} (réservée au DG : à décocher)`);
  for (const p of PERMISSIONS_FINANCE_REQUISES) if (!finance.permissions.includes(p)) problemes.push(`n'a pas ${p} (à cocher)`);
  return problemes.length === 0
    ? point("role-finance", `Rôle « ${ROLE_FINANCE} »`, "OK", "Permissions conformes (décision, soumission au DG, clôture, budgets, réorientation ; pas l'approbation de clôture).")
    : point("role-finance", `Rôle « ${ROLE_FINANCE} »`, "A_CORRIGER", `${problemes.length} écart(s) dans /admin/roles.`, problemes);
}

export function verifierRoleDG(roles: readonly RoleConfig[]): Point {
  const dg = roles.find((r) => r.name === ROLE_DG);
  if (!dg) return point("role-dg", `Rôle « ${ROLE_DG} »`, "A_CORRIGER", `Le rôle « ${ROLE_DG} » n'existe pas.`);
  const problemes: string[] = [];
  for (const p of PERMISSIONS_DG_REQUISES) if (!dg.permissions.includes(p)) problemes.push(`n'a pas ${p} (à cocher)`);
  const autres = roles.filter((r) => r.name !== ROLE_DG && r.permissions.includes(PERMISSION_DG_SEUL)).map((r) => r.name);
  if (autres.length > 0) problemes.push(`${PERMISSION_DG_SEUL} est aussi détenue par : ${autres.join(", ")} (le DG seul doit la détenir)`);
  return problemes.length === 0
    ? point("role-dg", `Rôle « ${ROLE_DG} »`, "OK", `Permissions conformes ; ${PERMISSION_DG_SEUL} détenue par le DG seul.`)
    : point("role-dg", `Rôle « ${ROLE_DG} »`, "A_CORRIGER", `${problemes.length} écart(s) dans /admin/roles.`, problemes);
}

// ---------- Comptes ----------

export interface CompteActif {
  nom: string;
  email: string;
  role: string;
  rolePermissions: readonly string[];
  serviceNom: string | null;
}

export function verifierMinimumComptes(id: string, titre: string, comptes: string[], minimum: number): Point {
  return comptes.length >= minimum
    ? point(id, titre, "OK", `${comptes.length} compte(s) actif(s) (minimum ${minimum}).`, comptes)
    : point(id, titre, "A_CORRIGER", `${comptes.length} compte(s) actif(s), il en faut au moins ${minimum} (continuité de service).`, comptes);
}

export function assistantsFinanceActifs(comptes: readonly CompteActif[]): string[] {
  return comptes.filter((c) => c.role === ROLE_ASSISTANT_FINANCE).map((c) => `${c.nom} <${c.email}>`);
}

export function comptesRHCorrection(comptes: readonly CompteActif[]): string[] {
  return comptes.filter((c) => c.rolePermissions.includes(PERMISSION_RH)).map((c) => `${c.nom} <${c.email}>`);
}

export function verifierServicesDesComptes(comptes: readonly CompteActif[]): Point {
  const sans = comptes.filter((c) => !c.serviceNom).map((c) => `${c.nom} <${c.email}>`);
  return sans.length === 0
    ? point("comptes-service", "Service de chaque compte actif", "OK", `${comptes.length} compte(s) actif(s), tous rattachés à un service.`)
    : point("comptes-service", "Service de chaque compte actif", "A_CORRIGER", `${sans.length} compte(s) actif(s) sans service (/admin/users).`, sans);
}

export interface ServiceConfig {
  nom: string;
  responsableNom: string | null;
  responsableActif: boolean;
}

export function verifierResponsablesServices(services: readonly ServiceConfig[]): Point {
  const problemes = services
    .filter((s) => !s.responsableNom || !s.responsableActif)
    .map((s) => `${s.nom} : ${s.responsableNom ? `responsable ${s.responsableNom} désactivé` : "aucun responsable"}`);
  const manquants = SERVICES_ATTENDUS.filter((n) => !services.some((s) => s.nom === n));
  if (problemes.length > 0) {
    return point("services-responsables", "Responsable actif de chaque service", "A_CORRIGER", `${problemes.length} service(s) sans responsable actif (/admin/services).`, problemes);
  }
  if (manquants.length > 0) {
    return point("services-responsables", "Responsable actif de chaque service", "AVERTISSEMENT", `Tous les services existants ont un responsable actif, mais ${manquants.length} service(s) attendu(s) n'existent pas.`, manquants.map((m) => `absent : ${m}`));
  }
  return point("services-responsables", "Responsable actif de chaque service", "OK", `${services.length} service(s), chacun avec un responsable actif.`);
}

// ---------- Signatures ----------

export interface CompteSignataire {
  nom: string;
  email: string;
  rolePermissions: readonly string[];
  responsableDeServices: number;
  aSignature: boolean;
}

/** Un compte doit signer s'il est responsable d'un service ou porte une permission d'action signée (même règle que le bandeau « Créer ma signature »). */
export function doitSigner(c: Pick<CompteSignataire, "rolePermissions" | "responsableDeServices">): boolean {
  return c.responsableDeServices > 0 || PERMISSIONS_SIGNATAIRES.some((p) => c.rolePermissions.includes(p));
}

export function verifierSignatures(comptes: readonly CompteSignataire[]): Point {
  const aSigner = comptes.filter(doitSigner);
  const manquants = aSigner.filter((c) => !c.aSignature).map((c) => `${c.nom} <${c.email}>`);
  return manquants.length === 0
    ? point("signatures", "Signatures enrôlées", "OK", `${aSigner.length} compte(s) devant signer, tous ont une signature enrôlée.`)
    : point("signatures", "Signatures enrôlées", "A_CORRIGER", `${manquants.length} compte(s) sur ${aSigner.length} sans signature : ils ne pourront ni valider, ni régler, ni clôturer (/profil, section « Ma signature »).`, manquants);
}

// ---------- Budgets ----------

export interface ParametrageLu {
  id: string;
  portee: "GLOBAL" | "CATEGORIE";
  categorieId: string | null;
  categorieNom: string | null;
  statut: "EN_ATTENTE" | "VALIDE" | "REFUSE";
  repris: boolean;
  decideParId: string | null;
  /** Jour AAAA-MM-JJ. */
  dateDebut: string;
  dateFin: string | null;
  decideAt: string | null;
  seuilOrange: number | null;
  seuilRouge: number | null;
}

function enVigueur(p: ParametrageLu, jour: string): boolean {
  return p.statut === "VALIDE" && p.dateDebut <= jour && (p.dateFin === null || p.dateFin >= jour);
}

function plusRecent(a: ParametrageLu, b: ParametrageLu): ParametrageLu {
  if (a.dateDebut !== b.dateDebut) return a.dateDebut > b.dateDebut ? a : b;
  return (a.decideAt ?? "") >= (b.decideAt ?? "") ? a : b;
}

/** Le paramétrage en vigueur pour une portée (même règle que `budgetEnVigueur`, sur des données déjà lues). */
export function parametrageEnVigueur(liste: readonly ParametrageLu[], portee: "GLOBAL" | "CATEGORIE", categorieId: string | null, jour: string): ParametrageLu | null {
  let retenu: ParametrageLu | null = null;
  for (const p of liste) {
    if (p.portee !== portee || (portee === "CATEGORIE" && p.categorieId !== categorieId) || !enVigueur(p, jour)) continue;
    retenu = retenu ? plusRecent(retenu, p) : p;
  }
  return retenu;
}

/** « Validé par le DG » = une décision de DG est tracée ; un paramétrage repris par migration (sans décideur) reste à confirmer. */
export const valideParLeDG = (p: ParametrageLu): boolean => p.statut === "VALIDE" && !p.repris && p.decideParId !== null;

export function verifierSeuilsCaisse(liste: readonly ParametrageLu[], jour: string): Point {
  const titre = "Budget de caisse : seuils orange / rouge";
  const global = liste.filter((p) => p.portee === "GLOBAL");
  const vigueur = parametrageEnVigueur(global, "GLOBAL", null, jour);
  const attente = global.filter((p) => p.statut === "EN_ATTENTE");
  if (!vigueur) {
    return point("seuils-caisse", titre, "A_CORRIGER", attente.length > 0 ? "Aucun seuil de caisse en vigueur : un paramétrage attend la validation du DG (/treso/finance/budgets)." : "Aucun seuil de caisse en vigueur : la Finance doit les soumettre, le DG les valider (/treso/finance/budgets).");
  }
  const problemes: string[] = [];
  if (vigueur.seuilOrange === null || vigueur.seuilRouge === null) problemes.push("seuils orange/rouge incomplets");
  if (!valideParLeDG(vigueur)) problemes.push(vigueur.repris ? "seuil issu de la migration (valeur par défaut, 100 000 / 0 FCFA) : à soumettre par la Finance et valider par le DG" : "aucune décision de DG tracée");
  return problemes.length === 0
    ? point("seuils-caisse", titre, "OK", `En vigueur depuis le ${vigueur.dateDebut} : orange ${vigueur.seuilOrange} FCFA, rouge ${vigueur.seuilRouge} FCFA, validés par le DG.`)
    : point("seuils-caisse", titre, "A_CORRIGER", problemes.join(" ; ") + ".");
}

export function verifierBudgetsCategories(liste: readonly ParametrageLu[], jour: string): Point {
  const titre = "Budgets de catégorie";
  const cats = liste.filter((p) => p.portee === "CATEGORIE");
  if (cats.length === 0) return point("budgets-categories", titre, "AVERTISSEMENT", "Aucun budget de catégorie paramétré (aucune alerte budgétaire par catégorie).");
  const ids = [...new Set(cats.map((p) => p.categorieId))];
  const problemes: string[] = [];
  let vigueurCount = 0;
  for (const id of ids) {
    const nom = cats.find((p) => p.categorieId === id)?.categorieNom ?? String(id);
    const v = parametrageEnVigueur(cats, "CATEGORIE", id, jour);
    if (v) {
      vigueurCount++;
      if (!valideParLeDG(v)) problemes.push(`${nom} : budget en vigueur ${v.repris ? "repris par migration (seuil par défaut 20 % orange / 0 % rouge) — à confirmer par le DG" : "sans décision de DG tracée"}`);
    }
    if (cats.some((p) => p.categorieId === id && p.statut === "EN_ATTENTE")) problemes.push(`${nom} : un paramétrage attend la validation du DG`);
  }
  return problemes.length === 0
    ? point("budgets-categories", titre, "OK", `${vigueurCount} budget(s) de catégorie en vigueur, tous validés par le DG.`)
    : point("budgets-categories", titre, "A_CORRIGER", `${problemes.length} point(s) à faire confirmer par le DG (/treso/finance/budgets).`, problemes);
}

// ---------- Catégorisation obligatoire ----------

export function verifierDateCategorisation(date: string | null, jour: string): Point {
  const titre = "Date « catégorisation obligatoire »";
  if (!date) return point("date-categorisation", titre, "AVERTISSEMENT", "Non renseignée : la catégorisation ne sera jamais obligatoire pour valider (onglet « Catégories » de /treso/finance/budgets).");
  if (date <= jour) return point("date-categorisation", titre, "AVERTISSEMENT", `Fixée au ${date}, déjà atteinte : elle s'applique dès maintenant. La mise en service demande une date FUTURE (laisser le temps de catégoriser).`);
  return point("date-categorisation", titre, "OK", `Fixée au ${date} (dans le futur).`);
}

// ---------- Environnement ----------

/** Adresse locale ou privée : jamais une adresse publique. */
export function hoteLocalOuPrive(hote: string): boolean {
  const h = hote.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "::1") return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function verifierEnvironnement(env: Record<string, string | undefined>): Point[] {
  const points: Point[] = [];
  const url = env.AUTH_URL?.trim();
  if (!url) {
    points.push(point("env-auth-url", "Variable AUTH_URL", "A_CORRIGER", "Absente : les liens des e-mails et la redirection après connexion en dépendent."));
  } else {
    let parsee: URL | null = null;
    try {
      parsee = new URL(url);
    } catch {
      parsee = null;
    }
    if (!parsee) points.push(point("env-auth-url", "Variable AUTH_URL", "A_CORRIGER", "Valeur invalide (URL attendue, ex. https://portail.votre-domaine.ci)."));
    else if (parsee.protocol !== "https:") points.push(point("env-auth-url", "Variable AUTH_URL", "A_CORRIGER", `Doit être en https (protocole actuel : ${parsee.protocol.replace(":", "")}).`));
    else if (hoteLocalOuPrive(parsee.hostname)) points.push(point("env-auth-url", "Variable AUTH_URL", "A_CORRIGER", "Doit être l'adresse PUBLIQUE du portail (pas localhost ni une adresse privée)."));
    else points.push(point("env-auth-url", "Variable AUTH_URL", "OK", `Adresse publique en https (${parsee.hostname}).`));
  }
  const secret = (id: string, nom: string, minimum: number) => {
    const v = env[nom];
    if (!v || v.trim() === "") points.push(point(id, `Variable ${nom}`, "A_CORRIGER", "Absente."));
    else if (v.length < minimum) points.push(point(id, `Variable ${nom}`, "A_CORRIGER", `Trop courte (${minimum} caractères minimum).`));
    else points.push(point(id, `Variable ${nom}`, "OK", "Présente (valeur non affichée)."));
  };
  secret("env-auth-secret", "AUTH_SECRET", 32);
  secret("env-cron-secret", "CRON_SECRET", 16);
  const db = env.DATABASE_URL;
  points.push(db && db.trim() !== "" ? point("env-database-url", "Variable DATABASE_URL", "OK", "Présente (valeur non affichée).") : point("env-database-url", "Variable DATABASE_URL", "A_CORRIGER", "Absente."));
  return points;
}

// ---------- Comptes de test et délégations ----------

export interface CompteSimple {
  nom: string;
  email: string;
  isActive: boolean;
}

/**
 * Comptes de test du seed (`*@simassurances.test`). Pendant la préparation ils sont attendus (AVERTISSEMENT) ; en vérification
 * FINALE (`final: true`), un compte de test encore ACTIF bloque (À CORRIGER) : il faut le désactiver. Un compte désactivé est
 * seulement listé.
 */
export function verifierComptesDeTest(comptes: readonly CompteSimple[], final: boolean): Point {
  const titre = "Comptes de test (*" + DOMAINE_COMPTES_DE_TEST + ")";
  const test = comptes.filter((c) => c.email.toLowerCase().endsWith(DOMAINE_COMPTES_DE_TEST));
  const actifs = test.filter((c) => c.isActive);
  const lignes = test.map((c) => `${c.email} — ${c.nom} (${c.isActive ? "ACTIF" : "désactivé"})`);
  if (test.length === 0) return point("comptes-test", titre, "OK", "Aucun compte de test.");
  if (actifs.length === 0) return point("comptes-test", titre, "OK", `${test.length} compte(s) de test, tous désactivés.`, lignes);
  return point(
    "comptes-test",
    titre,
    final ? "A_CORRIGER" : "AVERTISSEMENT",
    `${actifs.length} compte(s) de test encore ACTIF(S) : à désactiver dans /admin/users après la purge (jamais supprimer).`,
    lignes
  );
}

export interface DelegationLue {
  donneur: string;
  beneficiaire: string;
  depuis: string;
}

export function listerDelegationsPointage(delegations: readonly DelegationLue[]): Point {
  const titre = `Délégations actives de ${PERMISSION_RH}`;
  return delegations.length === 0
    ? point("delegations-rh", titre, "OK", "Aucune délégation active.")
    : point("delegations-rh", titre, "INFO", `${delegations.length} délégation(s) active(s) : à contrôler à la main (/admin/delegations).`, delegations.map((d) => `${d.donneur} → ${d.beneficiaire} (depuis le ${d.depuis})`));
}

// ---------- Rapport ----------

const LIBELLE_VERDICT: Record<VerdictPoint, string> = { OK: "OK", A_CORRIGER: "À CORRIGER", AVERTISSEMENT: "AVERTISSEMENT", INFO: "À CONTRÔLER" };

export function formaterRapport(points: readonly Point[]): string {
  const lignes: string[] = [];
  for (const p of points) {
    lignes.push(`[${LIBELLE_VERDICT[p.verdict].padEnd(12)}] ${p.titre} — ${p.detail}`);
    for (const e of p.elements ?? []) lignes.push(`                 · ${e}`);
  }
  const n = (v: VerdictPoint) => points.filter((p) => p.verdict === v).length;
  lignes.push("");
  lignes.push(`Bilan : ${n("OK")} OK, ${n("A_CORRIGER")} À CORRIGER, ${n("AVERTISSEMENT")} avertissement(s), ${n("INFO")} à contrôler à la main.`);
  return lignes.join("\n");
}

/** 1 s'il y a au moins un « À CORRIGER », sinon 0. */
export function codeSortie(points: readonly Point[]): number {
  return points.some((p) => p.verdict === "A_CORRIGER") ? 1 : 0;
}
