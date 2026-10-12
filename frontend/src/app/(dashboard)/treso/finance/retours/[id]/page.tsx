import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { DetailDepensesRetour } from "@/components/tresorerie/DetailDepensesRetour";
import { getSession, hasPermission } from "@/lib/auth";
import { detailMontantDefinitif, etatRetourAffiche } from "@/lib/retourAffichage";
import {
  estRetourNul,
  getCouvertureRetoursPostCloture,
  getMontantsDefinitifsRetours,
  getRecuNetSignalement,
  prisma,
  refusExecutionPropreDemande,
} from "backend";

import { AjusterTotalDeclareForm } from "./AjusterTotalDeclareForm";
import { ReceptionnerAction } from "./ReceptionnerAction";
import { RegularisationSignalement, RemboursementDecision } from "./RegularisationSignalement";

/**
 * Détail complet d'un retour de caisse (Tâche "Écran 'Voir' avant
 * 'Réceptionner'", voir CLAUDE.md) : lignes déclarées, montants, pièces
 * jointes existantes — consultable AVANT toute action, "Réceptionner"
 * n'apparaît plus que sur cet écran (jamais directement depuis la liste
 * `/treso/finance/retours`).
 *
 * Même garde d'accès que la liste (`treso.receptionner_retour` en accès
 * complet, `treso.valider_demande` en lecture seule) : un compte n'ayant
 * ni l'une ni l'autre reste redirigé, cohérent avec le reste de l'espace
 * Finance.
 *
 * Fonctionne aussi bien pour un retour d'une demande active QUE pour un
 * retour créé par l'Assistant Finance sur une demande déjà `CLOTUREE`
 * (Tâche "Réouverture exceptionnelle post-clôture" — voir CLAUDE.md) :
 * c'est `receptionnerRetourAction` elle-même qui autorise ou refuse la
 * réception selon `motifReouvertureExceptionnelle`, jamais une condition
 * dupliquée ici.
 */
