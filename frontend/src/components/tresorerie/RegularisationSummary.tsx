import {
  getDepenseLignesDetail,
  getDepensesDeclareesParJustification,
  getRetoursRecus,
  getTotalRegle,
} from "backend";

import { JUSTIFICATION_LABEL } from "./justification";
import { MarquerNonJustifiee } from "./MarquerNonJustifiee";

/**
 * Chiffres de régularisation d'une demande ("Fonds remis (Caisse + Banque)",
 * "Dépenses justifiées"/"Dépenses non justifiées", "Retours reçus", "Solde
 * à régulariser" — libellés renommés, voir CLAUDE.md "Renommage de
 * libellés Régularisation/Retour de caisse" puis "Distinction Fonds remis
 * (Caisse + Banque) vs Fonds remis (Caisse seule)" ; variables internes
 * `decaisse`/`ecart` volontairement inchangées) — `decaisse` =
 * `getTotalRegle`, tous modes de règlement confondus, d'où le libellé
 * précisant "(Caisse + Banque)" plutôt que le "Fonds remis" simple utilisé
 * dans le reporting/l'export Excel (ceux-là strictement Caisse, voir la
 * section CLAUDE.md ci-dessus). Server Component autonome, purement
 * informatif par défaut (aucune action) — partagé entre l'écran Finance
 * (section "Régularisation", actionnable via `ClotureActions` à côté, ou
 * en lecture seule une fois clôturée) et l'écran Collaborateur (section
 * "Situation finale"/"Mon tableau de bord", Ticket 7), pour ne jamais
 * dupliquer le calcul de l'écart ni sa mise en couleur.
 *
 * **"Dépenses effectuées" éclaté en "Dépenses justifiées"/"Dépenses non
 * justifiées"** (voir CLAUDE.md "Détail des dépenses sur l'écran de
 * Régularisation") : la somme des deux vaut toujours l'ancien montant
 * unique (`getDepensesDeclareesParJustification`, deux `aggregate` sur le
 * même périmètre que `getDepensesDeclarees`, jamais un second calcul
 * divergent de `ecart`, qui continue d'utiliser la somme des deux).
 *
 * **`canGererJustification`** (défaut `false`) — active, EN PLUS de
 * l'éclatement ci-dessus (toujours affiché, y compris côté Collaborateur),
 * le détail ligne par ligne des `DepenseLigne` de la demande (pièce
 * jointe consultable, action "Marquer non justifiée") : réservé à l'écran
 * Finance (`treso/finance/demandes/[id]/page.tsx`, permission
 * `treso.receptionner_retour` déjà revérifiée par
 * `marquerDepenseNonJustifieeAction` elle-même côté serveur) — jamais
 * transmis depuis l'écran Collaborateur (`treso/demandes/[id]/page.tsx`),
 * qui reste volontairement en lecture seule sur ses propres dépenses.
 *
 * Même convention que le "Reste à régler" de `ReglementsSection.tsx`
 * (Ticket 4) : `text-success` quand tout est justifié (solde nul),
 * `text-warning` sinon — une alerte informative, pas une erreur bloquante.
 */
export async function RegularisationSummary({
  demandeId,
  montantValide,
  title = "Régularisation",
  canGererJustification = false,
}: {
  demandeId: string;
  montantValide: number;
  title?: string;
  canGererJustification?: boolean;
}) {
  const [decaisse, depenses, retoursRecus, lignes] = await Promise.all([
    getTotalRegle(demandeId),
    getDepensesDeclareesParJustification(demandeId),
    getRetoursRecus(demandeId),
    canGererJustification ? getDepenseLignesDetail(demandeId) : Promise.resolve([]),
  ]);
  const depensesDeclarees = depenses.justifiees + depenses.nonJustifiees;
  const ecart = decaisse - depensesDeclarees - retoursRecus;

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fonds remis (Caisse + Banque)
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {decaisse.toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Retours reçus
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {retoursRecus.toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dépenses justifiées
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {depenses.justifiees.toLocaleString("fr-FR")}{" "}
            <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dépenses non justifiées
          </dt>
          <dd
            className={`mt-1 text-xl font-black tracking-tight tabular-nums ${
              depenses.nonJustifiees > 0 ? "text-warning" : "text-foreground"
            }`}
          >
            {depenses.nonJustifiees.toLocaleString("fr-FR")}{" "}
            <span className="text-sm font-bold opacity-70">FCFA</span>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Solde à régulariser</dt>
          <dd
            className={`mt-1 text-xl font-black tracking-tight tabular-nums ${ecart === 0 ? "text-success" : "text-warning"}`}
          >
            {ecart.toLocaleString("fr-FR")} <span className="text-sm font-bold opacity-70">FCFA</span>
          </dd>
        </div>
      </dl>
      {canGererJustification ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Détail des dépenses déclarées
          </h3>
          {lignes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune dépense déclarée pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-3">
              {lignes.map((ligne) => (
                <li key={ligne.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {ligne.objet} — {ligne.montant.toLocaleString("fr-FR")} FCFA
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ligne.date.toLocaleDateString("fr-FR")} · {JUSTIFICATION_LABEL[ligne.justification]}
                    </span>
                  </div>
                  {ligne.pieceJointeId ? (
                    <a
                      href={`/api/treso/pieces-jointes/${ligne.pieceJointeId}`}
                      className="inline-block text-xs text-info underline-offset-4 hover:text-primary hover:underline"
                    >
                      Voir la pièce jointe
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">Aucune pièce jointe.</p>
                  )}
                  {ligne.motifNonJustifie ? (
                    <MarquerNonJustifiee
                      depense={{
                        id: ligne.id,
                        motifNonJustifie: ligne.motifNonJustifie,
                        motifNonJustifiePar: ligne.motifNonJustifiePar,
                      }}
                    />
                  ) : ligne.retourEstReceptionne ? (
                    <p className="text-xs text-muted-foreground">
                      Retour déjà réceptionné : justification définitivement verrouillée.
                    </p>
                  ) : (
                    <MarquerNonJustifiee
                      depense={{ id: ligne.id, motifNonJustifie: null, motifNonJustifiePar: null }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <p className="border-t border-border pt-3 text-xs font-medium text-muted-foreground">
        Montant validé de la demande :{" "}
        <span className="font-bold text-foreground">{montantValide.toLocaleString("fr-FR")} FCFA</span>.
      </p>
    </div>
  );
}
