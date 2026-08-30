import type { StatutDemande } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

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
 */
export async function getResteARegler(demandeId: string): Promise<number> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande || demande.montantValide == null) {
    return 0;
  }
  const totalRegle = await getTotalRegle(demandeId);
  return Math.max(0, Number(demande.montantValide) - totalRegle);
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
 */
export async function peutEffectuerReglement(demandeId: string): Promise<boolean> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return false;
  }
  if (demande.statut === "CLOTUREE" || demande.statut === "REJETEE") {
    return false;
  }
  if (demande.montantValide == null || Number(demande.montantValide) <= 0) {
    return false;
  }
  return (await getResteARegler(demandeId)) > 0;
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
 * Somme des `montantDepense` de TOUS les `RetourCaisse` liés aux règlements
 * d'une demande — peu importe qu'ils soient déjà réceptionnés ou non : c'est
 * ce que le collaborateur affirme avoir dépensé, indépendamment du
 * traitement de Finance. Ticket 7 (régularisation/clôture).
 */
export async function getDepensesDeclarees(demandeId: string): Promise<number> {
  const result = await prisma.retourCaisse.aggregate({
    where: { reglement: { demandeId } },
    _sum: { montantDepense: true },
  });
  return Number(result._sum.montantDepense ?? 0);
}

/**
 * Somme des `montantARetourner` des `RetourCaisse` d'une demande,
 * UNIQUEMENT ceux réceptionnés (`estReceptionne: true`) — l'argent
 * réellement revenu en caisse, par opposition à un retour simplement
 * déclaré mais pas encore traité par Finance.
 */
export async function getRetoursRecus(demandeId: string): Promise<number> {
  const result = await prisma.retourCaisse.aggregate({
    where: { reglement: { demandeId }, estReceptionne: true },
    _sum: { montantARetourner: true },
  });
  return Number(result._sum.montantARetourner ?? 0);
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
