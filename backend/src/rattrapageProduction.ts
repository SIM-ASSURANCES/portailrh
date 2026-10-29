import type { ResultatEtape } from "./rattrapageEtapes";

/**
 * Logique PURE du script chaîné `prisma/rattrapage-production.ts` (lot O, 2026-10-30) : définition ORDONNÉE des étapes, lecture
 * des arguments, et mise en forme du rapport « avant / après ». Aucun accès base ici.
 *
 * ORDRE (il compte) :
 *   1. comptage des règlements (lecture seule, lot D)            — informatif ;
 *   2. statut / étape / montant validé des demandes à articles (lot B) ;
 *   3. règlements → article, cas à un seul article validé (lot D) — AVANT la clôture, dont l'évaluation lit les règlements rattachés ;
 *   4. clôtures antérieures à la règle « tous les articles terminés » (lot C) — marquage IRRÉVERSIBLE ;
 *   5. historique → action signée, par identifiant (lot L bis).
 * Les cas ambigus ne sont JAMAIS devinés : ils sont comptés et listés, à traiter à la main (`--affecter` du lot D).
 */
export type IdEtape = "comptage" | "statuts" | "reglements" | "cloture" | "signatures";

export interface DefinitionEtape {
  id: IdEtape;
  numero: number;
  titre: string;
  lot: string;
  /** Écrit-elle en base quand on applique ? */
  ecrit: boolean;
  /** Une écriture déjà faite peut-elle être défaite par le script ? (jamais : on restaure la sauvegarde). */
  irreversible: boolean;
  /** Un second passage ne trouve plus rien à faire. */
  idempotente: boolean;
  note: string;
}

export const ETAPES_RATTRAPAGE: readonly DefinitionEtape[] = [
  { id: "comptage", numero: 1, titre: "Comptage des règlements par article", lot: "D", ecrit: false, irreversible: false, idempotente: true, note: "lecture seule (comptage-reglements-articles.sql)" },
  { id: "statuts", numero: 2, titre: "Statut, étape et montant validé des demandes à articles", lot: "B", ecrit: true, irreversible: true, idempotente: true, note: "corrige Demande.statut / etapeCircuit / montantValide ; trace « reprise_statut_articles »" },
  { id: "reglements", numero: 3, titre: "Règlements rattachés à leur article (un seul article validé)", lot: "D", ecrit: true, irreversible: true, idempotente: true, note: "Reglement.ligneDemandeId ; les cas ambigus restent à rattacher à la main" },
  { id: "cloture", numero: 4, titre: "Demandes clôturées avant la règle « tous les articles terminés »", lot: "C", ecrit: true, irreversible: true, idempotente: true, note: "marque « clôturée sans régularisation » (instantané des articles) ; statut CLOTUREE et caisse intacts" },
  { id: "signatures", numero: 5, titre: "Historique rattaché à son action signée", lot: "L bis", ecrit: true, irreversible: true, idempotente: true, note: "HistoriqueEntry.actionSigneeId ; les cas ambigus restent « Signature non rattachée »" },
] as const;

export const CONFIRMATION_RATTRAPAGE = "RATTRAPER";

export interface ArgumentsRattrapage {
  appliquer: boolean;
  confirmation: string | null;
}

export function analyserArgumentsRattrapage(argv: readonly string[]): ArgumentsRattrapage {
  const i = argv.indexOf("--confirmation");
  const egal = argv.find((a) => a.startsWith("--confirmation="));
  return {
    appliquer: argv.includes("--appliquer"),
    confirmation: i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null) : egal ? egal.slice("--confirmation=".length) : null,
  };
}

export const confirmationRattrapageValide = (saisie: string | null | undefined): boolean => saisie === CONFIRMATION_RATTRAPAGE;

/** Résultat d'une étape dans un passage : avant (simulation), appliqué, après (nouvelle simulation). */
export interface BilanEtape {
  etape: DefinitionEtape;
  avant: ResultatEtape;
  /** Écrit pendant ce passage (0 en simulation). */
  appliquees: number;
  /** Nouvelle simulation faite APRÈS l'écriture (absente en simulation). */
  apres: ResultatEtape | null;
}

/** L'étape est « propre » si, après application, il ne reste rien à traiter automatiquement. */
export function resteAFaire(b: BilanEtape): number {
  return (b.apres ?? b.avant).aTraiter;
}

export function formaterBilan(bilans: readonly BilanEtape[], appliquer: boolean): string {
  const l: string[] = [];
  l.push(`=== Bilan du rattrapage (${appliquer ? "APPLIQUÉ" : "SIMULATION — rien n'a été écrit"}) ===`);
  const L = 74;
  l.push("Étape".padEnd(L) + "à traiter".padStart(10) + (appliquer ? "écrites".padStart(9) + "restant".padStart(9) : "") + "ambigus".padStart(9));
  for (const b of bilans) {
    const apres = b.apres ?? b.avant;
    l.push(
      `${b.etape.numero}. ${b.etape.titre} (lot ${b.etape.lot})`.slice(0, L - 1).padEnd(L) +
        String(b.avant.aTraiter).padStart(10) +
        (appliquer ? String(b.appliquees).padStart(9) + String(apres.aTraiter).padStart(9) : "") +
        String(apres.ambigus).padStart(9)
    );
  }
  // Le comptage (étape 1, lecture seule) montre les mêmes demandes ambiguës que l'étape 3 : il n'est pas additionné.
  const ambigus = bilans.filter((b) => b.etape.id !== "comptage").reduce((n, b) => n + (b.apres ?? b.avant).ambigus, 0);
  const restant = bilans.reduce((n, b) => n + resteAFaire(b), 0);
  if (appliquer) {
    l.push(restant === 0 ? "Idempotence : une nouvelle simulation ne trouve plus RIEN à traiter automatiquement." : `ATTENTION : ${restant} élément(s) restent à traiter après application — relancer la simulation et analyser.`);
  }
  if (ambigus > 0) l.push(`${ambigus} cas ambigu(s) / à traiter à la main : listés ci-dessus, jamais devinés (voir docs/mise-en-production.md, étape 3).`);
  const irreversibles = ETAPES_RATTRAPAGE.filter((e) => e.ecrit && e.irreversible);
  if (!appliquer) l.push(`Écritures non défaisables par le script (retour arrière = restauration de la sauvegarde) : étapes ${irreversibles.map((e) => e.numero).join(", ")}.`);
  return l.join("\n");
}
