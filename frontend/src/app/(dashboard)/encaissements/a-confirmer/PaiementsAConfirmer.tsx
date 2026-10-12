"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Input } from "@/components/ui";

import { nonRecuAction, nonRecuLotAction, recuAction, recuLotAction, type ResultatLot } from "./actions";

export interface PaiementAConfirmerRow {
  id: string;
  paiementId: string;
  contratId: string;
  numPolice: string;
  client: string | null;
  partenaire: string | null;
  branche: string;
  datePaiement: string;
  mode: string;
  reference: string | null;
  /** Montant brut (centimes), pour le total de la sélection. */
  montant: string;
  montantAffiche: string;
  resteDu: string;
  /** Le montant dépasse le reste dû actuel de la police : la confirmation demandera un accord explicite. */
  tropPercuPossible: boolean;
  source: string;
  nonRecu: { motif: string; par: string; le: string } | null;
}

const MOTIF_MIN = 3;
const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;

/**
 * Liste F5 (commit 6b). Ligne : « Reçu » (ou « Finalement reçu » pour un non reçu), « Non reçu » avec motif. Lot :
 * cases, case d'en-tête, puis confirmation explicite avant d'appliquer. Un trop-perçu n'est jamais confirmé en lot
 * (D30) : le serveur l'écarte et il se confirme ligne par ligne, après accord explicite.
 */
