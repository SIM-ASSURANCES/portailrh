import { parseCorrectionDetail, type LigneSnapshot } from "@/lib/correctionRetour";
import {
  lignesRetireesParCorrection,
  lireVersionCorrection,
  prisma,
  type LigneVersion,
  type VersionDemande,
} from "backend";

/**
 * Libellés lisibles pour les actions déjà connues. Volontairement non
 * exhaustif : toute action historisée sans entrée ici (règlement, retour de
 * caisse... à venir dans de prochains tickets) s'affiche simplement avec sa
 * valeur brute — ce composant n'a jamais besoin d'être modifié pour
 * accueillir un nouveau type d'évènement.
 */
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Création de la demande",
  CATEGORISER: "Catégorisation",
  modification_description: "Description du besoin modifiée",
  validation: "Validation",
  validation_complementaire: "Validation complémentaire",
  rejet: "Rejet",
  rejet_reliquat: "Rejet du reliquat non validé",
  reglement: "Règlement",
  annulation_reglement: "Annulation de règlement",
  declaration_retour: "Retour de caisse déclaré",
  modification_retour: "Retour de caisse modifié",
  reception_retour: "Retour de caisse réceptionné",
  // Tâche "L'Assistant Finance déclare les dépenses sur toute demande,
  // retour ou pas" (voir CLAUDE.md) — l'Assistant se substitue au
  // collaborateur absent, sur une demande encore active.
  declaration_retour_assistant: "Retour de caisse déclaré par l'Assistant Finance",
  // Tâche "Réouverture exceptionnelle post-clôture pour retour de caisse
  // oublié" — volontairement UN LIBELLÉ DISTINCT du précédent (voir
  // CLAUDE.md) : ne doit jamais être confondu avec un retour normal, même
  // déclaré par l'Assistant sur une demande active.
  reouverture_exceptionnelle_retour: "Réouverture exceptionnelle — retour de caisse complémentaire (demande clôturée)",
  // Tâche "L'Assistant Finance détaille réellement le retour" (voir
  // CLAUDE.md) — volontairement VISIBLE au Collaborateur (comme
  // `declaration_retour_assistant`) : c'est une information sur SON
  // ARGENT, jamais de la gestion interne à masquer.
  detaillage_retour: "Détail réel du retour renseigné par l'Assistant Finance",
  // Circuit de validation (2026-10-06).
  circuit_initialise: "Circuit de validation",
  validation_service: "Validée par le responsable de service",
  renvoi_correction: "Renvoyée au demandeur pour correction",
  soumission_dg: "Soumise au DG",
  resoumission_dg: "Resoumise au DG",
  validation_dg: "Validée par le DG",
  rejet_dg: "Rejetée par le DG",
  decision_circuit: "Décision finale",
  correction_demande: "Version avant correction",
  resoumission_correction: "Corrigée et resoumise",
  abandon: "Abandonnée par le demandeur",
  exception_depense_directe: "Dépense directe décidée par son auteur (exception)",
  // Tâche "Signalement d'erreur par le Collaborateur" — les deux actions
  // restent visibles au Collaborateur : la première est SA PROPRE action,
  // la seconde répond directement à son signalement.
  signalement_retour: "Erreur signalée par le collaborateur",
  correction_signalement_retour: "Détail du retour corrigé suite à un signalement",
  ajustement_total_retour: "Total déclaré du retour ajusté par Finance",
  // Retour de caisse exceptionnel post-clôture (voir CLAUDE.md) : la saisie et
  // le rejet restent internes (jamais montrés au Collaborateur, évite une fausse
  // alerte) ; seule la validation lui est visible.
  retour_exceptionnel_saisie: "Retour exceptionnel post-clôture saisi (en attente de validation)",
  retour_exceptionnel_rejete: "Retour exceptionnel post-clôture rejeté",
  retour_exceptionnel_post_cloture: "Retour exceptionnel post-clôture validé",
  justification_apres_reception: "Dépense justifiée après réception du retour (pièce jointe ajoutée)",
  retour_complementaire_signalement: "Retour complémentaire déclaré suite au signalement",
  remboursement_retour_propose: "Remboursement proposé suite au signalement (en attente de validation)",
  remboursement_retour_valide: "Remboursement validé (sortie de caisse)",
  remboursement_retour_rejete: "Remboursement rejeté",
  cloture_totale: "Clôture totale",
  cloture_partielle: "Clôture partielle",
  validation_complete_dg: "Validation complète approuvée par le DG",
  rejet_validation_complete: "Validation complète rejetée par le DG (examen)",
  annulation_validation_complete: "Approbation du DG annulée",
  // Tâche "Validation ligne par ligne" (voir CLAUDE.md) — entrées portées
  // par `entity: "LigneDemande"`, une par ligne décidée/modifiée.
  validation_ligne: "Ligne d'article validée",
  rejet_ligne: "Ligne d'article rejetée",
  modification_libelle_ligne: "Libellé d'une ligne d'article modifié",
  // Tâche "Catégorisation par ligne" (voir CLAUDE.md) — même entité
  // `LigneDemande` que ci-dessus.
  categorisation_ligne: "Catégorisation d'une ligne d'article",
};

