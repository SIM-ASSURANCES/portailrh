import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { chargerParametresCpt, seuilsRelance } from "./cptParametres";
import {
  ageEnJoursCpt,
  clePalierCpt,
  FILTRES_SUIVI_VIDES_CPT,
  jourTexteCpt,
  lundiDeLaSemaineCpt,
  messageResumeHebdoCpt,
  PALIERS_CPT,
  planifierPaliersCpt,
  type LigneAgeeCpt,
  type MessagePalierCpt,
  type ObjetControleCpt,
  type PalierCpt,
  type SeuilsPaliersCpt,
} from "./cptSuiviHebdo";
import {
  compterContratsSansEncaissementCpt,
  compterEncaissementsSansContratCpt,
  contratsSansEncaissementWhere,
  dateAgeContratCpt,
  encaissementsSansContratWhere,
} from "./cptSuiviHebdoDb";

/**
 * Relances 7 / 30 / 60 jours et résumé du lundi (lot GC-6b, conception §9) : ÉCRITURES en base, sans aucun envoi — l'envoi des
 * notifications reste dans `frontend/src/lib/taches/compta.ts` (le service de notification est celui du portail). Ce fichier
 * décide quoi envoyer et le RÉSERVE ; l'appelant n'envoie que ce que la réservation lui a rendu.
 *
 * RÈGLES (registre C-18, provisoire) :
 *  1. Module non mis en service (`CptMiseEnService` absente) : rien n'est lu, rien n'est écrit, rien n'est envoyé.
 *  2. PREMIER PASSAGE après la mise en service : toutes les lignes déjà dans la liste reçoivent leurs paliers déjà franchis en
 *     réservation SANS envoi (`envoyeeAt` nul) ; le marqueur `compta.relances_initiales` (table `MarqueurUnique`) est posé dans la
 *     même transaction, donc une seule fois, même avec deux instances. L'arriéré hérité des tests ou de la reprise ne notifie
 *     personne ; seules les lignes qui franchissent un palier APRÈS sont relancées.
 *  3. Ensuite, une ligne ne reçoit jamais qu'UN palier à la fois : le plus élevé franchi ; ceux d'en dessous encore libres sont
 *     réservés sans envoi (une ligne importée tard ne déclenche pas relance, alerte et escalade en rafale).
 *  4. Idempotence : un palier se RÉSERVE avant tout envoi (insertion unique sur objet + identifiant + palier, `skipDuplicates`) ; seules
 *     les lignes réellement insérées par CETTE exécution sont notifiées. Deux exécutions simultanées : la seconde attend la première
 *     (index unique) puis ne réserve rien.
 *  5. Une ligne sort de la liste dès qu'elle est traitée : elle n'est plus relancée, sans que ses réservations soient effacées.
 */

export type RelancesDbCpt = Pick<PrismaClient, "$transaction" | "cptMiseEnService" | "cptParametre">;

export const CLE_RELANCES_INITIALES_CPT = "compta.relances_initiales";
const TAILLE_LOT = 5000;

export interface PalierAEnvoyerCpt {
  objet: ObjetControleCpt;
  palier: PalierCpt;
  /** Références lisibles (numéro CPE de l'encaissement, numéro de police du contrat), plus anciennes lignes d'abord. */
  references: string[];
}

export interface ResultatReservationRelancesCpt {
  moduleMisEnService: boolean;
  premierPassage: boolean;
  /** Lignes ayant atteint au moins le premier palier. */
  examinees: number;
  /** Paliers réservés sans envoi (arriéré du premier passage, paliers inférieurs franchis d'un coup). */
  silencieuses: number;
  aEnvoyer: PalierAEnvoyerCpt[];
  seuils: SeuilsPaliersCpt | null;
}

function lots<T>(elements: readonly T[]): T[][] {
  const sortie: T[][] = [];
  for (let i = 0; i < elements.length; i += TAILLE_LOT) sortie.push(elements.slice(i, i + TAILLE_LOT));
  return sortie;
}