export function PaiementsAConfirmer({ rows, statut }: { rows: PaiementAConfirmerRow[]; statut: "A_CONFIRMER" | "NON_RECU" }) {
  const nonRecus = statut === "NON_RECU";
  const verbeRecu = nonRecus ? "Finalement reçu" : "Reçu";
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lot, setLot] = useState<null | "recu" | "nonRecu">(null);
  const [motifLot, setMotifLot] = useState("");
  const [isPending, startTransition] = useTransition();

  const choisis = rows.filter((r) => selection.has(r.id));
  const totalSelection = useMemo(() => choisis.reduce((s, r) => s + Number(r.montant), 0), [choisis]);
  const tous = rows.length > 0 && choisis.length === rows.length;

  function basculer(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function appliquerLot() {
    const ids = choisis.map((r) => r.id);
    startTransition(async () => {
      const r: ResultatLot = lot === "nonRecu" ? await nonRecuLotAction(ids, motifLot) : await recuLotAction(ids);
      if (r.status === "error") {
        toast.error(r.message);
        return;
      }
      (r.bilan.traites.length > 0 ? toast.success : toast.info)(r.message);
      for (const t of r.bilan.tropPercus) toast.warning(`${t.paiementId} : trop-perçu de ${fcfa(Number(t.tropPercu))}, à confirmer sur sa ligne.`);
      setSelection(new Set());
      setLot(null);
      setMotifLot("");
    });
  }

  return (
    <div className="space-y-3">
      {choisis.length > 0 ? (
        <div data-barre-lot className="sticky top-2 z-10 space-y-2 rounded-xl border border-primary/30 bg-surface p-3 shadow-elevated">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              <span className="font-bold">{choisis.length}</span> sélectionné(s) — <span className="font-bold tabular-nums">{fcfa(totalSelection)}</span>
            </p>
            <Button type="button" disabled={isPending} onClick={() => setLot("recu")}>
              {verbeRecu} pour la sélection
            </Button>
            {!nonRecus ? (
              <Button type="button" variant="danger" disabled={isPending} onClick={() => setLot("nonRecu")}>
                Non reçu pour la sélection
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setSelection(new Set())}>
              Tout désélectionner
            </Button>
          </div>
          {lot ? (
            <div role="alertdialog" aria-label="Confirmer le lot" className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-sm text-foreground">
                {lot === "recu"
                  ? `Marquer « ${verbeRecu} » ${choisis.length} paiement(s) pour ${fcfa(totalSelection)} ? Les montants seront figés. Un trop-perçu éventuel sera écarté, à confirmer sur sa ligne.`
                  : `Marquer « Non reçu » ${choisis.length} paiement(s) pour ${fcfa(totalSelection)} ? Rien ne comptera pour ces paiements.`}
              </p>
              {lot === "nonRecu" ? (
                <Input
                  label="Motif (pour tous les paiements sélectionnés)"
                  value={motifLot}
                  onChange={(e) => setMotifLot(e.target.value)}
                  error={motifLot.length > 0 && motifLot.trim().length < MOTIF_MIN ? `${MOTIF_MIN} caractères minimum.` : undefined}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={lot === "nonRecu" ? "danger" : "primary"}
                  loading={isPending}
                  disabled={lot === "nonRecu" && motifLot.trim().length < MOTIF_MIN}
                  onClick={appliquerLot}
                >
                  Confirmer
                </Button>
                <Button type="button" variant="secondary" disabled={isPending} onClick={() => setLot(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-elevated">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner sur cette page"
                  checked={tous}
                  onChange={() => setSelection(tous ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className="px-3 py-2">Paiement</th>
              <th className="px-3 py-2">Police</th>
              <th className="px-3 py-2">Payé le · mode · référence</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-right">Reste dû</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <Ligne key={r.id} row={r} coche={selection.has(r.id)} onCocher={() => basculer(r.id)} verbeRecu={verbeRecu} nonRecus={nonRecus} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Ligne({
  row,
  coche,
  onCocher,
  verbeRecu,
  nonRecus,
}: {
  row: PaiementAConfirmerRow;
  coche: boolean;
  onCocher: () => void;
  verbeRecu: string;
  nonRecus: boolean;
}) {
  const [mode, setMode] = useState<null | "nonRecu" | "tropPercu">(null);
  const [motif, setMotif] = useState("");
  const [messageTrop, setMessageTrop] = useState("");
  const [isPending, startTransition] = useTransition();

  function recu(accepter: boolean) {
    startTransition(async () => {
      const r = await recuAction(row.id, accepter);
      if (r.status === "trop_percu") {
        setMessageTrop(r.message);
        setMode("tropPercu");
      } else if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        setMode(null);
      }
    });
  }
  function nonRecu() {
    startTransition(async () => {
      const r = await nonRecuAction(row.id, motif);
      if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        setMode(null);
      }
    });
  }

  return (
    <>
      <tr data-paiement={row.paiementId} className="align-top">
        <td className="px-3 py-2">
          <input type="checkbox" aria-label={`Sélectionner ${row.paiementId}`} checked={coche} onChange={onCocher} />
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className="font-medium tabular-nums">{row.paiementId}</span>
          <span className="block text-xs text-muted-foreground">{row.source}</span>
        </td>
        <td className="px-3 py-2">
          <Link href={`/encaissements/contrats/${row.contratId}`} className="whitespace-nowrap font-medium text-primary hover:underline">
            {row.numPolice}
          </Link>
          <span className="block text-xs text-muted-foreground">
            {[row.client, row.partenaire, row.branche].filter(Boolean).join(" · ")}
          </span>
        </td>
        <td className="px-3 py-2">
          <span className="whitespace-nowrap">
            {row.datePaiement} · {row.mode}
          </span>
          <span className="block break-all text-xs text-muted-foreground">{row.reference ?? "Sans référence"}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{row.montantAffiche}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
          {row.resteDu}
          {row.tropPercuPossible ? (
            <span className="mt-1 block">
              <Badge variant="warning">Trop-perçu possible</Badge>
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2">
          {row.nonRecu ? (
            <p className="mb-2 max-w-[180px] text-xs text-danger">
              Non reçu : {row.nonRecu.motif}
              <span className="block text-muted-foreground">
                {row.nonRecu.par}, {row.nonRecu.le}
              </span>
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Button type="button" loading={isPending && mode === null} disabled={mode !== null} onClick={() => recu(false)}>
              {verbeRecu}
            </Button>
            {!nonRecus ? (
              <Button type="button" variant="danger" disabled={isPending || mode !== null} onClick={() => setMode("nonRecu")}>
                Non reçu
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {/* Motif du « Non reçu » ou accord explicite d'un trop-perçu : sur toute la largeur, sous le paiement. */}
      {mode !== null ? (
        <tr data-panneau={row.paiementId}>
          <td colSpan={7} className="bg-muted/40 px-3 py-3">
            {mode === "nonRecu" ? (
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-[260px] flex-1">
                  <Input
                    aria-label={`Motif du non reçu de ${row.paiementId}`}
                    placeholder="Motif (ex. absent du relevé Wave)"
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    error={motif.length > 0 && motif.trim().length < MOTIF_MIN ? `${MOTIF_MIN} caractères minimum.` : undefined}
                  />
                </div>
                <Button type="button" variant="danger" loading={isPending} disabled={motif.trim().length < MOTIF_MIN} onClick={nonRecu}>
                  Confirmer « Non reçu »
                </Button>
                <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode(null)}>
                  Annuler
                </Button>
              </div>
            ) : (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-warning-bg p-2 text-sm text-warning">
                <p className="min-w-[260px] flex-1">{messageTrop}</p>
                <Button type="button" loading={isPending} onClick={() => recu(true)}>
                  Confirmer le trop-perçu
                </Button>
                <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode(null)}>
                  Annuler
                </Button>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
