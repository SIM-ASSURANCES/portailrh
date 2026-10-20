// Lot K (2026-10-26) — reprise : application en base des règles de `circuitReprise.ts`. Dans la transaction de l'appelant
// (qui l'annule en entier sur refus) ; verrou de la demande ; aucune écriture dans le journal de caisse, jamais.

import { rendreCaduqueCouvertureArticle } from "./budgetsDb";
import { Prisma } from "./generated/prisma/client";
import { elementsReprise, LIBELLE_ETAPE_CIRCUIT, transition, versDemandeCircuit, type ActeurCircuit, type ElementReprise } from "./circuitDemande";
import { chargerDemandeCircuit, SELECT_DEMANDE_CIRCUIT, verrouillerDemande } from "./circuitDemandeDb";
import { ACTION_HISTORIQUE_REPRISE, detailReprise, type TypeReprise } from "./circuitReprise";
import { montantValideDepuisLignes } from "./etatArticles";
import type { EtapeCircuit } from "./generated/prisma/enums";

type Db = Prisma.TransactionClient;

export type ResultatRepriseDb =
  | { ok: true; type: TypeReprise; etapeAvant: EtapeCircuit; etapeApres: EtapeCircuit; ligneId: string | null; libelleArticle: string | null; montantValide?: number }
  | { ok: false; message: string };

/**
 * Reprend la demande entière (`ligneId` absent : Finance → Service) ou un article (DG → Finance ; validation → Finance) à
 * l'étape précédente, motif obligatoire (10 caractères). Le moteur (`transition`, action `REPRENDRE`) contrôle permission,
 * motif, garde 8, interdits (article rejeté, validé par le DG, réglé — même en brouillon —, demande clôturée…) ; ici :
 *  - l'article repasse « à décider » (validation reprise : décision, décideur et photo du budget effacés — l'historique garde
 *    tout ; retrait de l'étape DG : la soumission est annulée) ;
 *  - budgets : l'engagé se recalcule des articles validés (aucun engagement fantôme) ; la part de l'article dans une confirmation
 *    de dépassement du DG devient caduque (`rendreCaduqueCouvertureArticle`) ;
 *  - étape déduite des articles, montant validé recalculé, chronomètre remis à zéro, rappel recalibré ;
 *  - historique `reprise_etape` : qui, de quelle étape à quelle étape, motif.
 * `calculerStatutDemande` reste à l'appelant (seul point d'écriture du statut).
 */
export async function reprendreEtape(
  db: Db,
  demandeId: string,
  acteur: ActeurCircuit,
  ligneId: string | undefined,
  motif: string,
  maintenant = new Date()
): Promise<ResultatRepriseDb> {
  await verrouillerDemande(db, demandeId);
  const d = await db.demande.findUnique({ where: { id: demandeId }, select: SELECT_DEMANDE_CIRCUIT });
  if (!d) return { ok: false, message: "Demande introuvable." };

  const r = transition(versDemandeCircuit(d), acteur, { type: "REPRENDRE", motif, ligneId });
  if (!r.ok) return r;
  const reprise = r.effets.reprise!;
  const ligne = ligneId ? d.lignes.find((l) => l.id === ligneId) : undefined;
  const changementConcurrent = { ok: false as const, message: "La demande a changé entre-temps : rechargez la page." };

  if (reprise.type === "DG_VERS_FINANCE") {
    const maj = await db.ligneDemande.updateMany({
      where: { id: ligneId, demandeId, statutValidation: "EN_ATTENTE", soumiseAuDG: true, decisionDG: null },
      data: { soumiseAuDG: false, soumiseDGAt: null, soumiseDGParId: null },
    });
    if (maj.count !== 1) return changementConcurrent;
  }

  let montantValide: number | undefined;
  if (reprise.type === "VALIDATION_VERS_FINANCE") {
    // Garde 8 / DG définitif : seule une validation de la Finance seule, sans règlement, se reprend.
    const maj = await db.ligneDemande.updateMany({
      where: { id: ligneId, demandeId, statutValidation: "VALIDEE", soumiseAuDG: false, decisionDG: null },
      data: {
        statutValidation: "EN_ATTENTE",
        motifRejet: null,
        decideParId: null,
        decideAt: null,
        decideurFinanceId: null,
        // Nouvelle validation = nouvelle photo du budget (l'ancienne reste lisible dans l'historique de la demande).
        budgetApresValidation: Prisma.DbNull,
      },
    });
    if (maj.count !== 1) return changementConcurrent;
    // Un règlement créé entre la lecture et l'écriture (la création ne verrouille pas la demande) annule toute la reprise.
    const reglements = await db.reglement.count({ where: { ligneDemandeId: ligneId, estAnnule: false } });
    if (reglements > 0) return { ok: false, message: "Cet article vient de recevoir un règlement : il ne peut plus être repris." };
    await rendreCaduqueCouvertureArticle(db, { demandeId, ligneId: ligneId!, libelle: ligne!.libelle, acteurId: acteur.userId });
    const lignes = await db.ligneDemande.findMany({ where: { demandeId }, select: { quantite: true, prixUnitaire: true, statutValidation: true } });
    montantValide = montantValideDepuisLignes(lignes.map((l) => ({ quantite: l.quantite, prixUnitaire: l.prixUnitaire.toString(), statut: l.statutValidation })));
  }

  const maj = await db.demande.updateMany({
    where: { id: demandeId, etapeCircuit: d.etapeCircuit },
    data: {
      etapeCircuit: r.etapeSuivante,
      // Le chronomètre du circuit repart de zéro (un seul par demande) et le rappel se recalibre sur l'étape reprise.
      etapeCircuitDepuis: maintenant,
      dernierRappelAt: null,
      ...(montantValide !== undefined ? { montantValide } : {}),
    },
  });
  if (maj.count !== 1) return changementConcurrent;

  // Reprise d'un article : rattachée à l'article (comme validation_ligne), donc lue par son parcours ; reprise de la demande : à la demande.
  await db.historiqueEntry.create({
    data: {
      entity: ligneId ? "LigneDemande" : "Demande",
      entityId: ligneId ?? demandeId,
      action: ACTION_HISTORIQUE_REPRISE,
      detail: detailReprise({
        type: reprise.type,
        motif,
        libelleArticle: ligne?.libelle ?? null,
        etapeAvant: LIBELLE_ETAPE_CIRCUIT[d.etapeCircuit],
        etapeApres: LIBELLE_ETAPE_CIRCUIT[r.etapeSuivante],
      }),
      userId: acteur.userId,
    },
  });
  return {
    ok: true,
    type: reprise.type,
    etapeAvant: d.etapeCircuit,
    etapeApres: r.etapeSuivante,
    ligneId: ligneId ?? null,
    libelleArticle: ligne?.libelle ?? null,
    montantValide,
  };
}

/** Ce que l'écran propose à `acteur` comme reprise sur cette demande (phrase du serveur quand c'est impossible). */
export async function chargerElementsReprise(db: Db, demandeId: string, acteur: ActeurCircuit): Promise<ElementReprise[]> {
  const demande = await chargerDemandeCircuit(db, demandeId);
  return demande ? elementsReprise(demande, acteur) : [];
}