async function moduleEnService(db: Pick<PrismaClient, "cptMiseEnService">): Promise<boolean> {
  return (await db.cptMiseEnService.findFirst({ select: { id: true } })) !== null;
}

export async function reserverRelancesCpt(db: RelancesDbCpt, maintenant: Date): Promise<ResultatReservationRelancesCpt> {
  if (!(await moduleEnService(db))) {
    return { moduleMisEnService: false, premierPassage: false, examinees: 0, silencieuses: 0, aEnvoyer: [], seuils: null };
  }
  const seuils = seuilsRelance(await chargerParametresCpt(db));

  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Marqueur du premier passage : 0 ligne insérée = déjà fait (par ce processus, un précédent ou une autre instance).
      const inserees = await tx.$executeRaw`INSERT INTO "MarqueurUnique" ("cle", "creeAt") VALUES (${CLE_RELANCES_INITIALES_CPT}, ${maintenant}) ON CONFLICT ("cle") DO NOTHING`;
      const premierPassage = inserees > 0;

      // MÊMES filtres que les listes de l'écran : une ligne relancée est une ligne que le contrôle affiche.
      const [encaissements, contrats] = await Promise.all([
        tx.cptEncaissement.findMany({
          where: encaissementsSansContratWhere(FILTRES_SUIVI_VIDES_CPT, maintenant, seuils.relanceJours),
          orderBy: [{ dateValeur: "asc" }, { reference: "asc" }],
          select: { id: true, reference: true, dateValeur: true },
        }),
        tx.cptContrat.findMany({
          where: contratsSansEncaissementWhere(FILTRES_SUIVI_VIDES_CPT, maintenant, seuils.relanceJours),
          orderBy: [{ datePaiementDeclaree: { sort: "asc", nulls: "last" } }, { creeAt: "asc" }, { numPolice: "asc" }],
          select: { id: true, numPolice: true, datePaiementDeclaree: true, creeAt: true },
        }),
      ]);

      const references = new Map<string, string>();
      const lignes: LigneAgeeCpt[] = [];
      for (const e of encaissements) {
        references.set(`ENCAISSEMENT|${e.id}`, e.reference);
        lignes.push({ objet: "ENCAISSEMENT", id: e.id, age: ageEnJoursCpt(e.dateValeur, maintenant) });
      }
      for (const c of contrats) {
        references.set(`CONTRAT|${c.id}`, c.numPolice);
        lignes.push({ objet: "CONTRAT", id: c.id, age: ageEnJoursCpt(dateAgeContratCpt(c), maintenant) });
      }

      const dejaReserves = new Set<string>();
      for (const objet of ["ENCAISSEMENT", "CONTRAT"] as const) {
        for (const lot of lots(lignes.filter((l) => l.objet === objet).map((l) => l.id))) {
          const lus = await tx.cptAlerteControle.findMany({ where: { objet, objetId: { in: lot } }, select: { objet: true, objetId: true, palier: true } });
          for (const r of lus) dejaReserves.add(clePalierCpt(r.objet, r.objetId, r.palier));
        }
      }

      const plan = planifierPaliersCpt(lignes, dejaReserves, seuils, premierPassage);
      const toutes = [
        ...plan.aEnvoyer.map((r) => ({ objet: r.objet, objetId: r.id, palier: r.palier, envoyeeAt: maintenant as Date | null })),
        ...plan.silencieux.map((r) => ({ objet: r.objet, objetId: r.id, palier: r.palier, envoyeeAt: null as Date | null })),
      ];

      // Réservation : seules les lignes réellement insérées par CETTE exécution comptent (skipDuplicates écarte les autres).
      const reservees: { objet: ObjetControleCpt; objetId: string; palier: PalierCpt; envoyeeAt: Date | null }[] = [];
      for (const lot of lots(toutes)) {
        reservees.push(...(await tx.cptAlerteControle.createManyAndReturn({ data: lot, skipDuplicates: true, select: { objet: true, objetId: true, palier: true, envoyeeAt: true } })));
      }

      const groupes = new Map<string, PalierAEnvoyerCpt>();
      for (const r of reservees) {
        if (r.envoyeeAt === null) continue;
        const cle = `${r.objet}|${r.palier}`;
        const groupe = groupes.get(cle) ?? { objet: r.objet, palier: r.palier, references: [] };
        groupe.references.push(references.get(`${r.objet}|${r.objetId}`) ?? r.objetId);
        groupes.set(cle, groupe);
      }
      // Ordre stable : palier croissant, encaissements avant contrats ; références triées.
      const aEnvoyer = [...groupes.values()]
        .map((g) => ({ ...g, references: g.references.sort() }))
        .sort((a, b) => PALIERS_CPT.indexOf(a.palier) - PALIERS_CPT.indexOf(b.palier) || a.objet.localeCompare(b.objet));

      return {
        moduleMisEnService: true,
        premierPassage,
        examinees: lignes.length,
        silencieuses: reservees.filter((r) => r.envoyeeAt === null).length,
        aEnvoyer,
        seuils,
      };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}