export default async function RetourDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canReceptionner = !!session && hasPermission(session, "treso.receptionner_retour");
  // Mêmes permissions que `ajusterTotalDeclareRetourAction` et `validerRemboursementRetourAction` (revérifiées
  // côté serveur).
  const canAjusterTotal = !!session && hasPermission(session, "treso.ajuster_retour");
  const canValiderRemboursement = !!session && hasPermission(session, "treso.valider_remboursement");
  // Décision 10 (2026-10-08) : le DG n'a plus `treso.valider_demande` ; il consulte par `treso.voir_dashboard_finance`.
  const canConsulterLectureSeule =
    !!session &&
    (hasPermission(session, "treso.valider_demande") || hasPermission(session, "treso.voir_dashboard_finance"));
  if (!canReceptionner && !canConsulterLectureSeule) {
    redirect("/?error=acces_refuse_receptionner_retour");
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id },
    include: {
      declarant: true,
      reglement: { include: { demande: true } },
      depenses: { include: { pieceJointe: true, motifNonJustifiePar: true }, orderBy: { date: "asc" } },
      signalements: { where: { estResolu: false }, include: { signalePar: true } },
      remboursements: {
        include: { proposePar: true, validePar: true, pieceJointe: { select: { id: true } } },
        orderBy: { proposeAt: "asc" },
      },
    },
  });

  if (!retour) {
    notFound();
  }

  // Sa propre demande (demandeur ou bénéficiaire) : réception, détail, justification et remboursement grisés avec la
  // phrase que le serveur renvoie (`refusExecutionPropreDemande`, gardes 1 à 3 et 8).
  const conflitInteret = session ? refusExecutionPropreDemande(retour.reglement.demande, session.user.id) : null;
  const peutAgirRetour = canReceptionner && !conflitInteret;

  // Même imputation des retours post-clôture que l'écran Collaborateur (source unique).
  const couverture = await getCouvertureRetoursPostCloture(retour.reglement.demandeId);
  const etatRetour = etatRetourAffiche({
    montantARetourner: Number(retour.montantARetourner),
    estReceptionne: retour.estReceptionne,
    dejaCouvertPostCloture: couverture.get(retour.id) ?? 0,
  });
  // "Montant à retourner définitif" : net après compléments/remboursements liés à un signalement (n'altère pas "Retourné à la compta").
  const montantDefinitif = (await getMontantsDefinitifsRetours([retour.id])).get(retour.id);
  const totalDeclare = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const montantNonJustifie = retour.depenses
    .filter((d) => d.justification === "SANS_PIECE")
    .reduce((sum, d) => sum + Number(d.montant), 0);

  const signalementActif = retour.signalements[0] ?? null;
  // Reçu net au regard du signalement (réceptionné + compléments − remboursements) : le signalement reste actif après une
  // régularisation de caisse, jusqu'à la correction du détail.
  const recuNetSignalement = signalementActif ? await getRecuNetSignalement(retour.id, signalementActif.id) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Retour de caisse — ${retour.reglement.demande.reference}`}
        description={`Déclaré par ${retour.declarant.fullName} le ${retour.createdAt.toLocaleDateString("fr-FR")}`}
        actions={
          <Link href="/treso/finance/retours" className="text-sm text-info underline-offset-4 hover:text-primary hover:underline">
            ← Retour à la liste
          </Link>
        }
      />

      {!canReceptionner ? (
        <p className="rounded-md bg-info-bg px-3 py-2 text-sm text-info">
          Consultation en lecture seule : la réception de ce retour et le marquage des dépenses non justifiées sont
          réservés à l&apos;Assistant Finance.
        </p>
      ) : null}

      {conflitInteret && (canReceptionner || canValiderRemboursement || canAjusterTotal) ? (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning" data-conflit-interet>
          {conflitInteret}
        </p>
      ) : null}

      {signalementActif ? (
        <div className="space-y-1 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          <p className="font-semibold">
            Erreur signalée par {signalementActif.signalePar.fullName} le{" "}
            {signalementActif.signaleAt.toLocaleDateString("fr-FR")} :
          </p>
          <p>{signalementActif.commentaire}</p>
          {signalementActif.montantPropose != null ? (
            <p className="text-base font-bold">
              Montant du retour proposé par le collaborateur : {Number(signalementActif.montantPropose).toLocaleString("fr-FR")} FCFA
              <span className="ml-2 text-xs font-normal">
                (réceptionné : {Number(retour.montantARetourner).toLocaleString("fr-FR")} FCFA — information déclarative, rien n&apos;est appliqué automatiquement)
              </span>
            </p>
          ) : null}
          {retour.estReceptionne && signalementActif.montantPropose != null ? (
            <div className="pt-2">
              <RegularisationSignalement
                retourId={retour.id}
                montantRecu={recuNetSignalement}
                regulariseDeja={Math.round((recuNetSignalement - Number(retour.montantARetourner)) * 100) !== 0}
                montantPropose={Number(signalementActif.montantPropose)}
                peutAgir={peutAgirRetour}
                remboursementEnAttente={retour.remboursements.some((r) => r.statut === "EN_ATTENTE_VALIDATION")}
              />
            </div>
          ) : null}
          <p className="text-xs">
            Ce signalement débloque exceptionnellement la correction du détail ci-dessous — il sera marqué résolu
            automatiquement dès l&apos;enregistrement de la correction.
          </p>
          {canAjusterTotal && !conflitInteret ? (
            <div className="pt-2">
              <AjusterTotalDeclareForm retourId={retour.id} totalActuel={totalDeclare} />
            </div>
          ) : null}
        </div>
      ) : null}

      {retour.remboursements.length > 0 ? (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Remboursements liés à ce retour (sortie de caisse)
          </h2>
          <ul className="space-y-3">
            {retour.remboursements.map((r) => (
              <li key={r.id} className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{Number(r.montant).toLocaleString("fr-FR")} FCFA</span>
                  <Badge variant={r.statut === "VALIDE" ? "success" : r.statut === "REJETE" ? "danger" : "warning"}>
                    {r.statut === "VALIDE" ? "Validé" : r.statut === "REJETE" ? "Rejeté" : "En attente de validation"}
                  </Badge>
                </div>
                <p className="text-foreground">{r.motif}</p>
                <p className="text-xs text-muted-foreground">
                  Proposé par {r.proposePar.fullName} le {r.proposeAt.toLocaleDateString("fr-FR")}
                  {r.validePar && r.valideAt
                    ? ` — ${r.statut === "VALIDE" ? "validé" : "rejeté"} par ${r.validePar.fullName} le ${r.valideAt.toLocaleDateString("fr-FR")}`
                    : ""}
                </p>
                {r.motifRejet ? <p className="text-xs text-danger">Motif du rejet : {r.motifRejet}</p> : null}
                <a href={`/api/treso/pieces-jointes/${r.pieceJointe.id}`} className="inline-block text-xs text-info underline-offset-4 hover:text-primary hover:underline">
                  Télécharger le justificatif
                </a>
                {r.statut === "EN_ATTENTE_VALIDATION" && canValiderRemboursement && !conflitInteret && r.proposeParId !== session!.user.id ? (
                  <RemboursementDecision remboursementId={r.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {retour.signalementOrigineId ? <Badge variant="info">Retour complémentaire (suite à un signalement)</Badge> : null}
            <Badge variant={retour.estReceptionne ? "success" : "warning"}>
              {retour.estReceptionne ? "Réceptionné" : "En attente de réception"}
            </Badge>
            {retour.creeParAssistant ? <Badge variant="info">Déclaré par l&apos;Assistant Finance</Badge> : null}
            {retour.motifReouvertureExceptionnelle ? (
              <Badge variant="danger">Réouverture exceptionnelle (demande clôturée)</Badge>
            ) : null}
          </div>
          {!retour.estReceptionne ? (
            <ReceptionnerAction
              retourId={retour.id}
              disabled={!peutAgirRetour}
              raisonIndisponible={canReceptionner ? conflitInteret : null}
              retourNul={estRetourNul({ montantARetourner: Number(retour.montantARetourner), mode: retour.reglement.mode })}
            />
          ) : (
            // Reçu du retour (nul ou non) dès que l'Assistant l'a réceptionné : mêmes accès que cet écran.
            <a
              href={`/api/treso/retours/${retour.id}/recu`}
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              Télécharger le reçu du retour
            </a>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Règlement d&apos;origine</dt>
            <dd className="text-sm font-semibold text-foreground">
              {Number(retour.reglement.montant).toLocaleString("fr-FR")} FCFA ({retour.reglement.mode})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total dépensé</dt>
            <dd className="text-sm font-semibold text-foreground">{totalDeclare.toLocaleString("fr-FR")} FCFA</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{etatRetour.libelle}</dt>
            <dd className={`text-sm font-semibold ${etatRetour.estRetourne ? "text-success" : "text-foreground"}`}>
              {etatRetour.couvertParPostCloture
                ? `${Number(retour.montantARetourner).toLocaleString("fr-FR")} FCFA (couvert par un retour enregistré après la clôture)`
                : `${etatRetour.valeur.toLocaleString("fr-FR")} FCFA`}
            </dd>
          </div>
          {montantDefinitif?.aCorrection ? (
            <div className="sm:col-span-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Montant à retourner définitif</dt>
              <dd className="text-sm font-semibold text-foreground">
                {montantDefinitif.definitif.toLocaleString("fr-FR")} FCFA{" "}
                <span className="text-xs font-normal text-muted-foreground">{detailMontantDefinitif(montantDefinitif)}</span>
              </dd>
            </div>
          ) : null}
          {montantNonJustifie > 0 ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Non justifié</dt>
              <dd className="text-sm font-semibold text-warning">{montantNonJustifie.toLocaleString("fr-FR")} FCFA</dd>
            </div>
          ) : null}
          {retour.dateRetour ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Date du retour (déclaration simplifiée)
              </dt>
              <dd className="text-sm text-foreground">{retour.dateRetour.toLocaleDateString("fr-FR")}</dd>
            </div>
          ) : null}
          {retour.motifReouvertureExceptionnelle ? (
            <div className="sm:col-span-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Motif de la réouverture exceptionnelle
              </dt>
              <dd className="text-sm text-foreground">{retour.motifReouvertureExceptionnelle}</dd>
            </div>
          ) : null}
        </dl>

        <div className="space-y-3 border-t border-border pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Détail des dépenses</h2>
          {/* Même composant que la Régularisation de la demande (2026-10-10) : lignes modifiables, reste calculé avec
              « Détailler », totaux ; correction possible tant que la demande n'est pas clôturée. */}
          <DetailDepensesRetour retourId={retour.id} canReceptionner={canReceptionner} userId={session?.user.id ?? null} />
        </div>
      </div>

      {/* Même historique que la demande : saisie de départ et chaque modification (avant/après, auteur, date, motif). */}
      <DemandeHistorique demandeId={retour.reglement.demandeId} />
    </div>
  );
}
