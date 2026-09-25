import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { etatRetourAffiche } from "@/lib/retourAffichage";
import { getCouvertureRetoursPostCloture, prisma } from "backend";

import { DetaillerDepensesForm } from "./DetaillerDepensesForm";
import { AjusterTotalDeclareForm } from "./AjusterTotalDeclareForm";
import { JustifierApresReception } from "./JustifierApresReception";
import { ReceptionnerAction } from "./ReceptionnerAction";
import { RegularisationSignalement, RemboursementDecision } from "./RegularisationSignalement";
import type { LigneDetailInput } from "../retourActions";

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
  // Ajustement du total déclaré : Responsable Finance UNIQUEMENT (même garde que
  // `ajusterTotalDeclareRetourAction`, revérifiée côté serveur).
  const canAjusterTotal =
    !!session &&
    hasPermission(session, "treso.valider_demande") &&
    !hasPermission(session, "treso.approuver_validation_complete");
  const canConsulterLectureSeule = !!session && hasPermission(session, "treso.valider_demande");
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

  // Même imputation des retours post-clôture que l'écran Collaborateur (source unique).
  const couverture = await getCouvertureRetoursPostCloture(retour.reglement.demandeId);
  const etatRetour = etatRetourAffiche({
    montantARetourner: Number(retour.montantARetourner),
    estReceptionne: retour.estReceptionne,
    dejaCouvertPostCloture: couverture.get(retour.id) ?? 0,
  });
  const totalDeclare = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const montantNonJustifie = retour.depenses
    .filter((d) => d.justification === "SANS_PIECE")
    .reduce((sum, d) => sum + Number(d.montant), 0);

  // Tâche "L'Assistant Finance détaille réellement le retour" (voir
  // CLAUDE.md) : le mécanisme unifié de détail reste possible tant que le
  // retour n'est pas réceptionné (comme avant) OU, une fois réceptionné,
  // UNIQUEMENT s'il existe un signalement actif du collaborateur (Tâche
  // "Signalement d'erreur par le Collaborateur") — même garde EXACTE que
  // `detaillerDepensesRetourAction` côté serveur, jamais dupliquée sous une
  // forme divergente ici (celle-ci ne sert qu'à décider l'affichage).
  const signalementActif = retour.signalements[0] ?? null;
  const cloturéeSansException = retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle;
  const bloqueParReception = retour.estReceptionne && !signalementActif;
  const peutDetailler = !cloturéeSansException && !bloqueParReception;
  const lignesInitiales: LigneDetailInput[] = retour.depenses
    .filter((d) => !(d.objet === "Dépenses non détaillées" && !d.motifNonJustifie))
    .map((d) => ({
    libelle: d.objet,
    montant: Number(d.montant),
    pieceJointeFournie: !!d.pieceJointe,
    pieceJointeUrl: undefined,
    justifiee: d.justification !== "SANS_PIECE",
    motif: d.motifNonJustifie ?? undefined,
  }));

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
                montantRecu={Number(retour.montantARetourner)}
                montantPropose={Number(signalementActif.montantPropose)}
                peutAgir={canReceptionner}
                remboursementEnAttente={retour.remboursements.some((r) => r.statut === "EN_ATTENTE_VALIDATION")}
              />
            </div>
          ) : null}
          <p className="text-xs">
            Ce signalement débloque exceptionnellement la correction du détail ci-dessous — il sera marqué résolu
            automatiquement dès l&apos;enregistrement de la correction.
          </p>
          {canAjusterTotal ? (
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
                {r.statut === "EN_ATTENTE_VALIDATION" && canAjusterTotal && r.proposeParId !== session!.user.id ? (
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
          {!retour.estReceptionne ? <ReceptionnerAction retourId={retour.id} disabled={!canReceptionner} /> : null}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lignes de dépenses déclarées
            </h2>
            {canReceptionner && !peutDetailler ? (
              <p className="text-xs text-muted-foreground">
                {cloturéeSansException
                  ? "Cette demande est clôturée : le détail n'est plus modifiable."
                  : "Ce retour est réceptionné : un signalement actif du collaborateur est nécessaire pour corriger le détail."}
              </p>
            ) : null}
          </div>
          {canReceptionner && peutDetailler ? (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-foreground">Détailler les dépenses</h3>
              <DetaillerDepensesForm
                key={JSON.stringify(lignesInitiales.map((l) => [l.libelle, l.montant, l.justifiee]))}
                retourId={retour.id}
                montantCible={totalDeclare}
                lignesInitiales={lignesInitiales}
              />
            </div>
          ) : null}
          {retour.depenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Retour intégral — aucune dépense déclarée.</p>
          ) : (
            <ul className="space-y-3">
              {retour.depenses.map((d) => (
                <li key={d.id} className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {d.objet} — {Number(d.montant).toLocaleString("fr-FR")} FCFA
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.date.toLocaleDateString("fr-FR")} · {d.justification === "SANS_PIECE" ? "Dépense sans pièce formelle" : "Dépense justifiée"}
                    </span>
                  </div>
                  {d.nature ? <p className="text-xs text-muted-foreground">{d.nature}</p> : null}
                  {d.commentaire ? <p className="text-xs text-foreground">{d.commentaire}</p> : null}
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
                  {d.justification !== "SANS_PIECE" && !d.motifNonJustifie ? (
                    <p className="text-xs text-success">Dépense justifiée.</p>
                  ) : null}
                  {d.motifNonJustifie ? (
                    <p className="text-xs text-warning">
                      Motif{d.motifNonJustifiePar ? ` (${d.motifNonJustifiePar.fullName})` : ""} : {d.motifNonJustifie}
                    </p>
                  ) : null}
                  {canReceptionner && retour.estReceptionne && !cloturéeSansException && d.justification === "SANS_PIECE" && d.motifNonJustifie ? (
                    <JustifierApresReception depenseLigneId={d.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