function ListeLignes({ titre, lignes }: { titre: string; lignes: LigneSnapshot[] }) {
  return (
    <div className="rounded-md bg-muted p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titre}</p>
      {lignes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune ligne.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {lignes.map((l, i) => (
            <li key={i} className="text-xs text-foreground">
              <span className="font-medium">{l.libelle}</span> — {l.montant.toLocaleString("fr-FR")} FCFA ·{" "}
              {l.type === "justifiee" ? "Dépense justifiée" : "Dépense sans pièce formelle"}
              {l.motif && l.motif !== l.libelle ? <> · Motif : {l.motif}</> : null}
              {l.pieceJointe ? (
                <>
                  {" · "}
                  <a
                    href={`/api/treso/pieces-jointes/${l.pieceJointe.id}`}
                    className="text-info underline-offset-4 hover:text-primary hover:underline"
                  >
                    Pièce jointe ({l.pieceJointe.fichier.slice(0, 8)}…)
                  </a>
                </>
              ) : (
                <> · Aucune pièce jointe</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DECISION_LIGNE: Record<LigneVersion["decision"], string> = {
  EN_ATTENTE: "En attente",
  VALIDEE: "Validée",
  REJETEE: "Rejetée",
};

const NIVEAU_REJET: Record<string, string> = { SERVICE: "responsable de service", FINANCE: "Finance", DG: "DG" };

function DecisionLigne({ ligne }: { ligne: LigneVersion }) {
  return (
    <>
      {DECISION_LIGNE[ligne.decision] ?? ligne.decision}
      {ligne.decision === "REJETEE" && ligne.motifRejet ? <> (motif : {ligne.motifRejet})</> : null}
      {ligne.decidePar ? <> — par {ligne.decidePar}</> : null}
      {ligne.decideAt ? <> le {new Date(ligne.decideAt).toLocaleDateString("fr-FR")}</> : null}
    </>
  );
}

/**
 * Version d'une demande recopiée avant une correction (`correction_demande`) : tour, rejet, montant et lignes avec
 * leurs décisions ; puis les lignes RETIRÉES à cette correction (absentes de la version suivante), avec leur décision —
 * elles n'existent plus en base, l'historique les relit ici (2026-10-07).
 */
function VersionCorrection({
  version,
  retirees,
  afficherDescription,
}: {
  version: VersionDemande;
  retirees: LigneVersion[];
  afficherDescription: boolean;
}) {
  return (
    <div className="mt-1 space-y-2" data-version-tour={version.tour}>
      <p className="text-foreground">
        Tour {version.tour} — {version.montant.toLocaleString("fr-FR")} FCFA
        {version.rejet?.niveau ? (
          <>
            {" "}— rejetée par {NIVEAU_REJET[version.rejet.niveau] ?? version.rejet.niveau}
            {version.rejet.motif ? <> (motif : {version.rejet.motif})</> : null}
          </>
        ) : null}
      </p>
      {afficherDescription ? <p className="text-xs text-muted-foreground">Motif de l&apos;achat : {version.description}</p> : null}
      {version.lignes.length > 0 ? (
        <ul className="space-y-1 rounded-md bg-muted p-2">
          {version.lignes.map((l) => (
            <li key={l.id} className="text-xs text-foreground">
              <span className="font-medium">{l.libelle}</span> — {l.quantite} × {l.prixUnitaire.toLocaleString("fr-FR")} FCFA ·{" "}
              <DecisionLigne ligne={l} />
            </li>
          ))}
        </ul>
      ) : null}
      {retirees.length > 0 ? (
        <div className="rounded-md border border-dashed border-danger p-2" data-lignes-retirees>
          <p className="text-xs font-semibold uppercase tracking-wide text-danger">Lignes retirées à cette correction</p>
          <ul className="mt-1 space-y-1">
            {retirees.map((l) => (
              <li key={l.id} className="text-xs text-foreground">
                <span className="font-medium line-through">{l.libelle}</span> — {l.quantite} ×{" "}
                {l.prixUnitaire.toLocaleString("fr-FR")} FCFA · décision : <DecisionLigne ligne={l} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function labelForAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Actions de gestion strictement internes à Finance (Catégorie/Objet
 * assignés, description corrigée) — voir CLAUDE.md "Masquer Catégorie/
 * Objet côté historique Collaborateur" : jamais montrées au Collaborateur
 * créateur, même indirectement via l'historique (révéleraient la
 * catégorie/l'objet, ou qu'une modification de description a eu lieu et
 * son ancien contenu, contredisant le choix de ne lui montrer que la
 * version originale). `modification_libelle_ligne` rejoint ce même
 * principe (Tâche "Validation ligne par ligne", voir CLAUDE.md) : révèle
 * l'ancien libellé d'une ligne, alors que le Collaborateur ne doit voir que
 * `libelleOriginal`. **`validation_ligne`/`rejet_ligne` restent
 * volontairement VISIBLES** au Collaborateur (contrairement au reste de
 * cette liste) : la Tâche 4 lui montre déjà, directement sur le tableau des
 * articles, le statut de décision de chaque ligne — les masquer ici
 * créerait une incohérence entre le tableau et l'historique, jamais
 * recherchée pour cette décision précise (à la différence de la
 * catégorisation/description, qui restent, elles, de la gestion interne).
 * `categorisation_ligne` (Tâche "Catégorisation par ligne") rejoint la
 * gestion interne pour la même raison exacte que `CATEGORISER` : la
 * Catégorie/l'Objet d'une ligne ne sont jamais montrés au Collaborateur,
 * même indirectement via l'historique. */
const ACTIONS_GESTION_INTERNE = new Set([
  "CATEGORISER",
  "modification_description",
  "modification_libelle_ligne",
  "categorisation_ligne",
  "retour_exceptionnel_saisie",
  "retour_exceptionnel_rejete",
]);

/**
 * Historique générique d'une Demande, basé sur `HistoriqueEntry`
 * (`entity: "Demande"`). Server Component autonome : ne prend que l'id de
 * la demande, effectue lui-même la requête — s'utilise depuis n'importe
 * quelle page qui affiche une demande, pas seulement l'écran Finance.
 *
 * **`masquerGestionInterne`** (défaut `false`) — exclut les entrées de
 * `ACTIONS_GESTION_INTERNE` : à passer `true` uniquement depuis l'écran
 * Collaborateur (`treso/demandes/[id]/page.tsx`), jamais depuis l'écran
 * Finance.
 *
 * Exemple :
 *   <DemandeHistorique demandeId={demande.id} />
 */
export async function DemandeHistorique({
  demandeId,
  masquerGestionInterne = false,
}: {
  demandeId: string;
  masquerGestionInterne?: boolean;
}) {
  // Tâche "Validation ligne par ligne" (voir CLAUDE.md) : les entrées
  // `validation_ligne`/`rejet_ligne`/`modification_libelle_ligne` portent
  // `entity: "LigneDemande"` et `entityId: <ligneId>`, jamais `entityId:
  // demandeId` — il faut donc d'abord connaître les lignes de CETTE
  // demande pour les inclure dans le même historique fusionné.
  const lignes = await prisma.ligneDemande.findMany({ where: { demandeId }, select: { id: true } });
  const idsActuels = lignes.map((ligne) => ligne.id);
  const filtreAction = masquerGestionInterne ? { action: { notIn: Array.from(ACTIONS_GESTION_INTERNE) } } : {};

  const entreesDemande = await prisma.historiqueEntry.findMany({
    where: { entity: "Demande", entityId: demandeId, ...filtreAction },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  // Circuit (2026-10-07) : une ligne retirée pendant une correction n'existe plus en base ; elle reste lisible dans la
  // version recopiée (`correction_demande`), et ses propres entrées (validation/rejet) restent dans l'historique.
  const versions = entreesDemande
    .filter((e) => e.action === "correction_demande")
    .map((e) => ({ id: e.id, version: lireVersionCorrection(e.detail) }))
    .filter((x): x is { id: string; version: VersionDemande } => x.version !== null);
  const retireesParVersion = lignesRetireesParCorrection(
    versions.map((x) => x.version),
    idsActuels
  );
  const versionParEntree = new Map(versions.map((x, i) => [x.id, { version: x.version, retirees: retireesParVersion[i] }]));
  const ligneIds = Array.from(new Set([...idsActuels, ...versions.flatMap((x) => x.version.lignes.map((l) => l.id))]));

  const entreesLignes =
    ligneIds.length > 0
      ? await prisma.historiqueEntry.findMany({
          where: { entity: "LigneDemande", entityId: { in: ligneIds }, ...filtreAction },
          include: { user: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const entries = [...entreesDemande, ...entreesLignes].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Historique</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun évènement enregistré pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="font-medium text-foreground">{labelForAction(entry.action)}</p>
              <p className="text-xs text-muted-foreground">
                {entry.user.fullName} — {entry.createdAt.toLocaleString("fr-FR")}
              </p>
              {(() => {
                const versionCorrection = versionParEntree.get(entry.id);
                if (versionCorrection) {
                  return (
                    <VersionCorrection
                      version={versionCorrection.version}
                      retirees={versionCorrection.retirees}
                      afficherDescription={!masquerGestionInterne}
                    />
                  );
                }
                const correction = parseCorrectionDetail(entry.detail);
                if (!correction) return entry.detail ? <p className="mt-1 text-foreground">{entry.detail}</p> : null;
                return (
                  <div className="mt-1 space-y-2">
                    <p className="text-foreground">{correction.resume}</p>
                    {correction.signalement ? (
                      <p className="text-xs text-muted-foreground">Signalement : {correction.signalement}</p>
                    ) : null}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <ListeLignes titre="Avant" lignes={correction.avant} />
                      <ListeLignes titre="Après" lignes={correction.apres} />
                    </div>
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
