import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import {
  formatDateCourte,
  formatDateHeure,
  formatFcfa,
  formatMoisAnnee,
  libelleMode,
  etatSignalement,
  libelleSource,
  paiementLisible,
} from "@/components/encaissements/libelles";
import { SignalementsTable } from "@/components/encaissements/SignalementsTable";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { calculerSituationContrat, prisma } from "backend";

import { AjouterVersement } from "./AjouterVersement";
import { EncaissementsContratTable, type EncaissementRow } from "./EncaissementsContratTable";

const SIGNALEMENTS_MAX = 200;

/**
 * Fiche police (F2, commit 5a) — lecture seule. Encaissé et reste dû sur les seuls paiements CONFIRMÉS (§5.1,
 * décision du 2026-10-02) ; « Trop-perçu » au lieu d'un reste dû négatif. Les cadres Taxes, Commissions, Honoraires
 * et Accessoires arrivent aux lots 2 et 3.
 */
export default async function FichePolicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  const { id } = await params;

  const contrat = await prisma.encContrat.findUnique({
    where: { id },
    include: {
      branche: { select: { libelle: true } },
      partenaire: { select: { nom: true } },
      creeParImport: { select: { id: true, nomFichier: true, importeAt: true } },
      majParImport: { select: { id: true, nomFichier: true, importeAt: true } },
    },
  });
  if (!contrat) notFound();

  const [encaissements, signalements, nbSignalements] = await Promise.all([
    prisma.encEncaissement.findMany({
      where: { contratId: id },
      orderBy: [{ datePaiement: "asc" }, { paiementId: "asc" }],
      select: {
        id: true,
        paiementId: true,
        datePaiement: true,
        mode: true,
        reference: true,
        Z: true,
        source: true,
        importId: true,
        statut: true,
        dateSaisie: true,
        dateConfirmation: true,
        // Montants et exigibilité figés à la confirmation (commit 6a) ; motif d'un « non reçu ».
        datePriseEnCompte: true,
        ordrePriseEnCompte: true,
        AA: true,
        AB: true,
        AC: true,
        AD: true,
        commission: true,
        honoraires: true,
        moisExigibilite: true,
        dateLimiteReversement: true,
        estRegularisation: true,
        motifNonReception: true,
      },
    }),
    // Par contrat OU par n° de police : une ligne rejetée (annulée) n'a jamais créé de contrat mais porte la police.
    prisma.encSignalement.findMany({
      where: { OR: [{ contratId: id }, { numPolice: contrat.numPolice }] },
      orderBy: [{ niveau: "asc" }, { creeAt: "desc" }],
      take: SIGNALEMENTS_MAX,
      select: {
        id: true,
        numPolice: true,
        analyse: true,
        detail: true,
        paiementIndique: true,
        statut: true,
        traiteAt: true,
        resolution: true,
        traitePar: { select: { fullName: true } },
        branche: { select: { libelle: true } },
      },
    }),
    prisma.encSignalement.count({ where: { OR: [{ contratId: id }, { numPolice: contrat.numPolice }] } }),
  ]);

  const confirmes = encaissements.filter((e) => e.statut === "CONFIRME");
  const situation = calculerSituationContrat(
    contrat.S.toString(),
    confirmes.map((e) => e.Z.toString()),
  );
  const aConfirmer = encaissements
    .filter((e) => e.statut === "A_CONFIRMER")
    .reduce((somme, e) => somme + Number(e.Z), 0);

  // Barre des versements, en part de la prime TTC (bornée à 100 %).
  const prime = Number(contrat.S);
  const pctConfirme = prime > 0 ? Math.min(100, Math.max(0, (Number(situation.encaisse) / prime) * 100)) : 0;
  const pctAConfirmer = prime > 0 ? Math.min(100 - pctConfirme, Math.max(0, (aConfirmer / prime) * 100)) : 0;

  const rows: EncaissementRow[] = encaissements.map((e) => ({
    id: e.id,
    paiementId: e.paiementId,
    datePaiementIso: e.datePaiement.toISOString(),
    datePaiement: formatDateCourte(e.datePaiement),
    mode: libelleMode(e.mode),
    reference: e.reference,
    montant: formatFcfa(e.Z.toString()),
    source: libelleSource(e.source),
    importId: e.importId,
    statut: e.statut,
    dateSaisie: formatDateHeure(e.dateSaisie),
    dateConfirmation: e.dateConfirmation ? formatDateHeure(e.dateConfirmation) : null,
    fige:
      e.statut === "CONFIRME" && e.AB !== null
        ? {
            rang: e.ordrePriseEnCompte,
            AA: formatFcfa(e.AA?.toString()),
            AB: formatFcfa(e.AB.toString()),
            AC: formatFcfa(e.AC?.toString()),
            AD: formatFcfa(e.AD?.toString()),
            commission: formatFcfa(e.commission?.toString()),
            honoraires: formatFcfa(e.honoraires?.toString()),
            moisExigibilite: formatMoisAnnee(e.moisExigibilite),
            dateLimite: formatDateCourte(e.dateLimiteReversement),
            regularisation: e.estRegularisation
              ? `Régularisation — payé le ${formatDateCourte(e.datePaiement)}, pris en compte le ${formatDateCourte(e.datePriseEnCompte)}`
              : null,
          }
        : null,
    motifNonReception: e.motifNonReception,
  }));

  const infos: { libelle: string; valeur: ReactNode }[] = [
    { libelle: "Client", valeur: [contrat.clientNom, contrat.clientId ? `(${contrat.clientId})` : null].filter(Boolean).join(" ") || "—" },
    { libelle: "Partenaire", valeur: contrat.partenaire?.nom ?? "—" },
    { libelle: "Branche", valeur: contrat.branche.libelle },
    {
      libelle: "Produit",
      valeur: [contrat.produitLibelle, contrat.produitCode ? `(${contrat.produitCode})` : null].filter(Boolean).join(" ") || "—",
    },
    { libelle: "Type de contrat", valeur: contrat.typeContrat ?? "—" },
    { libelle: "Type d'opération", valeur: contrat.typeOperation ?? "—" },
    { libelle: "Type de police", valeur: contrat.typePolice ?? "—" },
    { libelle: "Date d'effet", valeur: formatDateCourte(contrat.dateEffet) },
    { libelle: "Date d'échéance", valeur: formatDateCourte(contrat.dateEcheance) },
    {
      libelle: "Créé par l'import",
      valeur: (
        <Link href={`/encaissements/import/${contrat.creeParImport.id}`} className="text-primary hover:underline">
          {contrat.creeParImport.nomFichier} — {formatDateHeure(contrat.creeParImport.importeAt)}
        </Link>
      ),
    },
    {
      libelle: "Dernière mise à jour par l'import",
      valeur: contrat.majParImport ? (
        <Link href={`/encaissements/import/${contrat.majParImport.id}`} className="text-primary hover:underline">
          {contrat.majParImport.nomFichier} — {formatDateHeure(contrat.majParImport.importeAt)}
        </Link>
      ) : (
        "—"
      ),
    },
  ];

  const montants: { libelle: string; valeur: string }[] = [
    { libelle: "Prime TTC", valeur: formatFcfa(contrat.S.toString()) },
    { libelle: "Prime nette", valeur: formatFcfa(contrat.T.toString()) },
    { libelle: "Accessoires", valeur: formatFcfa(contrat.U.toString()) },
    { libelle: "Taxes", valeur: formatFcfa(contrat.V.toString()) },
    { libelle: "Commission", valeur: formatFcfa(contrat.W.toString()) },
    { libelle: "Honoraires", valeur: formatFcfa(contrat.X.toString()) },
  ];

  const tropPercu = situation.tropPercu.gt(0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Police ${contrat.numPolice}`}
        description={contrat.clientNom ?? undefined}
        backHref="/encaissements"
        backLabel="Encaissements"
      />

      <section aria-label="Situation du contrat" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon="file-text" tone="neutral" label="Prime TTC" value={formatFcfa(contrat.S.toString())} />
        <StatCard
          icon="wallet"
          tone="primary"
          label="Encaissé"
          value={formatFcfa(situation.encaisse.toFixed(2))}
          hint="Paiements confirmés seulement"
        />
        {tropPercu ? (
          <StatCard icon="alert-triangle" tone="warning" label="Trop-perçu" value={formatFcfa(situation.tropPercu.toFixed(2))} />
        ) : (
          <StatCard
            icon="clock"
            tone={situation.resteDu.gt(0) ? "info" : "success"}
            label="Reste dû"
            value={formatFcfa(situation.resteDu.toFixed(2))}
          />
        )}
      </section>

      <Card className="space-y-3">
        <h2 className="text-base font-bold">Versements</h2>
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Confirmé : ${Math.round(pctConfirme)} % de la prime TTC ; à confirmer : ${Math.round(pctAConfirmer)} %`}
        >
          <div className="h-full bg-primary" style={{ width: `${pctConfirme}%` }} />
          <div className="h-full bg-primary/30" style={{ width: `${pctAConfirmer}%` }} />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden="true" />
            Confirmé : <span className="font-semibold text-foreground tabular-nums">{formatFcfa(situation.encaisse.toFixed(2))}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-primary/30" aria-hidden="true" />
            À confirmer (non compté) : <span className="font-semibold text-foreground tabular-nums">{formatFcfa(aConfirmer)}</span>
          </li>
          {tropPercu && (
            <li>
              <Badge variant="warning">Trop-perçu : {formatFcfa(situation.tropPercu.toFixed(2))}</Badge>
            </li>
          )}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="text-base font-bold">Contrat</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {infos.map((i) => (
              <div key={i.libelle}>
                <dt className="text-xs text-muted-foreground">{i.libelle}</dt>
                <dd className="font-medium">{i.valeur}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-base font-bold">Montants du fichier</h2>
          <dl className="space-y-2 text-sm">
            {montants.map((m) => (
              <div key={m.libelle} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{m.libelle}</dt>
                <dd className="font-semibold tabular-nums">{m.valeur}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Paiements ({rows.length})</h2>
        </div>
        {/* F3 (commit 6c) : saisie d'un versement, confirmé dès l'enregistrement ; le reste dû est proposé. */}
        {hasPermission(session, "enc.saisir_encaissement") ? (
          <AjouterVersement
            contratId={contrat.id}
            resteDu={situation.resteDu.gt(0) ? situation.resteDu.toFixed(2).replace(/.00$/, "") : ""}
            aujourdHui={new Date().toISOString().slice(0, 10)}
          />
        ) : null}
        <EncaissementsContratTable rows={rows} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">Signalements ({nbSignalements.toLocaleString("fr-FR")})</h2>
        {nbSignalements > SIGNALEMENTS_MAX && (
          <p className="text-xs text-muted-foreground">Les {SIGNALEMENTS_MAX} signalements les plus récents sont affichés.</p>
        )}
        <SignalementsTable
          rows={signalements.map((s) => ({
            id: s.id,
            numPolice: s.numPolice,
            analyse: s.analyse,
            branche: s.branche?.libelle ?? null,
            paiement: paiementLisible(s.paiementIndique),
            detail: s.detail,
            etat: etatSignalement(s),
          }))}
          emptyMessage="Aucun signalement pour cette police."
          afficherEtat
        />
      </section>
    </div>
  );
}
