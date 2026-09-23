import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import { MarquerNonJustifiee } from "@/components/tresorerie/MarquerNonJustifiee";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { ReceptionnerAction } from "./ReceptionnerAction";

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
    },
  });

  if (!retour) {
    notFound();
  }

  const totalDeclare = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const montantNonJustifie = retour.depenses
    .filter((d) => d.justification === "SANS_PIECE")
    .reduce((sum, d) => sum + Number(d.montant), 0);

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

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">À retourner</dt>
            <dd className="text-sm font-semibold text-foreground">
              {Number(retour.montantARetourner).toLocaleString("fr-FR")} FCFA
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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lignes de dépenses déclarées
          </h2>
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
                      {d.date.toLocaleDateString("fr-FR")} · {JUSTIFICATION_LABEL[d.justification]}
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
                    <p className="text-xs text-muted-foreground">Aucune pièce jointe.</p>
                  )}
                  {!retour.estReceptionne ? (
                    <MarquerNonJustifiee
                      depense={{
                        id: d.id,
                        motifNonJustifie: d.motifNonJustifie,
                        motifNonJustifiePar: d.motifNonJustifiePar?.fullName ?? null,
                      }}
                      disabled={!canReceptionner}
                    />
                  ) : d.motifNonJustifie ? (
                    <p className="text-xs text-warning">
                      Motif Finance{d.motifNonJustifiePar ? ` (${d.motifNonJustifiePar.fullName})` : ""} :{" "}
                      {d.motifNonJustifie}
                    </p>
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
