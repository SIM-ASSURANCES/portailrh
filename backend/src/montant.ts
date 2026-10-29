// Saisie souple des montants (lot M, 2026-10-29) : UNE seule règle, partagée par l'écran (formatage pendant la frappe,
// écho « 1 500 000 FCFA »), les Server Actions (le serveur ne fait jamais confiance au client) et les tests.
// Module PUR, sans dépendance : sûr pour un Client Component (réexporté par `backend/client`).
//
// Entrées acceptées : 1500000 · 1 500 000 · 1.500.000 · 1.500.000,50 · 1 500 000,50 · 1500000,5 · 1500.5
// (séparateurs : point, espace, espace insécable ; virgule ou point décimal quand la devise a des décimales).
//
// RÈGLE (dans cet ordre) :
//   1. Seuls les chiffres, l'espace (ou insécable), le point et la virgule sont admis. Une lettre, un signe (« - », « + »),
//      une notation exponentielle sont refusés avec un message clair, jamais ignorés en silence.
//   2. Deux séparateurs de suite (« 1..500 », « 1, 500 »), un séparateur en tête ou en fin sont refusés.
//   3. Le DERNIER séparateur est décimal s'il est suivi de 1 ou 2 chiffres ET que la devise a des décimales ; sinon il
//      sépare des milliers (groupes de trois chiffres exactement, premier groupe de 1 à 3 chiffres).
//   4. FCFA / XOF / XAF (aucune décimale) : tout point ou espace sépare des milliers ; une virgule suivie de chiffres est
//      REFUSÉE (message dédié), même « ,00 ».
//   5. Devise à décimales : « 1.500 » = 1 500 (trois chiffres après le séparateur = milliers), « 1.5 » et « 1.50 » = 1,5.
//      Le point ne peut pas être à la fois séparateur de milliers et décimal (« 1.500.50 » refusé) ; une virgule suivie de
//      trois chiffres (« 1,500 ») est refusée comme ambiguë ; « 1,500.50 » (style anglo-saxon) est refusé.
//   6. Un zéro en tête suivi de groupes de milliers (« 0.500 ») est refusé comme ambigu.
// Cas ambigus tranchés, écrits dans les tests (`montant.test.ts`).

/** Devises sans décimale : tout montant est un entier. */
export const DEVISES_SANS_DECIMALES: readonly string[] = ["XOF", "XAF", "FCFA", "CFA"];
export const DEVISE_PAR_DEFAUT = "XOF";
/** Garde-fou : au-delà, le montant n'a plus de sens (et dépasserait le `Decimal(14,2)` de la base). */
export const MONTANT_CHIFFRES_ENTIERS_MAX = 12;

export interface OptionsMontant {
  /** Devise du montant (code ISO ou « FCFA ») ; détermine l'admission des décimales. Défaut : XOF. */
  devise?: string | null;
  /** Force l'admission des décimales (prioritaire sur la devise). */
  decimales?: boolean;
}

export type ResultatMontant =
  | {
      ok: true;
      /** Valeur numérique (jamais utilisée pour un calcul d'égalité : voir `centimes`). */
      valeur: number;
      /** Montant en centimes entiers, exact. */
      centimes: number;
      /** Forme canonique « 1500000.50 » (point décimal, aucun séparateur de milliers). */
      canonique: string;
      /** Partie entière (chiffres seuls) et décimales telles que saisies (sans zéros ajoutés). */
      entier: string;
      decimales: string;
    }
  | { ok: false; message: string };

export function deviseAvecDecimales(devise?: string | null): boolean {
  const code = (devise ?? DEVISE_PAR_DEFAUT).trim().toUpperCase();
  return !DEVISES_SANS_DECIMALES.includes(code);
}

function admetDecimales(options: OptionsMontant): boolean {
  return options.decimales ?? deviseAvecDecimales(options.devise);
}

