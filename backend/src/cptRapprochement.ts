import { ajouterJoursCpt, joursEntreCpt } from "./cptEcheancier";

/**
 * Moteur de rapprochement des encaissements (lot GC-5a, docs/PLAN_GESTION_COMPTA.md §7.2 et conception §6.2). PUR : aucun accès base,
 * les montants sont des centimes entiers (bigint), les dates des textes AAAA-MM-JJ. Il ne RATTACHE JAMAIS rien (RG-02) : il calcule des
 * PROPOSITIONS classées par niveau de preuve ; confirmation du commercial puis validation du RFCRH se font ailleurs.
 *
 * Cinq méthodes, dans cet ordre — la première qui trouve au moins un contrat l'emporte pour un encaissement donné :
 *   1. référence exacte                      → PREUVE
 *   2. référence incomplète + même montant   → PREUVE (référence à corriger)
 *   3. montant (±1 FCFA) et date déclarée    → DEDUCTION  (jamais si un autre encaissement non résolu vise le même contrat)
 *   4. groupe d'un même partenaire           → DEDUCTION  (une seule combinaison possible, sinon aucune proposition)
 *   5. probable : même nom, ou montant ±2 %  → A_CONFIRMER
 *
 * Performance : les contrats sont INDEXÉS une seule fois (référence, préfixe de référence, date + montant, famille partenaire + date,
 * mots du nom, montant trié) ; chaque encaissement ne consulte que les entrées de l'index qui le concernent, jamais tous les contrats.
 */

export type MethodeRattachementCpt = "REFERENCE_EXACTE" | "REFERENCE_INCOMPLETE" | "MONTANT_DATE" | "GROUPE" | "PROBABLE" | "MANUELLE";
export type NiveauPreuveCpt = "PREUVE" | "DEDUCTION" | "A_CONFIRMER";
export type StatutRattachementCpt = "PROPOSE" | "CONFIRME" | "VALIDE" | "REJETE";

export const NIVEAU_PAR_METHODE_CPT: Record<MethodeRattachementCpt, NiveauPreuveCpt> = {
  REFERENCE_EXACTE: "PREUVE",
  REFERENCE_INCOMPLETE: "PREUVE",
  MONTANT_DATE: "DEDUCTION",
  GROUPE: "DEDUCTION",
  PROBABLE: "A_CONFIRMER",
  MANUELLE: "A_CONFIRMER",
};

export const LIBELLE_METHODE_RATTACHEMENT_CPT: Record<MethodeRattachementCpt, string> = {
  REFERENCE_EXACTE: "Référence exacte",
  REFERENCE_INCOMPLETE: "Référence incomplète",
  MONTANT_DATE: "Montant et date",
  GROUPE: "Groupe de contrats",
  PROBABLE: "Probable",
  MANUELLE: "Identification manuelle",
};

export const LIBELLE_NIVEAU_PREUVE_CPT: Record<NiveauPreuveCpt, string> = {
  PREUVE: "Preuve",
  DEDUCTION: "Déduction",
  A_CONFIRMER: "À confirmer",
};

/** Encaissement à rapprocher : `montant` = ce qui reste à rattacher. */
export interface EncaissementARapprocher {
  id: string;
  referenceReleve: string;
  dateValeur: string;
  montant: bigint;
  payeur: string | null;
}

/** Échéance encore ouverte d'un contrat, avec ce dont le moteur a besoin pour comparer. `reste` = montant dû − déjà rattaché (validé). */
export interface EcheanceCandidateCpt {
  echeanceId: string;
  contratId: string;
  numPolice: string;
  rang: number;
  clientNom: string;
  partenaireId: string | null;
  referenceDeclaree: string | null;
  datePaiementDeclaree: string | null;
  datePrevue: string;
  reste: bigint;
}

