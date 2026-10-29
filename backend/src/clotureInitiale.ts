import type { Prisma, PrismaClient } from "./generated/prisma/client";

/**
 * Clôture INITIALE au premier passage du planificateur en production (décision de Thierry, 2026-10-14) : toutes les
 * justifications EN_ATTENTE dont le pointage date d'AVANT le jour courant sont clôturées sans aucun envoi
 * (NON_JUSTIFIEE + `clotureeAt`), et les absences A_CONTROLER antérieures au jour courant passent à CONFIRMEE, sans
 * notification. Évite que le premier passage n'inonde les collaborateurs de demandes sur un arriéré de test.
 *
 * Statut des absences : CONFIRMEE (« Absence injustifiée (confirmée) » dans l'écran RH) est le SEUL statut qui garde
 * l'absence comptée sans prétendre qu'elle est excusée — l'autre statut de clôture, JUSTIFIEE, effacerait la sanction
 * sans motif ; laisser A_CONTROLER ne clôturerait rien. Pas d'auteur de contrôle (`controleParId` reste vide) et un motif
 * explicite quand l’absence n’en avait pas, pour que la RH sache que la clôture est automatique.
 *
 * Ne s'exécute qu'UNE fois : l'insertion de la clé dans `MarqueurUnique` (clé primaire) fait office de verrou, dans la
 * même transaction que les clôtures — si elles échouent, le marqueur est annulé et le passage suivant recommence ; si
 * deux instances démarrent ensemble, la seconde attend la première puis constate le marqueur.
 */

export const CLE_CLOTURE_INITIALE = "pointage.cloture_initiale";

export const MOTIF_CLOTURE_INITIALE_ABSENCE =
  "Clôture automatique à la mise en production : absence antérieure non contrôlée par la RH.";

export interface ResultatClotureInitiale {
  executee: boolean;
  justificationsCloturees: number;
  absencesConfirmees: number;
}

/** Début (00:00, heure locale du serveur) du jour de `now` : frontière « avant le jour courant ». */
export function debutDuJour(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function cloturerEnAttenteInitiale(
  db: Pick<PrismaClient, "$transaction">,
  now: Date = new Date()
): Promise<ResultatClotureInitiale> {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Insertion du marqueur : 0 ligne = déjà fait (par ce processus, un précédent ou une autre instance).
      const inserees = await tx.$executeRaw`INSERT INTO "MarqueurUnique" ("cle", "creeAt") VALUES (${CLE_CLOTURE_INITIALE}, ${now}) ON CONFLICT ("cle") DO NOTHING`;
      if (inserees === 0) return { executee: false, justificationsCloturees: 0, absencesConfirmees: 0 };

      const avantAujourdhui = debutDuJour(now);
      const justifications = await tx.justificationPointage.updateMany({
        where: { statut: "EN_ATTENTE", pointage: { heure: { lt: avantAujourdhui } } },
        data: { statut: "NON_JUSTIFIEE", clotureeAt: now },
      });
      // Deux écritures pour ne jamais écraser un motif déjà saisi.
      const sansMotif = await tx.absence.updateMany({
        where: { statut: "A_CONTROLER", date: { lt: avantAujourdhui }, motif: null },
        data: { statut: "CONFIRMEE", motif: MOTIF_CLOTURE_INITIALE_ABSENCE },
      });
      const avecMotif = await tx.absence.updateMany({
        where: { statut: "A_CONTROLER", date: { lt: avantAujourdhui } },
        data: { statut: "CONFIRMEE" },
      });
      const resultat = {
        executee: true,
        justificationsCloturees: justifications.count,
        absencesConfirmees: sansMotif.count + avecMotif.count,
      };

      await tx.marqueurUnique.update({ where: { cle: CLE_CLOTURE_INITIALE }, data: { bilan: resultat } });
      // Une ligne TACHE au journal technique, dans la même transaction (jamais de clôture sans trace).
      await tx.journalTechnique.create({
        data: {
          niveau: "AVERTISSEMENT",
          source: "TACHE",
          code: "CLOTURE_INITIALE",
          message: `Clôture initiale au premier passage du planificateur : ${resultat.justificationsCloturees} justification(s) clôturée(s) sans envoi, ${resultat.absencesConfirmees} absence(s) confirmée(s) sans notification.`,
          contexte: {
            justificationsCloturees: resultat.justificationsCloturees,
            absencesConfirmees: resultat.absencesConfirmees,
          },
        },
      });
      return resultat;
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}
