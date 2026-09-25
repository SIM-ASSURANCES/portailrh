import type { Prisma, StatutDemande } from "./generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Statuts d'une Demande dont le montant est ENTIÈREMENT validé (montantValide
 * === montant demandé), quel que soit l'avancement du règlement — c'est
 * l'ensemble qui, avant la Phase B (validation partielle), tenait entièrement
 * dans l'unique statut `VALIDEE`.
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : **n'est plus
 * utilisé pour l'éligibilité au règlement ni au retour de caisse** — voir
 * `peutEffectuerReglement` ci-dessous, qui autorise aussi une demande
 * seulement `PARTIELLEMENT_VALIDEE` (cahier des charges section 4). Reste
 * utilisé pour l'éligibilité à la CLÔTURE (`cloturerDemandeAction`, Ticket
 * 7) et la colonne "Validé" du reporting (Ticket 10), hors périmètre de la
 * Phase C.
 */
export const STATUTS_VALIDATION_COMPLETE: readonly StatutDemande[] = [
  "VALIDEE",
  "VALIDEE_NON_REGLEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
];

/**
 * Filtre partagé "demande en attente d'une décision de validation" —
 * `EN_ATTENTE_VALIDATION` (rien validé) OU `PARTIELLEMENT_VALIDEE` (un
 * reliquat non validé subsiste). Factorisé ici pour que le compteur du
 * dashboard et la liste sur laquelle on atterrit en cliquant dessus
 * désignent toujours exactement le même ensemble de lignes — même principe
 * que `RETOUR_EN_ATTENTE_WHERE` (`dashboardFinance.ts`).
 *
 * **Corrige un bug réel constaté en production** : `PARTIELLEMENT_VALIDEE`
 * seule ne suffit plus à qualifier une demande comme "en attente" depuis
 * l'introduction de `rejeterReliquatAction` (voir "Rejet du reliquat non
 * validé") — cette action laisse volontairement `statut` inchangé
 * (`PARTIELLEMENT_VALIDEE`, la part déjà validée reste acquise) et ne fait
 * que poser `reliquatRejete: true`. Une demande dans cet état n'a plus
 * AUCUNE action de validation possible dessus (`validerComplementaireAction`
 * la refuse explicitement), donc elle ne doit plus jamais compter comme "en
 * attente de validation" — d'où l'exclusion `reliquatRejete: false`
 * ci-dessous. Sans effet sur `EN_ATTENTE_VALIDATION` : `reliquatRejete` ne
 * peut être mis à `true` que depuis `PARTIELLEMENT_VALIDEE` (garde de
 * `rejeterReliquatAction`), donc une demande encore `EN_ATTENTE_VALIDATION`
 * a toujours `reliquatRejete = false` par construction.
 *
 * **Deuxième bug réel du même type, trouvé et corrigé (Tâche "Diagnostic
 * DEM-2026-000009 bloquée")** : pour une demande AVEC lignes, `PARTIELLEMENT_VALIDEE`
 * (ou même `EN_ATTENTE_VALIDATION`, si TOUTES les lignes ont été rejetées —
 * voir le piège déjà documenté dans "Validation ligne par ligne") ne
 * signifie plus jamais "il reste une décision à prendre" une fois que
 * `validerLignesAction` a déjà décidé TOUTES les lignes en un seul geste
 * (jamais de reliquat par ligne, jamais de dévalidation) : le caractère
 * partiel (une ligne validée, une autre rejetée) est alors définitif,
 * exactement comme un reliquat explicitement rejeté ci-dessus. Sans cette
 * distinction, une demande dont les lignes sont TOUTES décidées restait
 * indéfiniment coincée dans "Demandes en attente de validation" — reproduit
 * en pratique sur DEM-2026-000009 (2 lignes, l'une `VALIDEE`, l'autre
 * `REJETEE`, `statut: PARTIELLEMENT_VALIDEE`) : présente dans la liste,
 * mais aucune action de validation (ni de clôture, voir
 * `STATUTS_VALIDATION_COMPLETE` ci-dessus) n'était plus jamais possible
 * dessus. Exclusion ajoutée : une demande AVEC lignes ne compte comme "en
 * attente" que si AU MOINS une ligne est encore `EN_ATTENTE` (une demande
 * sans ligne n'est pas concernée par cette clause, `lignes.none: {}`).
 */