export interface ParametresRapprochementCpt {
  /** Tolérance de montant, en centimes (1 FCFA = 100). */
  toleranceMontant: bigint;
  /** Fenêtre autour de la date de paiement déclarée : encaissement entre `joursAvant` jours avant et `joursApres` jours après. */
  joursAvant: number;
  joursApres: number;
  /** Tolérance du niveau « probable », en points de base (200 = 2 %), sur ± `fenetreProbableJours` autour de la date prévue. */
  pointsDeBaseProbable: number;
  fenetreProbableJours: number;
  /** Nombre de caractères identiques exigés pour une référence incomplète. */
  longueurReferencePartielle: number;
  /** Au-delà, un groupe de contrats n'est pas exploré (explosion combinatoire) : aucune proposition de groupe. */
  tailleMaxGroupe: number;
  /** Nombre maximal de propositions « probable » par encaissement. */
  maxProbables: number;
}

/** Valeurs du cahier (Q16 ouverte : paramétrables ou figées — ici une valeur par défaut que l'appelant peut surcharger). */
export const PARAMETRES_RAPPROCHEMENT_DEFAUT_CPT: ParametresRapprochementCpt = {
  toleranceMontant: BigInt(100),
  joursAvant: 3,
  joursApres: 5,
  pointsDeBaseProbable: 200,
  fenetreProbableJours: 45,
  longueurReferencePartielle: 12,
  tailleMaxGroupe: 14,
  maxProbables: 5,
};

export interface PropositionRapprochementCpt {
  encaissementId: string;
  echeanceId: string;
  contratId: string;
  numPolice: string;
  montant: bigint;
  methode: MethodeRattachementCpt;
  niveauPreuve: NiveauPreuveCpt;
  justification: string;
  /** Les propositions d'un même groupe (méthode 4) se valident ensemble : elles portent le même identifiant. */
  groupe: string | null;
}

