import { calculerMontantARetournerNet, getResumeArticle, prisma, refusExecutionPropreSurReglement } from "backend";

import { ArticleTag } from "./ArticleTag";

import { DetaillerDepensesReglement } from "@/app/(dashboard)/treso/finance/demandes/[id]/DetaillerDepensesReglement";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Règlement confirmé SANS retour de caisse ni fiche (lot G ter) : tout le montant remis reste à expliquer. Affiché dans le
 * bloc « Régularisation » de l'article (Caisse comme Banque), avec « Détailler les dépenses » pour l'Assistant Finance
 * (`detaillerDepensesReglementAction` range le détail dans une fiche de régularisation). Même calcul du restant que la
 * déclaration d'un retour (`calculerMontantARetournerNet`) : un retour externe rattaché à un fonds bancaire est déjà déduit.
 */
export async function DetailReglementSansRetour({
  reglementId,
  canGerer,
  userId,
}: {
  reglementId: string;
  canGerer: boolean;
  userId: string | null;
}) {
  const reglement = await prisma.reglement.findUnique({
    where: { id: reglementId },
    include: { demande: { include: { lignes: true } } },
  });
  if (!reglement) return null;
  const [disponible, article] = await Promise.all([
    calculerMontantARetournerNet({ reglementId, totalDepensesNouvelles: 0 }),
    reglement.ligneDemandeId ? getResumeArticle(reglement.ligneDemandeId) : Promise.resolve(null),
  ]);
  const cloturee = reglement.demande.statut === "CLOTUREE";
  const conflit = userId ? refusExecutionPropreSurReglement(reglement, userId) : null;
  return (
    <div data-detailler-reglement={reglementId} className="space-y-3">
      <ArticleTag article={article} />
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-5">
        <Total libelle="Remis" valeur={Number(reglement.montant)} />
        <Total libelle="Détaillé" valeur={0} />
        <Total libelle="Reste non détaillé" valeur={disponible} attention={disponible > 0} />
        <Total libelle="Sans pièce formelle" valeur={0} />
        <Total libelle="Retourné" valeur={0} />
      </dl>
      <p className="text-sm text-muted-foreground">
        {disponible > 0
          ? `Aucun retour ni dépense détaillée pour ce règlement : ${fcfa(disponible)} restent à expliquer.`
          : "Rien à détailler : les fonds remis sont déjà expliqués."}
        {reglement.mode === "BANQUE" ? " Le retour éventuel d'un fonds versé par banque s'enregistre en « Retour externe »." : ""}
      </p>
      {canGerer && !cloturee && disponible > 0 ? (
        <DetaillerDepensesReglement reglementId={reglementId} disponible={disponible} raisonIndisponible={conflit} />
      ) : null}
      {canGerer && cloturee ? <p className="text-xs text-muted-foreground">Cette demande est clôturée : le détail n&apos;est plus modifiable.</p> : null}
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