export const MESSAGES_MONTANT = {
  vide: "Saisissez un montant.",
  caracteres: "Le montant ne doit contenir que des chiffres, des espaces, des points et une virgule (exemple : 1 500 000).",
  negatif: "Un montant ne peut pas être négatif.",
  separateurs: "Séparateurs mal placés : écrivez par exemple 1 500 000 ou 1.500.000 (un séparateur entre deux groupes de chiffres).",
  incomplet: "Montant incomplet : complétez les chiffres après le dernier séparateur.",
  milliers: "Séparateur de milliers mal placé : chaque groupe de milliers contient trois chiffres (exemple : 1 500 000).",
  sansDecimales:
    "Les décimales ne sont pas admises pour cette devise (FCFA) : saisissez un montant entier, avec des espaces ou des points pour les milliers (exemple : 1 500 000).",
  deuxDecimales: "Deux décimales au plus (exemple : 1 500,50).",
  virguleTroisChiffres:
    "Montant ambigu : une virgule suivie de trois chiffres. Pour les milliers utilisez un espace ou un point (1 500 ou 1.500) ; les décimales sont limitées à deux chiffres (1,50).",
  pointEtVirgule:
    "Séparateurs mélangés : utilisez le point ou l'espace pour les milliers et la virgule pour les décimales (exemple : 1.500.000,50).",
  zeroAmbigu: "Montant ambigu (zéro suivi d'un groupe de milliers) : écrivez 0,5 pour une valeur décimale, ou 500 pour cinq cents.",
  tropGrand: "Montant trop élevé.",
} as const;

type Jeton = { type: "chiffres"; v: string } | { type: "sep"; v: "." | "," | " " };

function groupementValide(groupes: readonly string[]): boolean {
  if (groupes.length <= 1) return true;
  if (groupes[0].length < 1 || groupes[0].length > 3) return false;
  return groupes.slice(1).every((g) => g.length === 3);
}

/** Analyse une saisie de montant. Ne lève jamais. */
export function analyserMontant(saisie: unknown, options: OptionsMontant = {}): ResultatMontant {
  const decimalesAdmises = admetDecimales(options);
  const KO = (message: string): ResultatMontant => ({ ok: false, message });

  if (typeof saisie === "number") return lireMontant(saisie, options);
  if (typeof saisie !== "string") return KO(MESSAGES_MONTANT.vide);

  const texte = saisie.replace(/[    ]/g, " ").trim();
  if (texte === "") return KO(MESSAGES_MONTANT.vide);
  if (/[-−–]/.test(texte)) return KO(MESSAGES_MONTANT.negatif);
  if (/[^0-9., ]/.test(texte)) return KO(MESSAGES_MONTANT.caracteres);

  // Jetons : groupes de chiffres et séparateurs.
  const jetons: Jeton[] = [];
  for (const m of texte.matchAll(/(\d+)|([., ])/g)) {
    if (m[1] !== undefined) jetons.push({ type: "chiffres", v: m[1] });
    else jetons.push({ type: "sep", v: m[2] as "." | "," | " " });
  }
  if (jetons[0].type === "sep") return KO(MESSAGES_MONTANT.separateurs);
  if (jetons[jetons.length - 1].type === "sep") return KO(MESSAGES_MONTANT.incomplet);
  for (let i = 1; i < jetons.length; i++) {
    if (jetons[i].type === "sep" && jetons[i - 1].type === "sep") return KO(MESSAGES_MONTANT.separateurs);
  }
  const groupes = jetons.filter((j) => j.type === "chiffres").map((j) => j.v);
  const seps = jetons.filter((j) => j.type === "sep").map((j) => j.v as "." | "," | " ");

  let partieEntiere: string[];
  let decimales = "";

  if (seps.length === 0) {
    partieEntiere = groupes;
  } else {
    const dernier = seps[seps.length - 1];
    const apres = groupes[groupes.length - 1];
    const autres = seps.slice(0, -1);

    if (dernier === ",") {
      if (!decimalesAdmises) return KO(MESSAGES_MONTANT.sansDecimales);
      if (apres.length > 3) return KO(MESSAGES_MONTANT.deuxDecimales);
      if (apres.length === 3) return KO(MESSAGES_MONTANT.virguleTroisChiffres);
      if (autres.includes(",")) return KO(MESSAGES_MONTANT.separateurs);
      partieEntiere = groupes.slice(0, -1);
      decimales = apres;
      if (!groupementValide(partieEntiere)) return KO(MESSAGES_MONTANT.milliers);
    } else if (dernier === "." && decimalesAdmises && apres.length <= 2) {
      // Point décimal : il ne peut pas être aussi séparateur de milliers, ni voisiner une virgule.
      if (autres.includes(".") || autres.includes(",")) {
        return KO(autres.includes(",") ? MESSAGES_MONTANT.pointEtVirgule : MESSAGES_MONTANT.separateurs);
      }
      partieEntiere = groupes.slice(0, -1);
      decimales = apres;
      if (!groupementValide(partieEntiere)) return KO(MESSAGES_MONTANT.milliers);
    } else {
      // Dernier séparateur = milliers (espace, ou point suivi de trois chiffres / devise sans décimale).
      if (seps.includes(",")) return KO(decimalesAdmises ? MESSAGES_MONTANT.pointEtVirgule : MESSAGES_MONTANT.sansDecimales);
      if (dernier === "." && decimalesAdmises && apres.length > 3) return KO(MESSAGES_MONTANT.deuxDecimales);
      partieEntiere = groupes;
      if (!groupementValide(partieEntiere)) return KO(MESSAGES_MONTANT.milliers);
      if (partieEntiere.length > 1 && /^0/.test(partieEntiere[0])) return KO(MESSAGES_MONTANT.zeroAmbigu);
    }
  }

  const entier = partieEntiere.join("").replace(/^0+(?=\d)/, "");
  if (entier.length > MONTANT_CHIFFRES_ENTIERS_MAX) return KO(MESSAGES_MONTANT.tropGrand);
  const canonique = decimales ? `${entier}.${decimales}` : entier;
  const centimes = Number(entier) * 100 + Number(decimales.padEnd(2, "0"));
  return { ok: true, valeur: Number(canonique), centimes, canonique, entier, decimales };
}

