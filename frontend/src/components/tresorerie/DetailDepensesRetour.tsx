import { estFicheRegularisation, estLigneReste, prisma, refusExecutionPropreDemande, totauxDetailRetour } from "backend";

import { DepenseLigneEdition } from "@/app/(dashboard)/treso/finance/retours/[id]/DepenseLigneEdition";
import { DetaillerResteBouton } from "@/app/(dashboard)/treso/finance/retours/[id]/DetaillerResteBouton";
import { JustifierApresReception } from "@/app/(dashboard)/treso/finance/retours/[id]/JustifierApresReception";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Détail des dépenses d'un retour de caisse côté Finance (2026-10-10) — UN SEUL composant pour l'écran du retour et la
 * Régularisation de la demande : totaux (remis, détaillé, reste, sans pièce formelle, retourné), lignes modifiables
 * (« Modifier »), reste calculé « Dépenses non détaillées » (ou reste à rendre d'une fiche de régularisation) avec
 * « Détailler ». L'Assistant Finance (`treso.receptionner_retour`) agit tant que la demande n'est pas clôturée
 * (réouverture exceptionnelle : règle existante), hors conflit d'intérêts (garde 8) — ni la réception du retour ni un
 * signalement ne conditionnent plus la correction. Les autres comptes le lisent seulement.
 */
export async function DetailDepensesRetour({
  retourId,
  canReceptionner,
  userId,
}: {
  retourId: string;
  canReceptionner: boolean;
  userId: string | null;
}) {
  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: {
      reglement: { include: { demande: true } },
      depenses: { include: { pieceJointe: true, motifNonJustifiePar: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!retour) return null;
  const demande = retour.reglement.demande;
  const fiche = estFicheRegularisation({ ...retour, mode: retour.reglement.mode });
  const clotureeSansException = demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle;
  const conflit = userId ? refusExecutionPropreDemande(demande, userId) : null;
  const peutAgir = canReceptionner && !clotureeSansException && !conflit;
  const lignes = retour.depenses.filter((d) => !estLigneReste(d));
  const totaux = totauxDetailRetour({
    montantRegle: Number(retour.reglement.montant),
    fiche,
    estReceptionne: retour.estReceptionne,
    montantARetourner: Number(retour.montantARetourner),
    lignes: retour.depenses.map((d) => ({ montant: Number(d.montant), reste: estLigneReste(d), sansPiece: d.justification === "SANS_PIECE" })),
  });

  return (
    <div data-detail-depenses={retour.id} className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-5">
        <Total libelle="Remis" valeur={totaux.remis} />
        <Total libelle="Détaillé" valeur={totaux.detaille} />
        <Total libelle={fiche ? "Reste à rendre" : "Reste non détaillé"} valeur={totaux.reste} attention={totaux.reste > 0} />
        <Total libelle="Sans pièce formelle" valeur={totaux.nonJustifie} attention={totaux.nonJustifie > 0} />
        <Total libelle="Retourné" valeur={totaux.retourne} />
      </dl>

      {lignes.length === 0 && totaux.reste <= 0 ? (
        <p className="text-sm text-muted-foreground">Aucune dépense détaillée.</p>
      ) : null}
      <ul className="space-y-3">
        {lignes.map((d) => (
          <li key={d.id} data-depense={d.objet} className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {d.objet} — {fcfa(Number(d.montant))}
              </span>
              <span className="text-xs text-muted-foreground">
                {d.date.toLocaleDateString("fr-FR")} · {d.justification === "SANS_PIECE" ? "Dépense sans pièce formelle" : "Dépense justifiée"}
              </span>
            </div>
            {d.pieceJointe ? (
              <a
                href={`/api/treso/pieces-jointes/${d.pieceJointe.id}`}
                className="inline-block text-xs text-info underline-offset-4 hover:text-primary hover:underline"
              >
                Télécharger la pièce jointe
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">Aucune pièce jointe fournie.</p>
            )}
            {d.motifNonJustifie ? (
              <p className="text-xs text-warning">
                Motif{d.motifNonJustifiePar ? ` (${d.motifNonJustifiePar.fullName})` : ""} : {d.motifNonJustifie}
              </p>
            ) : null}
            {peutAgir && retour.estReceptionne && d.justification === "SANS_PIECE" && d.motifNonJustifie ? (
              <JustifierApresReception depenseLigneId={d.id} />
            ) : null}
            {peutAgir ? (
              <DepenseLigneEdition
                depense={{
                  id: d.id,
                  libelle: d.objet,
                  montant: Number(d.montant),
                  justifiee: d.justification !== "SANS_PIECE",
                  motifNonJustifie: d.motifNonJustifie,
                  aPieceJointe: !!d.pieceJointe,
                }}
              />
            ) : null}
          </li>
        ))}
        {totaux.reste > 0 ? (
          <li data-reste className="space-y-2 rounded-lg border border-dashed border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {fiche ? "Reste à rendre par le collaborateur" : "Dépenses non détaillées"} — {fcfa(totaux.reste)}
              </span>
              <span className="text-xs text-muted-foreground">Reste calculé : se met à jour à chaque correction</span>
            </div>
            {peutAgir ? <DetaillerResteBouton retourId={retour.id} reste={totaux.reste} /> : null}
          </li>
        ) : null}
      </ul>
      {canReceptionner && conflit ? <p className="text-xs text-muted-foreground">{conflit}</p> : null}
      {canReceptionner && !conflit && clotureeSansException ? (
        <p className="text-xs text-muted-foreground">Cette demande est clôturée : le détail n&apos;est plus modifiable.</p>
      ) : null}
    </div>
  );
}

function Total({ libelle, valeur, attention = false }: { libelle: string; valeur: number; attention?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{libelle}</dt>
      <dd className={`font-bold tabular-nums ${attention ? "text-warning" : "text-foreground"}`}>{fcfa(valeur)}</dd>
    </div>
  );
}