export const DEMANDES_EN_ATTENTE_VALIDATION_WHERE = {
  reliquatRejete: false,
  OR: [
    { lignes: { none: {} }, statut: { in: ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"] } },
    {
      statut: { in: ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"] },
      lignes: { some: { statutValidation: "EN_ATTENTE" } },
    },
  ],
} satisfies Prisma.DemandeWhereInput;

/**
 * Une demande AVEC lignes dont `statutValidation` de CHAQUE ligne n'est
 * plus `EN_ATTENTE` — équivalent, pour le modèle "validation ligne par
 * ligne", de `STATUTS_VALIDATION_COMPLETE` pour l'ancien modèle par
 * montant global : `validerLignesAction` décide toutes les lignes en un
 * seul geste, donc une fois cette fonction vraie, plus AUCUNE décision de
 * validation n'est jamais plus possible sur cette demande, quel que soit
 * son `statut` (`PARTIELLEMENT_VALIDEE` y compris, voir le bug ci-dessus).
 * `false` pour une demande sans ligne (pas concernée par ce modèle).
 */
export function lignesToutesDecidees(lignes: { statutValidation: string }[]): boolean {
  return lignes.length > 0 && lignes.every((l) => l.statutValidation !== "EN_ATTENTE");
}

/**
 * Répartition du montant demandé d'une demande AVEC lignes entre "encore en
 * attente d'une décision" et "rejeté" — corrige le bug d'affichage où
 * `max(0, montant - montantValide)` (formule héritée de l'ANCIEN modèle par
 * montant global, valable uniquement pour une demande SANS ligne) comptait à
 * tort une ligne déjà `REJETEE` comme "restant à valider" (voir CLAUDE.md,
 * bug identique à celui déjà corrigé sur `DEMANDES_EN_ATTENTE_VALIDATION_WHERE`
 * pour DEM-2026-000009 — même cause racine : une fonction pensée pour
 * l'ancien modèle appliquée telle quelle à une demande à lignes).
 *
 * `montantEnAttente` ne somme QUE les lignes `EN_ATTENTE` — vaut donc
 * exactement 0 dès que `lignesToutesDecidees()` est vraie, jamais un residu
 * dérivé de `montant - montantValide`. `montantRejete` somme les lignes
 * `REJETEE`, pour ne pas perdre cette information une fois retirée du
 * "restant à valider".
 */
export function getMontantsLignesParStatut(
  lignes: { statutValidation: string; quantite: number; prixUnitaire: Prisma.Decimal | number }[]
): { montantEnAttente: number; montantRejete: number } {
  return lignes.reduce(
    (acc, l) => {
      const total = l.quantite * Number(l.prixUnitaire);
      if (l.statutValidation === "EN_ATTENTE") acc.montantEnAttente += total;
      else if (l.statutValidation === "REJETEE") acc.montantRejete += total;
      return acc;
    },
    { montantEnAttente: 0, montantRejete: 0 }
  );
}

/**
 * Somme des règlements confirmés et non annulés d'une demande — c'est le
 * montant qui compte réellement comme "déjà réglé" (règle impérative : un
 * règlement en brouillon ou annulé ne compte jamais).
 */
export async function getTotalRegle(demandeId: string): Promise<number> {
  const result = await prisma.reglement.aggregate({
    where: { demandeId, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Reste à régler d'une demande : `montantValide` moins le total déjà réglé
 * (confirmé, non annulé). Jamais négatif — protection défensive, l'invariant
 * "somme réglée <= montantValide" étant normalement garanti à la
 * confirmation de chaque règlement (voir `confirmerReglementAction`).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : la base de
 * calcul est `montantValide`, **PAS** le montant demandé — cahier des
 * charges section 4 : "Montant validé : 250 000 FCFA. Premier règlement :
 * 200 000 FCFA. Solde validé restant à régler : 50 000 FCFA." Une demande
 * `PARTIELLEMENT_VALIDEE` (250 000 validés sur 400 000 demandés) est donc
 * réglable immédiatement sur la base des 250 000 déjà validés, sans
 * attendre la validation complémentaire du reliquat. Si `montantValide` est
 * encore `null` (aucune validation), retourne 0 : rien n'est réglable.
 *
 * `montantValideConnu`/`totalRegleConnu` (optionnels) évitent de refaire un
 * `findUnique`/un `aggregate` déjà exécutés par l'appelant juste avant (ex:
 * `confirmerReglementAction`, qui a de toute façon besoin de la demande et
 * du total réglé pour ses propres vérifications) — jamais un changement de
 * comportement, uniquement l'évitement d'une requête redondante. Omis :
 * comportement strictement inchangé (auto-fetch), tous les appelants
 * existants (dont `reporting.ts`) ne sont donc pas affectés.
 */
export async function getResteARegler(
  demandeId: string,
  montantValideConnu?: Prisma.Decimal | number | null,
  totalRegleConnu?: number
): Promise<number> {
  let montantValide = montantValideConnu;
  if (montantValide === undefined) {
    const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
    montantValide = demande?.montantValide ?? null;
  }
  if (montantValide == null) {
    return 0;
  }
  const totalRegle = totalRegleConnu ?? (await getTotalRegle(demandeId));
  return Math.max(0, Number(montantValide) - totalRegle);
}

/**
 * Éligibilité d'une demande au règlement (Phase C) : `montantValide > 0`
 * ET `getResteARegler(demandeId) > 0`, plus deux verrous terminaux
 * explicites (`REJETEE`/`CLOTUREE`) que le seul calcul sur les montants ne
 * suffit pas à couvrir — une demande clôturée avec un écart non résolu
 * (clôture partielle, Ticket 7) peut avoir un reste > 0 sans qu'aucune
 * action de règlement ne doive redevenir possible dessus.
 *
 * Remplace `STATUTS_VALIDATION_COMPLETE` pour cette logique précise : cet
 * ensemble figé (VALIDEE/VALIDEE_NON_REGLEE/PARTIELLEMENT_REGLEE/REGLEE)
 * excluait à tort `PARTIELLEMENT_VALIDEE`, alors que le cahier des charges
 * (section 4) autorise explicitement le règlement d'une demande seulement
 * partiellement validée. `STATUTS_VALIDATION_COMPLETE` reste néanmoins
 * utilisée ailleurs (ex: éligibilité à la clôture, Ticket 7 — hors
 * périmètre de cette phase).
 *
 * `demandeConnue`/`totalRegleConnu` (optionnels) : même principe que sur
 * `getResteARegler` ci-dessus — évitent de refaire un `findUnique`/un
 * `aggregate` que l'appelant a déjà exécutés. Omis : comportement
 * strictement inchangé (auto-fetch).
 */
export async function peutEffectuerReglement(
  demandeId: string,
  demandeConnue?: { statut: StatutDemande; montantValide: Prisma.Decimal | number | null },
  totalRegleConnu?: number
): Promise<boolean> {
  const demande = demandeConnue ?? (await prisma.demande.findUnique({ where: { id: demandeId } }));
  if (!demande) {
    return false;
  }
  if (demande.statut === "CLOTUREE" || demande.statut === "REJETEE") {
    return false;
  }
  if (demande.montantValide == null || Number(demande.montantValide) <= 0) {
    return false;
  }
  return (await getResteARegler(demandeId, demande.montantValide, totalRegleConnu)) > 0;
}

/**
 * Solde de caisse global du portail : jamais saisi manuellement, toujours
 * recalculé à partir du grand livre immuable `JournalCaisse`
 * (entrées - sorties). N'alimente encore aucun écran dans ce ticket —
 * préparée pour le dashboard Finance d'un prochain ticket.
 */
export async function getSoldeCaisse(): Promise<number> {
  const [entrees, sorties] = await Promise.all([
    prisma.journalCaisse.aggregate({ where: { type: "ENTREE" }, _sum: { montant: true } }),
    prisma.journalCaisse.aggregate({ where: { type: "SORTIE" }, _sum: { montant: true } }),
  ]);
  return Number(entrees._sum.montant ?? 0) - Number(sorties._sum.montant ?? 0);
}

/**
 * Sources `JournalCaisse` du cycle "solde d'ouverture" (voir CLAUDE.md
 * "Solde d'ouverture de caisse") — seul cas de mouvement de caisse sans
 * demande d'origine (`demandeId: null`). Trois sources distinctes, jamais
 * une édition silencieuse d'une écriture existante :
 * - `SOLDE_OUVERTURE_SOURCE` — la définition initiale (une seule fois).
 * - `SOLDE_OUVERTURE_CORRECTION_SOURCE` — la nouvelle valeur d'une
 *   correction (même principe qu'un règlement/retour : jamais réécrit).
 * - `SOLDE_OUVERTURE_ANNULATION_SOURCE` — l'écriture compensatoire qui
 *   neutralise le montant précédent au moment d'une correction (même
 *   mécanisme que `annulation_reglement_caisse`, Ticket 4).
 */
export const SOLDE_OUVERTURE_SOURCE = "solde_ouverture";
export const SOLDE_OUVERTURE_CORRECTION_SOURCE = "correction_solde_ouverture";
export const SOLDE_OUVERTURE_ANNULATION_SOURCE = "annulation_solde_ouverture";

export interface SoldeOuvertureInfo {
  /** `false` si aucune écriture `solde_ouverture` n'a jamais été créée. */
  existe: boolean;
  /** Montant net actuellement en vigueur (0 si jamais défini). */
  montantActuel: number;
  /** Date de la toute première définition (jamais mise à jour par une correction ultérieure). */
  definiLe: Date | null;
}

/**
 * État du solde d'ouverture : jamais un champ dédié, toujours dérivé des
 * mêmes écritures `JournalCaisse` que `getSoldeCaisse()` (cohérent avec la
 * règle impérative "le solde de caisse n'est jamais saisi manuellement,
 * toujours recalculé").
 */
export async function getSoldeOuvertureInfo(): Promise<SoldeOuvertureInfo> {
  const entries = await prisma.journalCaisse.findMany({
    where: {
      source: {
        in: [SOLDE_OUVERTURE_SOURCE, SOLDE_OUVERTURE_CORRECTION_SOURCE, SOLDE_OUVERTURE_ANNULATION_SOURCE],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return { existe: false, montantActuel: 0, definiLe: null };
  }

  const montantActuel = entries.reduce(
    (somme, e) => somme + (e.type === "ENTREE" ? Number(e.montant) : -Number(e.montant)),
    0
  );

  return { existe: true, montantActuel, definiLe: entries[0].createdAt };
}

export interface SoldeOuvertureHistoriqueEntry {
  id: string;
  type: "definition" | "correction";
  /** `null` pour la définition initiale. */
  ancienMontant: number | null;
  nouveauMontant: number;
  auteurNom: string;
  createdAt: Date;
  /** Toujours renseignée depuis "Pièce jointe obligatoire sur le solde
   * d'ouverture" (voir CLAUDE.md) — `null` uniquement pour une entrée
   * antérieure à ce changement (aucune en pratique sur cette base, mais le
   * type reste honnête plutôt que de mentir sur une garantie qui n'a pas
   * toujours existé). */
  pieceJointe: { id: string; url: string } | null;
}

/**
 * Historique complet du cycle "solde d'ouverture" — une ligne par ACTION
 * utilisateur (définition ou correction), jamais une ligne par écriture
 * `JournalCaisse` brute : reconstruit "ancien → nouveau montant" en
 * appariant chaque écriture `SOLDE_OUVERTURE_ANNULATION_SOURCE` (jamais
 * affichée seule, purement une compensation technique) avec la
 * `SOLDE_OUVERTURE_CORRECTION_SOURCE` qui la suit immédiatement dans la
 * même transaction — l'`annulation` neutralise toujours exactement le
 * montant en vigueur avant la correction, c'est donc littéralement
 * "l'ancien montant" recherché. Trié du plus ancien au plus récent (ordre
 * chronologique naturel pour un historique lu de haut en bas).
 */
export async function getSoldeOuvertureHistorique(): Promise<SoldeOuvertureHistoriqueEntry[]> {
  const entries = await prisma.journalCaisse.findMany({
    where: {
      source: {
        in: [SOLDE_OUVERTURE_SOURCE, SOLDE_OUVERTURE_CORRECTION_SOURCE, SOLDE_OUVERTURE_ANNULATION_SOURCE],
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { fullName: true } },
      pieceJointe: { select: { id: true, url: true } },
    },
  });

  const historique: SoldeOuvertureHistoriqueEntry[] = [];
  let dernierMontantAnnule: number | null = null;

  for (const e of entries) {
    if (e.source === SOLDE_OUVERTURE_SOURCE) {
      historique.push({
        id: e.id,
        type: "definition",
        ancienMontant: null,
        nouveauMontant: Number(e.montant),
        auteurNom: e.user.fullName,
        createdAt: e.createdAt,
        pieceJointe: e.pieceJointe,
      });
    } else if (e.source === SOLDE_OUVERTURE_ANNULATION_SOURCE) {
      dernierMontantAnnule = Number(e.montant);
    } else if (e.source === SOLDE_OUVERTURE_CORRECTION_SOURCE) {
      historique.push({
        id: e.id,
        type: "correction",
        ancienMontant: dernierMontantAnnule,
        nouveauMontant: Number(e.montant),
        auteurNom: e.user.fullName,
        createdAt: e.createdAt,
        pieceJointe: e.pieceJointe,
      });
      dernierMontantAnnule = null;
    }
  }

  return historique;
}

/**
 * Source `JournalCaisse` d'une alimentation de caisse (Tâche "Nouvelle
 * alimentation de caisse") — apport d'argent physique en caisse en cours
 * d'exploitation, distinct du solde d'ouverture (unique, au tout début) :
 * peut se répéter autant de fois que nécessaire, jamais plafonné à une
 * seule occurrence. Même rigueur de traçabilité (pièce jointe obligatoire,
 * historique dédié) mais un cycle indépendant, jamais mélangé aux trois
 * sources `SOLDE_OUVERTURE_*` ci-dessus.
 */
export const ALIMENTATION_CAISSE_SOURCE = "alimentation_caisse";

export interface AlimentationCaisseEntry {
  id: string;
  montant: number;
  /** Date réelle de l'alimentation (`JournalCaisse.dateOperation`),
   * potentiellement différente de `enregistreLe` (date de saisie). */
  dateOperation: Date;
  enregistreLe: Date;
  auteurNom: string;
  pieceJointe: { id: string; url: string };
}

/**
 * Historique des alimentations de caisse, la plus récente en premier —
 * inverse de `getSoldeOuvertureHistorique` (chronologique croissant) : une
 * alimentation est un évènement répétable dont seules les toutes
 * dernières occurrences intéressent Finance au quotidien, contrairement au
 * solde d'ouverture (un seul évènement fondateur, plus naturel à lire du
 * début vers la fin).
 */
export async function getAlimentationsCaisseHistorique(): Promise<AlimentationCaisseEntry[]> {
  const entries = await prisma.journalCaisse.findMany({
    where: { source: ALIMENTATION_CAISSE_SOURCE },
    orderBy: { dateOperation: "desc" },
    include: {
      user: { select: { fullName: true } },
      pieceJointe: { select: { id: true, url: true } },
    },
  });

  return entries.map((e) => ({
    id: e.id,
    montant: Number(e.montant),
    dateOperation: e.dateOperation!,
    enregistreLe: e.createdAt,
    auteurNom: e.user.fullName,
    // Toujours renseignée : `alimenterCaisseAction` la rend obligatoire à
    // la création, jamais d'entrée existante sans elle.
    pieceJointe: e.pieceJointe!,
  }));
}

/**
 * Somme des `DepenseLigne` de TOUS les `RetourCaisse` liés aux règlements
 * d'une demande — peu importe qu'ils soient déjà réceptionnés ou non : c'est
 * ce que le collaborateur affirme avoir dépensé, indépendamment du
 * traitement de Finance. Ticket 7 (régularisation/clôture).
 *
 * REFONTE V1 / Phase D (voir CLAUDE.md "Refonte V1 en cours") : un
 * `RetourCaisse` n'a plus de `montantDepense` agrégé unique — remplacé par
 * ses lignes de dépenses détaillées (`DepenseLigne`), sommées ici via la
 * relation imbriquée `retourCaisse.reglement.demandeId`.
 */
export async function getDepensesDeclarees(demandeId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisse: { reglement: { demandeId } } },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Répartition justifiées/non justifiées de `getDepensesDeclarees` — même
 * périmètre exact (toutes les `DepenseLigne` de tous les `RetourCaisse`
 * liés à cette demande), juste éclatée par `justification`. La somme des
 * deux vaut toujours `getDepensesDeclarees(demandeId)` (deux `aggregate`
 * sur un where identique à un `justification` près, jamais un second
 * calcul divergent) — voir CLAUDE.md "Détail des dépenses sur l'écran de
 * Régularisation".
 */
export async function getDepensesDeclareesParJustification(
  demandeId: string
): Promise<{ justifiees: number; nonJustifiees: number }> {
  const [nonJustifiees, total] = await Promise.all([
    prisma.depenseLigne.aggregate({
      where: { retourCaisse: { reglement: { demandeId } }, justification: "SANS_PIECE" },
      _sum: { montant: true },
    }),
    prisma.depenseLigne.aggregate({
      where: { retourCaisse: { reglement: { demandeId } } },
      _sum: { montant: true },
    }),
  ]);
  const montantNonJustifiees = Number(nonJustifiees._sum.montant ?? 0);
  const montantTotal = Number(total._sum.montant ?? 0);
  return { justifiees: montantTotal - montantNonJustifiees, nonJustifiees: montantNonJustifiees };
}

/**
 * Détail ligne par ligne de toutes les `DepenseLigne` déclarées pour une
 * demande (tous ses `RetourCaisse`, réceptionnés ou non) — pour l'accès
 * direct depuis la carte "Régularisation" (voir CLAUDE.md ci-dessus).
 * `retourEstReceptionne` permet à l'appelant de savoir si
 * `marquerDepenseNonJustifieeAction` reste appelable sur cette ligne (elle
 * se verrouille elle-même dès réception, revérifié côté serveur de toute
 * façon — ce champ n'est qu'un signal d'affichage, jamais la seule garde).
 */
export async function getDepenseLignesDetail(demandeId: string) {
  const lignes = await prisma.depenseLigne.findMany({
    where: { retourCaisse: { reglement: { demandeId } } },
    include: {
      pieceJointe: { select: { id: true } },
      motifNonJustifiePar: { select: { fullName: true } },
      retourCaisse: { select: { id: true, estReceptionne: true } },
    },
    orderBy: { date: "asc" },
  });
  return lignes.map((l) => ({
    id: l.id,
    montant: Number(l.montant),
    objet: l.objet,
    date: l.date,
    justification: l.justification,
    commentaire: l.commentaire,
    pieceJointeId: l.pieceJointe?.id ?? null,
    motifNonJustifie: l.motifNonJustifie,
    motifNonJustifiePar: l.motifNonJustifiePar?.fullName ?? null,
    retourEstReceptionne: l.retourCaisse.estReceptionne,
    retourCaisseId: l.retourCaisse.id,
  }));
}

/**
 * Somme des montants de TOUTES les `DepenseLigne` d'un `RetourCaisse`
 * précis — c'est le total qui sert à calculer `montantARetourner`
 * (`getMontantARetourner` ci-dessous). Phase D (fonds remis, cahier des
 * charges sections 8-9).
 */
export async function getTotalDepensesDeclarees(retourCaisseId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisseId },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Somme des montants des `DepenseLigne` d'un `RetourCaisse` dont la
 * justification est `SANS_PIECE` — la part de la dépense déclarée qui
 * n'est appuyée par aucun justificatif formel, mise en évidence à
 * l'affichage (Tâche 5).
 */
export async function getMontantNonJustifie(retourCaisseId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisseId, justification: "SANS_PIECE" },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Montant à retourner d'un `RetourCaisse` : montant du règlement lié moins
 * le total de ses `DepenseLigne` déclarées, jamais négatif. **Toujours
 * calculé, jamais saisi manuellement** — voir le commentaire de
 * `RetourCaisse.montantARetourner` dans `schema.prisma` et CLAUDE.md
 * "Refonte V1 en cours" / Phase D pour la justification de ce choix
 * (tension cahier des charges section 9.3 vs 9.5, tranchée en faveur du
 * calcul automatique, cohérent avec `getSoldeCaisse`).
 */
export async function getMontantARetourner(retourCaisseId: string): Promise<number> {
  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourCaisseId },
    include: { reglement: true },
  });
  if (!retour) {
    return 0;
  }
  const totalDepenses = await getTotalDepensesDeclarees(retourCaisseId);
  return Math.max(0, Number(retour.reglement.montant) - totalDepenses);
}

/**
 * Date du règlement CONFIRMÉ et non annulé le plus récent d'une demande
 * (tout mode confondu — Caisse ou Banque, le décaissement lui-même est ce
 * qui compte, pas le mode) — `null` si aucun règlement n'est encore
 * confirmé. Sert de date plancher pour la date d'un retour de caisse (voir
 * CLAUDE.md "Libellés et validations sur le formulaire de retour") : un
 * retour ne peut logiquement pas être antérieur à l'argent qu'il est censé
 * justifier.
 */
export async function getDateDernierReglementConfirme(demandeId: string): Promise<Date | null> {
  const reglement = await prisma.reglement.findFirst({
    where: { demandeId, estConfirme: true, estAnnule: false },
    orderBy: { confirmeAt: "desc" },
    select: { confirmeAt: true },
  });
  return reglement?.confirmeAt ?? null;
}

/**
 * Calcule le `montantARetourner` d'un retour de caisse en tenant compte des
 * AUTRES retours déjà existants sur le même règlement (Tâche "Retours
 * multiples autorisés sur une même demande", voir CLAUDE.md) — généralise
 * l'ancienne formule à un seul retour (`max(0, montant du règlement -
 * dépenses déclarées)`), qui reste le résultat exact quand aucun autre
 * retour n'existe encore sur ce règlement (comportement strictement
 * inchangé pour le cas courant).
 *
 * Principe : le "restant" disponible pour un NOUVEAU retour est le montant
 * du règlement moins tout ce que les AUTRES retours ont déjà consommé —
 * leurs dépenses déclarées (comptées qu'ils soient déjà réceptionnés ou
 * non, puisqu'une dépense déclarée reste une dépense déclarée) PLUS le
 * montant déjà effectivement RENDU par ceux d'entre eux réceptionnés
 * (jamais un retour encore en attente : cet argent n'a pas encore
 * matériellement bougé, il reste donc disponible pour ce nouveau retour).
 * `excludeRetourId` exclut le retour en cours de MODIFICATION de ce calcul
 * (`modifierRetourCaisseAction`) — sinon il compterait ses propres anciennes
 * lignes comme "un autre retour".
 */
export async function calculerMontantARetournerNet({
  reglementId,
  totalDepensesNouvelles,
  excludeRetourId,
}: {
  reglementId: string;
  totalDepensesNouvelles: number;
  excludeRetourId?: string;
}): Promise<number> {
  const reglement = await prisma.reglement.findUnique({
    where: { id: reglementId },
    select: { montant: true },
  });
  if (!reglement) {
    return 0;
  }

  const autresRetours = await prisma.retourCaisse.findMany({
    where: { reglementId, ...(excludeRetourId ? { id: { not: excludeRetourId } } : {}) },
    select: { estReceptionne: true, montantARetourner: true, depenses: { select: { montant: true } } },
  });

  let depensesAutres = 0;
  let retoursRecusAutres = 0;
  for (const r of autresRetours) {
    depensesAutres += r.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
    if (r.estReceptionne) {
      retoursRecusAutres += Number(r.montantARetourner);
    }
  }

  const restant = Math.max(0, Number(reglement.montant) - depensesAutres - retoursRecusAutres);
  return Math.max(0, restant - totalDepensesNouvelles);
}

/**
 * Solde à régulariser d'un règlement précis : montant du règlement moins
 * les dépenses déclarées (toutes les `DepenseLigne` de TOUS les
 * `RetourCaisse` liés à ce règlement) moins les retours effectivement
 * reçus (`montantARetourner` des retours `estReceptionne: true` liés à ce
 * règlement). **Doit valoir 0 une fois que tout est correctement justifié
 * et/ou retourné** — un solde non nul signale un écart (dépense non
 * couverte par une ligne déclarée, ou retour déclaré mais pas encore
 * réceptionné). Phase D (fonds remis, cahier des charges sections 8-9) —
 * équivalent de `getEcart` (Ticket 7) mais à l'échelle d'un règlement
 * précis plutôt que d'une demande entière (une demande peut avoir
 * plusieurs règlements Caisse, chacun avec son propre cycle fonds remis).
 */
export async function getSoldeARegulariser(reglementId: string): Promise<number> {
  const soldes = await getSoldesARegulariserParReglements([reglementId]);
  return soldes.get(reglementId) ?? 0;
}

/**
 * Variante en masse de `getSoldeARegulariser`, pour plusieurs règlements à
 * la fois SANS requête par règlement (Phase G, dashboard Finance — indicateurs
 * "Fonds remis à régulariser" et "Dépenses non justifiées à suivre") : une
 * seule requête `DepenseLigne`/`RetourCaisse` pour l'ensemble des règlements
 * demandés, réduite en mémoire (volume modeste, même convention que le
 * reste du reporting/dashboard). `getSoldeARegulariser` ci-dessus n'est
 * plus qu'un appel à celle-ci avec un seul id — jamais deux implémentations
 * de la même formule.
 */
export async function getSoldesARegulariserParReglements(
  reglementIds: string[]
): Promise<Map<string, number>> {
  if (reglementIds.length === 0) {
    return new Map();
  }

  const reglements = await prisma.reglement.findMany({
    where: { id: { in: reglementIds } },
    select: { id: true, montant: true },
  });

  const retours = await prisma.retourCaisse.findMany({
    where: { reglementId: { in: reglementIds } },
    select: {
      reglementId: true,
      estReceptionne: true,
      montantARetourner: true,
      depenses: { select: { montant: true } },
    },
  });

  const soldes = new Map<string, number>();
  for (const r of reglements) {
    soldes.set(r.id, Number(r.montant));
  }
  const rembourses = await prisma.remboursementRetour.findMany({
    where: { statut: "VALIDE", retourCaisse: { reglementId: { in: reglementIds } } },
    select: { montant: true, retourCaisse: { select: { reglementId: true } } },
  });
  for (const rb of rembourses) {
    const id = rb.retourCaisse.reglementId;
    soldes.set(id, (soldes.get(id) ?? 0) + Number(rb.montant));
  }
  for (const retour of retours) {
    const depensesDeclarees = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
    const retourRecu = retour.estReceptionne ? Number(retour.montantARetourner) : 0;
    const courant = soldes.get(retour.reglementId) ?? 0;
    soldes.set(retour.reglementId, courant - depensesDeclarees - retourRecu);
  }
  return soldes;
}

/**
 * Somme des `montantARetourner` des `RetourCaisse` d'une demande,
 * UNIQUEMENT ceux réceptionnés (`estReceptionne: true`) — l'argent
 * réellement revenu en caisse, par opposition à un retour simplement
 * déclaré mais pas encore traité par Finance.
 */
export async function getRetoursRecus(demandeId: string): Promise<number> {
  const [result, exceptionnels, rembourses] = await Promise.all([
    prisma.retourCaisse.aggregate({
      where: { reglement: { demandeId }, estReceptionne: true },
      _sum: { montantARetourner: true },
    }),
    // Retours exceptionnels post-clôture VALIDÉS uniquement (voir CLAUDE.md
    // "Retour de caisse exceptionnel post-clôture") : en attente ou rejetés,
    // ils ne comptent jamais — comme pour le solde de caisse.
    prisma.retourExceptionnel.aggregate({
      where: { demandeId, statut: "VALIDE" },
      _sum: { montant: true },
    }),
    // Remboursements VALIDÉS (sortie de caisse vers un collaborateur qui avait trop rendu,
    // voir CLAUDE.md "Correction d'un retour signalé") : viennent en déduction des retours reçus.
    prisma.remboursementRetour.aggregate({
      where: { statut: "VALIDE", retourCaisse: { reglement: { demandeId } } },
      _sum: { montant: true },
    }),
  ]);
  return (
    Number(result._sum.montantARetourner ?? 0) +
    Number(exceptionnels._sum.montant ?? 0) -
    Number(rembourses._sum.montant ?? 0)
  );
}

/**
 * Écart de régularisation d'une demande : montant décaissé (règlements
 * confirmés) moins ce qui est déjà justifié (dépenses déclarées + retours
 * réceptionnés). Un écart de 0 signifie que tout l'argent décaissé est
 * justifié. Un écart positif n'est pas nécessairement un blocage : c'est
 * une information affichée à Finance au moment de la clôture (la clôture
 * partielle sert justement à traiter ce cas, avec un motif obligatoire).
 */
export async function getEcart(demandeId: string): Promise<number> {
  const [totalRegle, depensesDeclarees, retoursRecus] = await Promise.all([
    getTotalRegle(demandeId),
    getDepensesDeclarees(demandeId),
    getRetoursRecus(demandeId),
  ]);
  return totalRegle - depensesDeclarees - retoursRecus;
}

/**
 * Consommation réelle du budget PARTAGÉ d'une Catégorie (voir CLAUDE.md
 * "Budget partagé par Catégorie" / "Catégorisation par ligne") — **UNIQUE
 * source de vérité**, réutilisée telle quelle par le contrôle bloquant de
 * `confirmerReglementAction`, l'aperçu de budget (Finance), le dashboard
 * (`getTopCategoriesBudget`) et le reporting (`getReportingSuiviBudgetaire`) :
 * aucun de ces appelants n'a de logique de calcul parallèle.
 *
 * Depuis "Catégorisation par ligne" (allocation budgétaire EXPLICITE, pas
 * un apportionnement calculé) : somme des
 * `ReglementCategorieAllocation.montant` de cette catégorie dont le
 * `Reglement` est confirmé et non annulé. Une demande à plusieurs lignes
 * catégorisées différemment n'impacte donc JAMAIS cette catégorie pour la
 * totalité de ses règlements — seule la part que Finance a explicitement
 * allouée à cette catégorie, à chaque règlement, compte ici (voir
 * `confirmerReglementAction`, qui crée ces allocations). Décomptée au
 * RÈGLEMENT (pas à la validation), toujours : c'est le moment où l'argent
 * sort réellement (règle impérative du module).
 */
export async function getMontantConsommeCategorie(categorieId: string): Promise<number> {
  const result = await prisma.reglementCategorieAllocation.aggregate({
    where: { categorieId, reglement: { estConfirme: true, estAnnule: false } },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Budget restant d'une Catégorie : `null` si `budgetAlloue` est `null`
 * (aucune limite définie, aucun contrôle appliqué) ; sinon `budgetAlloue -
 * getMontantConsommeCategorie(categorieId)`. **Retourne la valeur BRUTE,
 * jamais plafonnée à 0** — un résultat négatif signale un dépassement réel
 * (utile à `confirmerReglementAction` et au reporting "Suivi budgétaire"
 * pour le détecter) ; c'est à l'affichage de choisir, au cas par cas, de
 * clamper avec `Math.max(0, ...)` ou de montrer le dépassement tel quel.
 */
export async function getBudgetRestantCategorie(categorieId: string): Promise<number | null> {
  const categorie = await prisma.categorie.findUnique({
    where: { id: categorieId },
    select: { budgetAlloue: true },
  });
  if (!categorie || categorie.budgetAlloue == null) {
    return null;
  }
  const consomme = await getMontantConsommeCategorie(categorieId);
  return Number(categorie.budgetAlloue) - consomme;
}

export interface CategorieConcerneeInfo {
  categorieId: string;
  categorieLabel: string;
  budgetAlloue: number | null;
  consomme: number;
  restant: number | null;
}

/**
 * Catégories DISTINCTES concernées par une demande — voir CLAUDE.md
 * "Catégorisation par ligne" / "Allocation budgétaire explicite par
 * règlement" : détermine, pour une demande donnée, la liste des
 * catégories entre lesquelles un règlement doit être réparti.
 *
 * - `DEPENSE_DIRECTE` (0 ligne) : la catégorie unique de la demande
 *   elle-même (`Demande.categorieId`), ou liste vide si pas encore
 *   catégorisée.
 * - `STANDARD` (≥ 1 ligne) : les catégories distinctes des lignes
 *   `VALIDEE` UNIQUEMENT (une ligne encore `EN_ATTENTE` ou `REJETEE` ne
 *   représente aucun montant à régler, donc aucune catégorie "concernée"
 *   par le règlement) — une ligne `VALIDEE` sans catégorie n'ajoute rien
 *   à cette liste (aucune limite ne s'applique à une portion non
 *   catégorisée, même principe que l'ancien contrôle "aucune limite si
 *   pas de `categorieId`").
 *
 * Utilisée à la fois par `reglementActions.ts` (déterminer si le
 * règlement est en cas simple/mono-catégorie ou en cas
 * multi-catégorie) et par l'UI (`ReglementsSection`/`ReglementForm`) pour
 * construire les champs de répartition avec leur aperçu de budget —
 * réutilise `getMontantConsommeCategorie` (jamais un second calcul).
 */
export async function getCategoriesConcerneesDemande(demandeId: string): Promise<CategorieConcerneeInfo[]> {
  const demande = await prisma.demande.findUnique({
    where: { id: demandeId },
    include: {
      categorie: true,
      lignes: {
        where: { statutValidation: "VALIDEE", categorieId: { not: null } },
        include: { categorie: true },
      },
    },
  });
  if (!demande) return [];

  const categoriesBrutes =
    demande.typeDemande === "DEPENSE_DIRECTE"
      ? demande.categorie
        ? [demande.categorie]
        : []
      : Array.from(
          new Map(demande.lignes.filter((l) => l.categorie).map((l) => [l.categorie!.id, l.categorie!])).values()
        );

  return Promise.all(
    categoriesBrutes.map(async (categorie) => {
      const budgetAlloue = categorie.budgetAlloue == null ? null : Number(categorie.budgetAlloue);
      const consomme = await getMontantConsommeCategorie(categorie.id);
      return {
        categorieId: categorie.id,
        categorieLabel: categorie.label,
        budgetAlloue,
        consomme,
        restant: budgetAlloue == null ? null : budgetAlloue - consomme,
      };
    })
  );
}

export interface MesIndicateurs {
  /** Somme des montants de TOUTES les demandes créées par cet utilisateur, quel que soit leur statut. */
  demande: number;
  /** Somme de `Demande.montantValide` (0/null compte pour 0) sur ces mêmes demandes. */
  valide: number;
  /** `max(0, demande - valide)`. */
  restantAValider: number;
  /** Somme des règlements confirmés et non annulés (Caisse + Banque) de ces demandes. */
  regle: number;
  /** `max(0, valide - regle)`. */
  valideRestantARegler: number;
}

/**
 * Synthèse personnelle d'un Collaborateur pour "Mon tableau de bord"
 * (cahier des charges section 14) — les 5 mêmes indicateurs que la vision
 * synthétique générale, scopés à un seul utilisateur au lieu de toute
 * l'organisation. Formules strictement identiques à `getReportingRows`
 * (Phase H, `src/lib/reporting.ts`), juste agrégées en un seul total plutôt
 * que groupées par Catégorie/Objet — jamais une deuxième définition de ces
 * mêmes calculs.
 *
 * **Scope choisi : `createurId`, jamais `beneficiaireUserId`.** Deux
 * raisons : (1) c'est déjà le filtre de "Mes demandes"
 * (`treso/demandes/page.tsx`, Ticket 1) — un tableau de bord personnel qui
 * compterait différemment de la liste juste en dessous serait incohérent
 * pour l'utilisateur ; (2) `beneficiaireUserId` n'est renseigné que pour un
 * bénéficiaire `COLLABORATEUR`/`STAGIAIRE` (Phase A) — une demande dont le
 * créateur est bénéficiaire `ENTREPRISE`/`FOURNISSEUR` (cas normal, pas
 * seulement les dépenses directes de Finance) aurait disparu du tableau de
 * bord de son propre créateur. Cohérent avec le principe directeur : le
 * cycle démarre de la demande du Collaborateur, qui en est l'auteur, pas
 * nécessairement le bénéficiaire final.
 *
 * Calculée en 2 requêtes (jamais une par demande) : la liste des demandes
 * de l'utilisateur, puis un `groupBy` des règlements confirmés/non-annulés
 * sur ces mêmes demandes — même pattern que `getRepartitionDemandesValidees`
 * (`dashboardFinance.ts`) et `getReportingRows`.
 */
export async function getMesIndicateurs(userId: string): Promise<MesIndicateurs> {
  const demandes = await prisma.demande.findMany({
    where: { createurId: userId },
    select: { id: true, montant: true, montantValide: true },
  });

  if (demandes.length === 0) {
    return { demande: 0, valide: 0, restantAValider: 0, regle: 0, valideRestantARegler: 0 };
  }

  const ids = demandes.map((d) => d.id);
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  const regleParDemande = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

  let demande = 0;
  let valide = 0;
  let regle = 0;
  for (const d of demandes) {
    demande += Number(d.montant);
    valide += Number(d.montantValide ?? 0);
    regle += regleParDemande.get(d.id) ?? 0;
  }

  return {
    demande,
    valide,
    restantAValider: Math.max(0, demande - valide),
    regle,
    valideRestantARegler: Math.max(0, valide - regle),
  };
}

export interface MaDemandeDetail {
  id: string;
  reference: string;
  statut: StatutDemande;
  montant: number;
  montantValide: number | null;
  /** Fonds remis pour cette demande précise (`getTotalRegle`, Caisse +
   * Banque confondues — même définition que `RegularisationSummary`). */
  montantRecu: number;
  /** Solde à régulariser de cette demande précise (`decaisse -
   * depensesDeclarees - retoursRecus`, formule identique à `getEcart` —
   * voir note sur la duplication ci-dessous). `0` tant qu'aucun règlement
   * n'a été effectué (rien à régulariser). */
  soldeARegulariser: number;
  createdAt: Date;
}

/**
 * "Mon tableau de bord" détaillé (Tâche "Tableau de bord collaborateur
 * détaillé") — chaque demande de l'utilisateur listée séparément (jamais
 * agrégée comme `getMesIndicateurs` ci-dessus), avec son statut, le
 * montant qu'elle a effectivement reçu (fonds remis) et son état de
 * régularisation.
 *
 * Réutilise directement `getTotalRegle`/`getDepensesDeclarees`/
 * `getRetoursRecus` — les mêmes trois fonctions déjà partagées par
 * `RegularisationSummary` et `getEcart` ci-dessous — plutôt que d'appeler
 * `getEcart` telle quelle : `getEcart` recalculerait `getTotalRegle` une
 * deuxième fois en interne pour arriver au même total déjà nécessaire ici
 * pour `montantRecu` (voir CLAUDE.md "Diagnostic de latence — requêtes
 * redondantes") — la formule reste rigoureusement identique
 * (`totalRegle - depensesDeclarees - retoursRecus`), seul le double appel
 * est évité.
 *
 * PERF-04 : Optimisation N+1 — les agrégats de règlements, de retours reçus
 * et de dépenses déclarées sont regroupés par lots (`groupBy` et `findMany` avec
 * filtre `demandeId: { in: ids }`) en 3 requêtes parallèles au lieu de 3 requêtes
 * par demande (151 requêtes -> 4 requêtes pour 50 demandes).
 */
export async function getMesDemandesDetail(userId: string): Promise<MaDemandeDetail[]> {
  const demandes = await prisma.demande.findMany({
    where: { createurId: userId },
    orderBy: { createdAt: "desc" },
  });

  if (demandes.length === 0) {
    return [];
  }

  const ids = demandes.map((d) => d.id);

  const [reglementsGrouped, retours, depenses] = await Promise.all([
    prisma.reglement.groupBy({
      by: ["demandeId"],
      where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false },
      _sum: { montant: true },
    }),
    prisma.retourCaisse.findMany({
      where: {
        reglement: { demandeId: { in: ids } },
        estReceptionne: true,
      },
      select: {
        montantARetourner: true,
        reglement: { select: { demandeId: true } },
      },
    }),
    prisma.depenseLigne.findMany({
      where: {
        retourCaisse: { reglement: { demandeId: { in: ids } } },
      },
      select: {
        montant: true,
        retourCaisse: {
          select: {
            reglement: { select: { demandeId: true } },
          },
        },
      },
    }),
  ]);

  const regleParDemande = new Map<string, number>();
  for (const r of reglementsGrouped) {
    regleParDemande.set(r.demandeId, Number(r._sum.montant ?? 0));
  }

  const retoursParDemande = new Map<string, number>();
  for (const ret of retours) {
    const dId = ret.reglement.demandeId;
    retoursParDemande.set(dId, (retoursParDemande.get(dId) ?? 0) + Number(ret.montantARetourner ?? 0));
  }
  const rembourses = await prisma.remboursementRetour.findMany({
    where: { statut: "VALIDE", retourCaisse: { reglement: { demandeId: { in: ids } } } },
    select: { montant: true, retourCaisse: { select: { reglement: { select: { demandeId: true } } } } },
  });
  for (const rb of rembourses) {
    const dId = rb.retourCaisse.reglement.demandeId;
    retoursParDemande.set(dId, (retoursParDemande.get(dId) ?? 0) - Number(rb.montant));
  }

  const depensesParDemande = new Map<string, number>();
  for (const dep of depenses) {
    const dId = dep.retourCaisse.reglement.demandeId;
    depensesParDemande.set(dId, (depensesParDemande.get(dId) ?? 0) + Number(dep.montant ?? 0));
  }

  return demandes.map((d) => {
    const montantRecu = regleParDemande.get(d.id) ?? 0;
    const depensesDeclarees = depensesParDemande.get(d.id) ?? 0;
    const retoursRecus = retoursParDemande.get(d.id) ?? 0;
    return {
      id: d.id,
      reference: d.reference,
      statut: d.statut,
      montant: Number(d.montant),
      montantValide: d.montantValide == null ? null : Number(d.montantValide),
      montantRecu,
      soldeARegulariser: montantRecu - depensesDeclarees - retoursRecus,
      createdAt: d.createdAt,
    };
  });
}

/**
 * Zone "À traiter" personnelle, indicateur #1 — nombre de demandes créées
 * par l'utilisateur encore en attente d'une décision de validation. Même
 * définition exacte que `getDemandesEnAttenteValidation`
 * (`dashboardFinance.ts`, via `DEMANDES_EN_ATTENTE_VALIDATION_WHERE`
 * ci-dessus — inclut désormais l'exclusion `reliquatRejete: false`),
 * simplement scopée par `createurId` : un reliquat rejeté ne doit pas non
 * plus compter comme "à traiter" pour le Collaborateur qui l'a créé.
 */
export async function getMesDemandesEnAttente(userId: string): Promise<{ nombre: number }> {
  const nombre = await prisma.demande.count({
    where: { createurId: userId, ...DEMANDES_EN_ATTENTE_VALIDATION_WHERE },
  });
  return { nombre };
}

export interface MoisMontantDemande {
  /** Clé triable "AAAA-MM", jamais affichée directement. */
  mois: string;
  /** Libellé court pré-formaté ("janv. 26") — calculé ici plutôt que côté
   * Client Component, pour rester un Server Component pur (voir
   * `CollaborateurDemandesBarChart.tsx`, aucune interactivité JS requise). */
  label: string;
  montant: number;
}

/**
 * Montant total DEMANDÉ (`Demande.montant`, pas `montantValide` : ce
 * graphique montre le volume de sollicitation du Collaborateur, pas ce qui
 * en a été retenu) par mois calendaire, sur les `nombreDeMois` derniers
 * mois glissants (défaut 6 — voir CLAUDE.md "Modernisation du dashboard
 * Collaborateur" : le volume mensuel d'un seul Collaborateur reste
 * toujours modeste, une fenêtre plus large multiplierait surtout les mois
 * à 0 sans ajouter d'information utile).
 *
 * **Tous les mois de la fenêtre sont renvoyés, y compris à 0** — jamais un
 * trou silencieux dans le tableau si aucune demande n'existe pour un mois
 * donné : c'est `CollaborateurDemandesBarChart.tsx` qui décide, lui, si la
 * fenêtre entière est vide et mérite un message dédié plutôt qu'un
 * graphique à barres toutes nulles.
 *
 * Une seule requête (`findMany` sur la fenêtre), jamais un `groupBy` par
 * mois côté SQL (Prisma ne sait pas grouper par mois calendaire
 * directement sans SQL brut) — le regroupement se fait en mémoire, sans
 * risque de volume vu l'hypothèse déjà retenue pour
 * `getMesDemandesDetail` (Collaborateur, jamais l'échelle Finance).
 */
export async function getMesDemandesParMois(
  userId: string,
  nombreDeMois = 6
): Promise<MoisMontantDemande[]> {
  const maintenant = new Date();
  const premierMoisFenetre = new Date(maintenant.getFullYear(), maintenant.getMonth() - (nombreDeMois - 1), 1);

  const demandes = await prisma.demande.findMany({
    where: { createurId: userId, createdAt: { gte: premierMoisFenetre } },
    select: { montant: true, createdAt: true },
  });

  const cleMois = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const totauxParMois = new Map<string, number>();
  for (let i = 0; i < nombreDeMois; i++) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - (nombreDeMois - 1) + i, 1);
    totauxParMois.set(cleMois(d), 0);
  }
  for (const d of demandes) {
    const cle = cleMois(d.createdAt);
    totauxParMois.set(cle, (totauxParMois.get(cle) ?? 0) + Number(d.montant));
  }

  return Array.from(totauxParMois.entries()).map(([mois, montant]) => {
    const [annee, moisIndex] = mois.split("-").map(Number);
    const label = new Date(annee, moisIndex - 1, 1)
      .toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
      .replace(".", "");
    return { mois, label, montant };
  });
}

/**
 * Règlements Caisse confirmés (non annulés) des demandes créées par cet
 * utilisateur, pour lesquels **aucun** `RetourCaisse` n'a encore été
 * déclaré — même règle d'éligibilité que le bouton "Déclarer un retour de
 * caisse" (Ticket 5, `RetoursCaisseSection.tsx` : un seul retour par
 * règlement) : `mode: CAISSE`, `estConfirme: true`, `estAnnule: false`,
 * aucune ligne dans `retours`. Exclut aussi les demandes déjà `CLOTUREE`
 * (Ticket 7 : un retour resté en attente sur une demande clôturée ne peut
 * plus jamais être déclaré — même verrou que `peutDeclarer` sur cet écran).
 *
 * Retourne la liste complète (pas seulement un compte) : c'est elle qui
 * détermine, à l'écran, si le clic sur la carte "Mes retours de caisse à
 * déclarer" doit mener directement à l'unique demande concernée ou à
 * l'écran de liste `retours-a-declarer` (plusieurs règlements en attente).
 * `getMesRetoursADeclarer` ci-dessous n'est qu'un `{ nombre }` dérivé de
 * cette même requête — jamais deux implémentations de la même règle.
 */
export async function getReglementsCaisseADeclarer(userId: string): Promise<
  { reglementId: string; demandeId: string; reference: string; montant: number; confirmeAt: Date | null; mode: "CAISSE" | "BANQUE" }[]
> {
  const reglements = await prisma.reglement.findMany({
    where: {
      // Inclut désormais les règlements BANQUE (voir CLAUDE.md "Retour sur
      // règlement Banque") — le retour y est possible, avec bordereau.
      estConfirme: true,
      estAnnule: false,
      demande: { createurId: userId, statut: { not: "CLOTUREE" } },
      retours: { none: {} },
    },
    select: {
      id: true,
      montant: true,
      mode: true,
      confirmeAt: true,
      demande: { select: { id: true, reference: true } },
    },
    orderBy: { confirmeAt: "asc" },
  });

  return reglements.map((r) => ({
    reglementId: r.id,
    demandeId: r.demande.id,
    reference: r.demande.reference,
    mode: r.mode,
    montant: Number(r.montant),
    confirmeAt: r.confirmeAt,
  }));
}

/**
 * Zone "À traiter" personnelle, indicateur #2 — nombre de règlements Caisse
 * en attente de déclaration d'un retour (voir `getReglementsCaisseADeclarer`
 * pour la règle d'éligibilité complète). C'est une action qui revient au
 * Collaborateur lui-même, jamais à Finance.
 */
export async function getMesRetoursADeclarer(userId: string): Promise<{ nombre: number }> {
  const reglements = await getReglementsCaisseADeclarer(userId);
  return { nombre: reglements.length };
}

/** Convertit un montant en centimes entiers pour des comparaisons fiables
 * (évite les artefacts de virgule flottante sur des `Number(Prisma.Decimal)`
 * lors d'une égalité stricte, ex: montantValide === montant demandé). */
function toCents(montant: number): number {
  return Math.round(montant * 100);
}

/**
 * Calcule le statut d'une Demande à partir de ses montants réels (montant
 * demandé, `montantValide`, total réglé — `getTotalRegle`) et l'enregistre
 * en base. Fonction centrale de la Phase B (validation partielle) : à
 * appeler à la fin de CHAQUE action qui modifie `montantValide` ou les
 * règlements d'une demande (validation initiale/complémentaire, et plus
 * tard règlement/clôture dans les phases suivantes), plutôt que de fixer
 * `statut` à la main à chaque endroit.
 *
 * Interprétation retenue (le cahier des charges laisse une marge sur
 * l'articulation exacte de ces statuts — voir CLAUDE.md "Refonte V1 en
 * cours" / Phase B pour la discussion complète) :
 *
 * - `REJETEE` et `CLOTUREE` sont des états TERMINAUX, gérés par leurs
 *   propres actions dédiées (`rejeterDemandeAction`,
 *   `cloturerDemandeAction`) : cette fonction ne les modifie jamais,
 *   même si les montants changeraient techniquement le calcul.
 * - `montantValide` nul ou 0 : `EN_ATTENTE_VALIDATION` (rien n'a encore
 *   été validé).
 * - `0 < montantValide < montant demandé` : `PARTIELLEMENT_VALIDEE`.
 * - `montantValide === montant demandé` (entièrement validé, en une ou
 *   plusieurs fois) : le statut dépend alors de `getTotalRegle` —
 *   `VALIDEE_NON_REGLEE` (rien réglé), `PARTIELLEMENT_REGLEE` (réglé
 *   partiel), `REGLEE` (réglé >= validé). **Le statut `VALIDEE` n'est donc
 *   plus jamais produit par cette fonction** : il reste dans l'enum pour la
 *   compatibilité (voir `STATUTS_VALIDATION_COMPLETE` ci-dessus) mais
 *   correspond à un état transitoire immédiatement remplacé par l'un de
 *   ces trois statuts plus précis dès que `calculerStatutDemande` tourne.
 */
export async function calculerStatutDemande(demandeId: string): Promise<StatutDemande> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    throw new Error(`calculerStatutDemande : demande ${demandeId} introuvable.`);
  }

  if (demande.statut === "REJETEE" || demande.statut === "CLOTUREE") {
    return demande.statut;
  }

  const montantDemandeCents = toCents(Number(demande.montant));
  const montantValideCents = toCents(Number(demande.montantValide ?? 0));

  let nouveauStatut: StatutDemande;
  if (montantValideCents <= 0) {
    nouveauStatut = "EN_ATTENTE_VALIDATION";
  } else if (montantValideCents < montantDemandeCents) {
    nouveauStatut = "PARTIELLEMENT_VALIDEE";
  } else {
    const totalRegleCents = toCents(await getTotalRegle(demandeId));
    if (totalRegleCents <= 0) {
      nouveauStatut = "VALIDEE_NON_REGLEE";
    } else if (totalRegleCents < montantValideCents) {
      nouveauStatut = "PARTIELLEMENT_REGLEE";
    } else {
      nouveauStatut = "REGLEE";
    }
  }

  if (nouveauStatut !== demande.statut) {
    await prisma.demande.update({ where: { id: demandeId }, data: { statut: nouveauStatut } });
  }

  return nouveauStatut;
}