/** `valeur` en centimes entiers → nombre (deux décimales exactes). */
export function centimesVersValeur(centimes: number): number {
  return Math.round(centimes) / 100;
}

/** Groupes de trois chiffres séparés par une espace (« 1500000 » → « 1 500 000 »). */
export function grouperMilliers(entier: string, separateur = " "): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, separateur);
}

/** Affichage de saisie (espaces pour les milliers, virgule décimale) d'une saisie VALIDE ; sinon renvoie `texte`. */
export function formaterSaisieMontant(texte: string, options: OptionsMontant = {}): string {
  const r = analyserMontant(texte, options);
  if (!r.ok) return texte;
  return grouperMilliers(r.entier) + (r.decimales ? `,${r.decimales}` : "");
}

/**
 * Reformate la saisie pendant la frappe en gardant le curseur à la même place par rapport aux chiffres. Une saisie
 * incomplète ou invalide (« 1 500. », lettres, virgule en FCFA…) est laissée telle quelle : l'erreur est affichée par
 * l'écran, jamais corrigée en silence.
 */
export function reformaterSaisieMontant(
  texte: string,
  curseur: number,
  options: OptionsMontant = {}
): { texte: string; curseur: number } {
  let formate = formaterSaisieMontant(texte, options);
  // Frappe au fil de l'eau : « 1 500 » + « 0 » donne « 1 5000 » (groupes invalides) — des chiffres séparés par des espaces
  // seulement sont regroupés par trois, avec une virgule décimale de deux chiffres au plus quand la devise en admet.
  if (formate === texte) {
    const normalise = texte.replace(/[    ]/g, " ");
    const m = /^(\d[\d ]*?)(,\d{0,2})?$/.exec(normalise);
    if (m && (m[1].includes(" ") || m[1].length > 3) && (m[2] === undefined || admetDecimales(options))) {
      const chiffres = m[1].replace(/ /g, "");
      if (chiffres.length <= MONTANT_CHIFFRES_ENTIERS_MAX) formate = grouperMilliers(chiffres) + (m[2] ?? "");
    }
  }
  if (formate === texte) return { texte, curseur };
  const chiffresAvant = (texte.slice(0, Math.max(0, curseur)).match(/\d/g) ?? []).length;
  if (chiffresAvant === 0) return { texte: formate, curseur: 0 };
  let vus = 0;
  for (let i = 0; i < formate.length; i++) {
    if (/\d/.test(formate[i])) {
      vus++;
      if (vus === chiffresAvant) return { texte: formate, curseur: i + 1 };
    }
  }
  return { texte: formate, curseur: formate.length };
}