export interface ResultatRapprochementCpt {
  propositions: PropositionRapprochementCpt[];
  /** Encaissements pour lesquels aucune méthode n'a rien proposé (restent « à identifier »). */
  sansProposition: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------------------------------

/** Majuscules, uniquement lettres et chiffres (espaces, tirets, signes ignorés). */
export function normaliserReferenceRapprochementCpt(texte: string | null | undefined): string {
  return (texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function motsNom(texte: string | null | undefined): string[] {
  return (texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 2);
}

/** Même règle que `memeNomCpt`, sur des mots déjà extraits (évite de renormaliser les noms à chaque comparaison). */
function memeNomMots(ma: readonly string[], mb: readonly string[]): boolean {
  if (ma.length === 0 || mb.length === 0) return false;
  const [court, long] = ma.length <= mb.length ? [ma, mb] : [mb, ma];
  if (!court.some((m) => m.length >= 3)) return false;
  return court.every((m) => long.includes(m));
}

/** Même personne : tous les mots du plus court des deux noms se retrouvent dans l'autre (au moins un mot de 3 lettres). */
export function memeNomCpt(a: string | null | undefined, b: string | null | undefined): boolean {
  return memeNomMots(motsNom(a), motsNom(b));
}

const abs = (n: bigint) => (n < BigInt(0) ? -n : n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const CENT = BigInt(100);

/** Contrat avec ses échéances ouvertes (la plus ancienne d'abord) et ce qui a été calculé une fois pour toutes. */
interface ContratCandidat {
  contratId: string;
  numPolice: string;
  clientNom: string;
  partenaireId: string | null;
  referenceDeclaree: string | null;
  datePaiementDeclaree: string | null;
  echeances: EcheanceCandidateCpt[];
  /** Position dans l'ordre des numéros de police : les résultats sortent toujours dans cet ordre. */
  ordre: number;
  refNorm: string;
  mots: string[];
}

function grouperParContrat(candidates: readonly EcheanceCandidateCpt[]): ContratCandidat[] {
  const parContrat = new Map<string, ContratCandidat>();
  for (const e of candidates) {
    if (e.reste <= BigInt(0)) continue;
    let c = parContrat.get(e.contratId);
    if (!c) {
      c = {
        contratId: e.contratId,
        numPolice: e.numPolice,
        clientNom: e.clientNom,
        partenaireId: e.partenaireId,
        referenceDeclaree: e.referenceDeclaree,
        datePaiementDeclaree: e.datePaiementDeclaree,
        echeances: [],
        ordre: 0,
        refNorm: normaliserReferenceRapprochementCpt(e.referenceDeclaree),
        mots: motsNom(e.clientNom),
      };
      parContrat.set(e.contratId, c);
    }
    c.echeances.push(e);
  }
  const contrats = [...parContrat.values()];
  for (const c of contrats) c.echeances.sort((a, b) => a.rang - b.rang);
  contrats.sort((a, b) => a.numPolice.localeCompare(b.numPolice));
  contrats.forEach((c, i) => (c.ordre = i));
  return contrats;
}

// ---------------------------------------------------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------------------------------------------------

interface IndexCandidats {
  contrats: ContratCandidat[];
  parRef: Map<string, ContratCandidat[]>;
  parPrefixe: Map<string, ContratCandidat[]>;
  /** Clé « date déclarée|montant en FCFA entiers » pour CHAQUE échéance ouverte du contrat. */
  parDateEtMontant: Map<string, ContratCandidat[]>;
  /** date déclarée → partenaire → contrats (les familles de la méthode 4). */
  parDatePartenaire: Map<string, Map<string, ContratCandidat[]>>;
  /** Mot (3 lettres au moins) du nom du client → contrats. */
  parMot: Map<string, ContratCandidat[]>;
  /** Ensemble des mots du nom du client (triés, sans doublon, joints par un espace) → contrats : retrouve un client dont le nom tient dans celui du payeur. */
  parCleMots: Map<string, ContratCandidat[]>;
  /** Contrats triés par reste de leur échéance la plus ancienne (recherche à ±2 %). */
  parReste: { reste: bigint; contrat: ContratCandidat }[];
}

function ajouter<K, V>(m: Map<K, V[]>, cle: K, valeur: V) {
  const liste = m.get(cle);
  if (liste) liste.push(valeur);
  else m.set(cle, [valeur]);
}

function construireIndex(contrats: ContratCandidat[], p: ParametresRapprochementCpt): IndexCandidats {
  const index: IndexCandidats = {
    contrats,
    parRef: new Map(),
    parPrefixe: new Map(),
    parDateEtMontant: new Map(),
    parDatePartenaire: new Map(),
    parMot: new Map(),
    parCleMots: new Map(),
    parReste: [],
  };
  for (const c of contrats) {
    if (c.refNorm !== "") ajouter(index.parRef, c.refNorm, c);
    if (c.refNorm.length >= p.longueurReferencePartielle) ajouter(index.parPrefixe, c.refNorm.slice(0, p.longueurReferencePartielle), c);
    if (c.datePaiementDeclaree) {
      const cles = new Set(c.echeances.map((e) => `${c.datePaiementDeclaree}|${e.reste / CENT}`));
      for (const cle of cles) ajouter(index.parDateEtMontant, cle, c);
      if (c.partenaireId) {
        let parPartenaire = index.parDatePartenaire.get(c.datePaiementDeclaree);
        if (!parPartenaire) index.parDatePartenaire.set(c.datePaiementDeclaree, (parPartenaire = new Map()));
        ajouter(parPartenaire, c.partenaireId, c);
      }
    }
    const motsUniques = [...new Set(c.mots)];
    for (const mot of motsUniques) if (mot.length >= 3) ajouter(index.parMot, mot, c);
    if (motsUniques.some((m) => m.length >= 3)) ajouter(index.parCleMots, [...motsUniques].sort().join(" "), c);
    index.parReste.push({ reste: c.echeances[0].reste, contrat: c });
  }
  index.parReste.sort((a, b) => (a.reste < b.reste ? -1 : a.reste > b.reste ? 1 : a.contrat.ordre - b.contrat.ordre));
  return index;
}

/** Dates (AAAA-MM-JJ) auxquelles une date de paiement déclarée « va avec » cet encaissement (fenêtre −3 / +5 jours). */
function datesDeclareesPossibles(dateEncaissement: string, p: ParametresRapprochementCpt): string[] {
  const dates: string[] = [];
  for (let decalage = -p.joursApres; decalage <= p.joursAvant; decalage++) dates.push(ajouterJoursCpt(dateEncaissement, decalage));
  return dates;
}

function premierIndexReste(tri: { reste: bigint }[], borneBasse: bigint): number {
  let bas = 0;
  let haut = tri.length;
  while (bas < haut) {
    const milieu = (bas + haut) >> 1;
    if (tri[milieu].reste < borneBasse) bas = milieu + 1;
    else haut = milieu;
  }
  return bas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Propositions
// ---------------------------------------------------------------------------------------------------------------------

/** Répartit `montant` sur les échéances, la plus ancienne d'abord ; ce qui dépasse le contrat reste « à rattacher » (jamais inventé). */
export function repartirSurEcheancesCpt(montant: bigint, echeances: readonly EcheanceCandidateCpt[]): { echeanceId: string; montant: bigint }[] {
  const parts: { echeanceId: string; montant: bigint }[] = [];
  let restant = montant;
  for (const e of echeances) {
    if (restant <= BigInt(0)) break;
    const part = min(restant, e.reste);
    if (part > BigInt(0)) {
      parts.push({ echeanceId: e.echeanceId, montant: part });
      restant -= part;
    }
  }
  return parts;
}

function proposer(
  enc: EncaissementARapprocher,
  contrat: Pick<ContratCandidat, "contratId" | "numPolice" | "echeances">,
  methode: MethodeRattachementCpt,
  justification: string,
  montant: bigint,
  groupe: string | null,
): PropositionRapprochementCpt[] {
  return repartirSurEcheancesCpt(montant, contrat.echeances).map((part) => ({
    encaissementId: enc.id,
    echeanceId: part.echeanceId,
    contratId: contrat.contratId,
    numPolice: contrat.numPolice,
    montant: part.montant,
    methode,
    niveauPreuve: NIVEAU_PAR_METHODE_CPT[methode],
    justification,
    groupe,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Les cinq méthodes
// ---------------------------------------------------------------------------------------------------------------------

function methodeReferenceExacte(enc: EncaissementARapprocher, index: IndexCandidats): PropositionRapprochementCpt[] {
  const ref = normaliserReferenceRapprochementCpt(enc.referenceReleve);
  if (ref === "") return [];
  return (index.parRef.get(ref) ?? []).flatMap((c) =>
    proposer(enc, c, "REFERENCE_EXACTE", `La référence ${enc.referenceReleve} est celle déclarée pour la police ${c.numPolice}.`, enc.montant, null),
  );
}

function methodeReferenceIncomplete(enc: EncaissementARapprocher, index: IndexCandidats, p: ParametresRapprochementCpt): PropositionRapprochementCpt[] {
  const ref = normaliserReferenceRapprochementCpt(enc.referenceReleve);
  if (ref.length < p.longueurReferencePartielle) return [];
  return (index.parPrefixe.get(ref.slice(0, p.longueurReferencePartielle)) ?? [])
    .filter((c) => c.refNorm !== ref && abs(c.echeances[0].reste - enc.montant) <= p.toleranceMontant)
    .flatMap((c) =>
      proposer(
        enc,
        c,
        "REFERENCE_INCOMPLETE",
        `Les ${p.longueurReferencePartielle} premiers caractères de la référence sont ceux de la police ${c.numPolice} et le montant est le même : référence à corriger.`,
        enc.montant,
        null,
      ),
    );
}

/** Contrats que la méthode 3 retiendrait pour cet encaissement (avant le contrôle « un seul encaissement par contrat »). */
function candidatsMontantDate(enc: EncaissementARapprocher, index: IndexCandidats, p: ParametresRapprochementCpt): ContratCandidat[] {
  const base = enc.montant / CENT;
  const vus = new Set<ContratCandidat>();
  for (const date of datesDeclareesPossibles(enc.dateValeur, p)) {
    for (let decalage = BigInt(-1); decalage <= BigInt(1); decalage++) {
      for (const c of index.parDateEtMontant.get(`${date}|${base + decalage}`) ?? []) {
        if (c.echeances.some((e) => abs(e.reste - enc.montant) <= p.toleranceMontant)) vus.add(c);
      }
    }
  }
  return [...vus].sort((a, b) => a.ordre - b.ordre);
}

function methodeMontantDate(
  enc: EncaissementARapprocher,
  index: IndexCandidats,
  p: ParametresRapprochementCpt,
  nbEncaissementsParContrat: Map<string, number>,
): PropositionRapprochementCpt[] {
  const retenus = candidatsMontantDate(enc, index, p).filter((c) => (nbEncaissementsParContrat.get(c.contratId) ?? 0) === 1);
  const alternatives = retenus.length > 1 ? ` (${retenus.length} contrats possibles : à départager)` : "";
  return retenus.flatMap((c) => {
    const e = c.echeances.find((x) => abs(x.reste - enc.montant) <= p.toleranceMontant)!;
    return proposer(
      enc,
      { contratId: c.contratId, numPolice: c.numPolice, echeances: [e] },
      "MONTANT_DATE",
      `Montant identique à l'échéance ${e.rang} de la police ${c.numPolice}, reçu dans la fenêtre de la date de paiement déclarée${alternatives}.`,
      min(enc.montant, e.reste),
      null,
    );
  });
}

function methodeGroupe(enc: EncaissementARapprocher, index: IndexCandidats, p: ParametresRapprochementCpt): PropositionRapprochementCpt[] {
  // Contrats d'un même partenaire, déclarés payés le même jour, dans la fenêtre de l'encaissement.
  const trouvees: { famille: ContratCandidat[]; masque: number }[] = [];
  for (const date of datesDeclareesPossibles(enc.dateValeur, p)) {
    for (const famille of index.parDatePartenaire.get(date)?.values() ?? []) {
      if (famille.length < 2 || famille.length > p.tailleMaxGroupe) continue;
      const dus = famille.map((c) => c.echeances[0].reste);
      if (dus.reduce((s, x) => s + x, BigInt(0)) + p.toleranceMontant < enc.montant) continue; // même tout le groupe ne suffirait pas
      for (let masque = 1; masque < 1 << famille.length; masque++) {
        if ((masque & (masque - 1)) === 0) continue; // un seul contrat : c'est la méthode 3
        let somme = BigInt(0);
        for (let i = 0; i < famille.length; i++) if (masque & (1 << i)) somme += dus[i];
        if (abs(somme - enc.montant) <= p.toleranceMontant) trouvees.push({ famille, masque });
      }
    }
  }
  // Plusieurs combinaisons possibles : rien n'est proposé (se tromper ferait payer le mauvais contrat).
  if (trouvees.length !== 1) return [];
  const { famille, masque } = trouvees[0];
  const groupe = `G-${enc.id}`;
  const membres = famille.filter((_, i) => masque & (1 << i));
  return membres.flatMap((c) =>
    proposer(
      enc,
      { contratId: c.contratId, numPolice: c.numPolice, echeances: [c.echeances[0]] },
      "GROUPE",
      `La somme des échéances de ${membres.length} contrats du même partenaire, déclarés payés le même jour, est égale au montant encaissé.`,
      c.echeances[0].reste,
      groupe,
    ),
  );
}

function methodeProbable(enc: EncaissementARapprocher, index: IndexCandidats, p: ParametresRapprochementCpt): PropositionRapprochementCpt[] {
  const BASE = BigInt(10000);
  const pb = BigInt(p.pointsDeBaseProbable);
  // Candidats « même nom » — deux cas exhaustifs de `memeNomMots` : (a) les mots du payeur tiennent dans le nom du client : le client figure
  // dans la liste de CHAQUE mot du payeur, donc dans celle du plus rare ; (b) le nom du client tient dans celui du payeur : son ensemble de
  // mots est un sous-ensemble de ceux du payeur (au plus 2^8 sous-ensembles essayés). Puis ceux dont le montant est à ±2 %.
  const candidats = new Set<ContratCandidat>();
  const motsPayeur = motsNom(enc.payeur);
  const motsUniques = [...new Set(motsPayeur)];
  const motsLongs = motsUniques.filter((m) => m.length >= 3);
  if (motsLongs.length > 0) {
    let rare = index.parMot.get(motsLongs[0]) ?? [];
    for (const mot of motsLongs) {
      const liste = index.parMot.get(mot) ?? [];
      if (liste.length < rare.length) rare = liste;
    }
    for (const c of rare) candidats.add(c);
    const base = motsUniques.slice(0, 8);
    for (let masque = 1; masque < 1 << base.length; masque++) {
      const sous = base.filter((_, i) => masque & (1 << i));
      if (!sous.some((m) => m.length >= 3)) continue;
      for (const c of index.parCleMots.get(sous.sort().join(" ")) ?? []) candidats.add(c);
    }
  }
  if (enc.montant > BigInt(0)) {
    // |reste − m| × 10 000 ≤ reste × pb  ⇔  m × 10 000 / (10 000 + pb) ≤ reste ≤ m × 10 000 / (10 000 − pb)
    const bas = (enc.montant * BASE) / (BASE + pb);
    const haut = (enc.montant * BASE) / (BASE - pb) + BigInt(1);
    for (let i = premierIndexReste(index.parReste, bas); i < index.parReste.length && index.parReste[i].reste <= haut; i++) candidats.add(index.parReste[i].contrat);
  }

  const notes: { contrat: ContratCandidat; echeance: EcheanceCandidateCpt; score: number; raison: string }[] = [];
  for (const c of candidats) {
    const echeance = c.echeances[0];
    const dansLeMontant = echeance.reste > BigInt(0) && abs(echeance.reste - enc.montant) * BASE <= echeance.reste * pb;
    if (memeNomMots(motsPayeur, c.mots)) {
      notes.push({ contrat: c, echeance, score: dansLeMontant ? 0 : 1, raison: `Le payeur « ${enc.payeur} » porte le même nom que le client de la police ${c.numPolice}.` });
    } else if (dansLeMontant) {
      const ecartJours = Math.abs(joursEntreCpt(echeance.datePrevue, enc.dateValeur));
      if (ecartJours <= p.fenetreProbableJours) {
        notes.push({
          contrat: c,
          echeance,
          score: 2,
          raison: `Montant à ±${p.pointsDeBaseProbable / 100} % de l'échéance ${echeance.rang} de la police ${c.numPolice}, à ${ecartJours} jour(s) de la date prévue.`,
        });
      }
    }
  }
  notes.sort((a, b) => a.score - b.score || Number(abs(a.echeance.reste - enc.montant) - abs(b.echeance.reste - enc.montant)) || a.contrat.ordre - b.contrat.ordre);
  return notes
    .slice(0, p.maxProbables)
    .flatMap((n) => proposer(enc, { contratId: n.contrat.contratId, numPolice: n.contrat.numPolice, echeances: [n.echeance] }, "PROBABLE", n.raison, min(enc.montant, n.echeance.reste), null));
}

// ---------------------------------------------------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Propositions pour un lot d'encaissements. `candidates` = échéances ouvertes (reste > 0) des contrats pouvant correspondre. L'ordre des
 * méthodes est celui du cahier ; la première méthode qui propose quelque chose arrête la recherche pour cet encaissement.
 */
export function proposerRattachementsCpt(
  encaissements: readonly EncaissementARapprocher[],
  candidates: readonly EcheanceCandidateCpt[],
  parametres: ParametresRapprochementCpt = PARAMETRES_RAPPROCHEMENT_DEFAUT_CPT,
): ResultatRapprochementCpt {
  const p = parametres;
  const index = construireIndex(grouperParContrat(candidates), p);

  // Les méthodes 1 et 2 (la référence) tranchent d'abord : un encaissement déjà résolu par sa référence ne « concurrence » pas un autre.
  const parReference = new Map<string, PropositionRapprochementCpt[]>();
  for (const enc of encaissements) {
    if (enc.montant <= BigInt(0)) continue;
    const parRef = methodeReferenceExacte(enc, index);
    parReference.set(enc.id, parRef.length > 0 ? parRef : methodeReferenceIncomplete(enc, index, p));
  }

  // « Un encaissement pour un contrat » (méthode 3) : on compte, par contrat, combien d'encaissements ENCORE NON RÉSOLUS le visent.
  const nbEncaissementsParContrat = new Map<string, number>();
  for (const enc of encaissements) {
    if (enc.montant <= BigInt(0) || (parReference.get(enc.id) ?? []).length > 0) continue;
    for (const c of candidatsMontantDate(enc, index, p)) nbEncaissementsParContrat.set(c.contratId, (nbEncaissementsParContrat.get(c.contratId) ?? 0) + 1);
  }

  const propositions: PropositionRapprochementCpt[] = [];
  const sansProposition: string[] = [];
  for (const enc of encaissements) {
    if (enc.montant <= BigInt(0)) continue;
    const trouvees =
      (parReference.get(enc.id) ?? []).length > 0
        ? (parReference.get(enc.id) ?? [])
        : ([methodeMontantDate(enc, index, p, nbEncaissementsParContrat), methodeGroupe(enc, index, p), methodeProbable(enc, index, p)].find((liste) => liste.length > 0) ?? []);
    if (trouvees.length === 0) sansProposition.push(enc.id);
    propositions.push(...trouvees);
  }
  return { propositions, sansProposition };
}

/**
 * Aide au rattachement sans référence (T13) : contrats dont une échéance en cours est égale au montant (à la tolérance près), classés
 * « même nom » d'abord. N'écrit rien : c'est une liste de suggestions pour l'identification manuelle.
 */
export function aideRattachementCpt(
  montant: bigint,
  payeur: string | null,
  candidates: readonly EcheanceCandidateCpt[],
  parametres: ParametresRapprochementCpt = PARAMETRES_RAPPROCHEMENT_DEFAUT_CPT,
): { echeanceId: string; contratId: string; numPolice: string; clientNom: string; reste: bigint; memeNom: boolean }[] {
  return candidates
    .filter((e) => e.reste > BigInt(0) && abs(e.reste - montant) <= parametres.toleranceMontant)
    .map((e) => ({ echeanceId: e.echeanceId, contratId: e.contratId, numPolice: e.numPolice, clientNom: e.clientNom, reste: e.reste, memeNom: memeNomCpt(payeur, e.clientNom) }))
    .sort((a, b) => Number(b.memeNom) - Number(a.memeNom) || a.numPolice.localeCompare(b.numPolice));
}

// ---------------------------------------------------------------------------------------------------------------------
// Cycle de vie d'un rattachement (deux étapes, conception §6.2)
// ---------------------------------------------------------------------------------------------------------------------

export type ActionRattachementCpt = "CONFIRMER" | "VALIDER" | "REJETER";

export interface EtatRattachementCpt {
  statut: StatutRattachementCpt;
  niveauPreuve: NiveauPreuveCpt;
  /** Reçu joint par le commercial à la confirmation (pièce ou référence du reçu). */
  recuConfirmation: string | null;
}

export type TransitionRattachementCpt = { ok: true; vers: StatutRattachementCpt } | { ok: false; raison: string };

/** L'étape 1 (confirmation du commercial) est requise dès que le niveau n'est pas une preuve. */
export function etape1RequiseCpt(niveau: NiveauPreuveCpt): boolean {
  return niveau !== "PREUVE";
}

export const MOTIF_REJET_MIN_CPT = 3;
export const MESSAGE_RECU_OBLIGATOIRE_CPT = "Le reçu est obligatoire pour confirmer un rattachement.";
export const MESSAGE_ETAPE1_REQUISE_CPT = "La confirmation du commercial, avec le reçu, est requise avant la validation.";

/** Règle unique des transitions : le serveur la rejoue à chaque action, l'écran lit la même raison pour griser un bouton. */
export function transitionRattachementCpt(etat: EtatRattachementCpt, action: ActionRattachementCpt, motif?: string | null): TransitionRattachementCpt {
  if (etat.statut === "VALIDE") return { ok: false, raison: "Ce rattachement est déjà validé." };
  if (etat.statut === "REJETE") return { ok: false, raison: "Ce rattachement a été rejeté : le commercial doit en proposer un nouveau." };
  switch (action) {
    case "CONFIRMER":
      if (!etape1RequiseCpt(etat.niveauPreuve)) return { ok: false, raison: "Un rattachement de niveau « Preuve » n'a pas d'étape de confirmation." };
      if (etat.statut !== "PROPOSE") return { ok: false, raison: "Ce rattachement est déjà confirmé." };
      return { ok: true, vers: "CONFIRME" };
    case "VALIDER":
      if (etape1RequiseCpt(etat.niveauPreuve) && (etat.statut !== "CONFIRME" || !(etat.recuConfirmation ?? "").trim())) {
        return { ok: false, raison: MESSAGE_ETAPE1_REQUISE_CPT };
      }
      return { ok: true, vers: "VALIDE" };
    case "REJETER":
      if ((motif ?? "").trim().length < MOTIF_REJET_MIN_CPT) return { ok: false, raison: `Le motif du rejet est obligatoire (${MOTIF_REJET_MIN_CPT} caractères au moins).` };
      return { ok: true, vers: "REJETE" };
  }
}

/** Le reçu est exigé AVANT la transition : à appeler par l'action de confirmation. */
export function controlerConfirmationCpt(recu: string | null | undefined): string | null {
  return (recu ?? "").trim() ? null : MESSAGE_RECU_OBLIGATOIRE_CPT;
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles de somme à la validation (RG-04) et statut de l'encaissement
// ---------------------------------------------------------------------------------------------------------------------

export interface ContexteValidationCpt {
  montantRattachement: bigint;
  /** Montant de l'encaissement et somme déjà VALIDÉE sur lui. */
  montantEncaissement: bigint;
  dejaValideSurEncaissement: bigint;
  /** Montant dû de l'échéance et somme déjà VALIDÉE sur elle. */
  montantDuEcheance: bigint;
  dejaValideSurEcheance: bigint;
}

/** `null` si la validation tient dans les deux plafonds ; sinon la phrase du refus. Rejoué sous verrou par le serveur. */
export function refusSommesValidationCpt(c: ContexteValidationCpt): string | null {
  if (c.montantRattachement <= BigInt(0)) return "Le montant du rattachement doit être positif.";
  if (c.dejaValideSurEncaissement + c.montantRattachement > c.montantEncaissement) return "Le total rattaché dépasserait le montant de l'encaissement.";
  if (c.dejaValideSurEcheance + c.montantRattachement > c.montantDuEcheance) return "Le total rattaché dépasserait le montant dû de l'échéance.";
  return null;
}

export type StatutEncaissementCalcule = "A_RATTACHER" | "SOLDE";

/** Reste à rattacher = montant − Σ validés − « pas une prime » ; l'encaissement est soldé quand il ne reste rien. */
export function resteARattacherCpt(montant: bigint, valide: bigint, pasUnePrime: bigint): { reste: bigint; statut: StatutEncaissementCalcule } {
  const reste = montant - valide - pasUnePrime;
  return { reste, statut: reste === BigInt(0) ? "SOLDE" : "A_RATTACHER" };
}