// ---------- Résumé du lundi ----------

export interface ResultatResumeHebdoCpt {
  moduleMisEnService: boolean;
  /** Vrai quand le résumé de CETTE semaine avait déjà été réservé par une exécution précédente. */
  dejaFait: boolean;
  encaissements: MessagePalierCpt | null;
  contrats: MessagePalierCpt | null;
}

/**
 * Résumé hebdomadaire : les chiffres de la semaine (aucune ligne individuelle, donc rien à voir avec l'arriéré). Une seule fois par
 * semaine (clé `compta.controle_hebdo.<lundi>` dans `MarqueurUnique`, posée avant l'envoi), même si la tâche est rattrapée un autre
 * jour que le lundi ou lancée à la main. Les chiffres sont ceux des listes de l'écran (mêmes filtres).
 */
export async function reserverResumeHebdoCpt(db: RelancesDbCpt, maintenant: Date): Promise<ResultatResumeHebdoCpt> {
  if (!(await moduleEnService(db))) return { moduleMisEnService: false, dejaFait: false, encaissements: null, contrats: null };
  const seuils = seuilsRelance(await chargerParametresCpt(db));
  const cle = `compta.controle_hebdo.${lundiDeLaSemaineCpt(jourTexteCpt(maintenant))}`;

  return db.$transaction(
    async (tx: Prisma.TransactionClient): Promise<ResultatResumeHebdoCpt> => {
      // Marqueur et comptages dans la MÊME transaction : un comptage qui échoue annule aussi la réservation de la semaine.
      const inseree = (await tx.$executeRaw`INSERT INTO "MarqueurUnique" ("cle", "creeAt") VALUES (${cle}, ${maintenant}) ON CONFLICT ("cle") DO NOTHING`) > 0;
      if (!inseree) return { moduleMisEnService: true, dejaFait: true, encaissements: null, contrats: null };

      const filtres = FILTRES_SUIVI_VIDES_CPT;
      const [encTotal, encRelance, encAlerte, conTotal, conRelance, conAlerte] = await Promise.all([
        compterEncaissementsSansContratCpt(tx, filtres, maintenant),
        compterEncaissementsSansContratCpt(tx, filtres, maintenant, seuils.relanceJours),
        compterEncaissementsSansContratCpt(tx, filtres, maintenant, seuils.alerteJours),
        compterContratsSansEncaissementCpt(tx, filtres, maintenant),
        compterContratsSansEncaissementCpt(tx, filtres, maintenant, seuils.relanceJours),
        compterContratsSansEncaissementCpt(tx, filtres, maintenant, seuils.alerteJours),
      ]);
      return {
        moduleMisEnService: true,
        dejaFait: false,
        encaissements: messageResumeHebdoCpt({ objet: "ENCAISSEMENT", total: encTotal, relance: encRelance, alerte: encAlerte, seuils }),
        contrats: messageResumeHebdoCpt({ objet: "CONTRAT", total: conTotal, relance: conRelance, alerte: conAlerte, seuils }),
      };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}