/** Libellé d'écho / de confirmation : « 1 500 000 FCFA », « 1 500,5 EUR ». */
export function libelleMontant(valeur: number, devise?: string | null): string {
  const code = (devise ?? DEVISE_PAR_DEFAUT).trim().toUpperCase();
  const unite = DEVISES_SANS_DECIMALES.includes(code) ? "FCFA" : code;
  const centimes = Math.round(valeur * 100);
  const entier = Math.floor(Math.abs(centimes) / 100);
  const dec = Math.abs(centimes) % 100;
  const signe = centimes < 0 ? "-" : "";
  return `${signe}${grouperMilliers(String(entier))}${dec ? `,${String(dec).padStart(2, "0").replace(/0$/, "")}` : ""} ${unite}`;
}

/**
 * Lecture serveur d'un montant reçu d'un formulaire ou d'un appel direct : texte brut (réanalysé) ou nombre (vérifié :
 * fini, deux décimales au plus, jamais négatif). Ne lève jamais.
 */
export function lireMontant(brut: unknown, options: OptionsMontant = {}): ResultatMontant {
  if (typeof brut === "number") {
    if (!Number.isFinite(brut)) return { ok: false, message: MESSAGES_MONTANT.caracteres };
    if (brut < 0) return { ok: false, message: MESSAGES_MONTANT.negatif };
    const centimes = Math.round(brut * 100);
    if (Math.abs(centimes / 100 - brut) > 1e-9) return { ok: false, message: MESSAGES_MONTANT.deuxDecimales };
    if (!admetDecimales(options) && centimes % 100 !== 0) return { ok: false, message: MESSAGES_MONTANT.sansDecimales };
    const entier = String(Math.floor(centimes / 100));
    if (entier.length > MONTANT_CHIFFRES_ENTIERS_MAX) return { ok: false, message: MESSAGES_MONTANT.tropGrand };
    const dec = String(centimes % 100).padStart(2, "0").replace(/0+$/, "");
    return { ok: true, valeur: centimes / 100, centimes, canonique: dec ? `${entier}.${dec}` : entier, entier, decimales: dec };
  }
  return analyserMontant(brut, options);
}

/** Valeur numérique d'une saisie pour un calcul d'affichage (total en direct) : 0 quand la saisie est vide ou invalide. */
export function valeurSaisieMontant(texte: string, options: OptionsMontant = {}): number {
  const r = analyserMontant(texte, options);
  return r.ok ? r.valeur : 0;
}

/** Texte de saisie pour une valeur déjà connue (préremplissage d'un champ) : « 1 500 000 », « 1 500,5 ». */
export function texteSaisieMontant(valeur: number | string | null | undefined, options: OptionsMontant = {}): string {
  if (valeur === null || valeur === undefined || valeur === "") return "";
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return "";
  const centimes = Math.round(n * 100);
  const entier = String(Math.floor(Math.abs(centimes) / 100));
  const dec = String(Math.abs(centimes) % 100).padStart(2, "0").replace(/0+$/, "");
  const decimalesAdmises = options.decimales ?? deviseAvecDecimales(options.devise);
  return `${centimes < 0 ? "-" : ""}${grouperMilliers(entier)}${dec && decimalesAdmises ? `,${dec}` : ""}`;
}

/**
 * Pour zod (`superRefine`/`transform`) : analyse un champ de formulaire ou un argument d'action et renvoie le nombre.
 * `ajouterIssue` reçoit le message de refus ; retourne `null` si refusé.
 */
export function montantPourSchema(
  brut: unknown,
  options: OptionsMontant,
  ajouterIssue: (message: string) => void
): number | null {
  const r = lireMontant(brut, options);
  if (!r.ok) {
    ajouterIssue(r.message);
    return null;
  }
  return r.valeur;
}
