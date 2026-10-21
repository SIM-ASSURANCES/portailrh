"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button, Input, InputMontant } from "@/components/ui";
import { analyserMontant, libelleSeuil, texteSaisieMontant, type SeuilBudget } from "backend/client";

import { soumettreSeuilsCaisseAction } from "./actions";

/**
 * Paramétrage du budget de caisse (lot J quater). Le budget de caisse n'a AUCUN montant : c'est le solde de caisse réel (journal de caisse).
 * La Finance n'en règle que les SEUILS, en FCFA uniquement (orange, puis rouge strictement plus bas), avec une date d'effet (début jamais
 * dans le passé, fin facultative). Soumis au DG ; sans effet tant qu'il n'a pas validé ; ne modifie jamais le seuil en vigueur.
 */
export function ParametrageCaisseForm({
  aujourdhui,
  actuel,
  enAttente,
}: {
  aujourdhui: string;
  /** Seuils en vigueur (pré-remplissent le formulaire). */
  actuel: SeuilBudget | null;
  /** Un paramétrage de caisse attend déjà la décision du DG : un seul à la fois. */
  enAttente: boolean;
}) {
  const [dateDebut, setDateDebut] = useState(aujourdhui);
  const [dateFin, setDateFin] = useState("");
  const [orange, setOrange] = useState(texteSaisieMontant(actuel?.mode === "MONTANT" ? actuel.orange : 100000));
  const [rouge, setRouge] = useState(texteSaisieMontant(actuel?.mode === "MONTANT" ? actuel.rouge : 0));
  const [motif, setMotif] = useState("");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function soumettre() {
    setErreurs({});
    // Lot M : les seuils sont envoyés tels que saisis (« 100 000 »), le serveur les réanalyse ; refus clair avant l'envoi.
    const aOrange = analyserMontant(orange);
    const aRouge = analyserMontant(rouge);
    if (!aOrange.ok || !aRouge.ok) {
      setErreurs({ ...(!aOrange.ok ? { seuilOrange: aOrange.message } : {}), ...(!aRouge.ok ? { seuilRouge: aRouge.message } : {}) });
      return;
    }
    startTransition(async () => {
      const r = await soumettreSeuilsCaisseAction({
        portee: "GLOBAL",
        categorieId: null,
        montant: null,
        dateDebut,
        dateFin: dateFin || null,
        seuil: { mode: "MONTANT", orange, rouge },
      }, motif.trim());
      if (r.status === "success") {
        toast.success(r.message);
        setDateFin("");
        setMotif("");
      } else {
        setErreurs(r.erreursParIndex?.[0] ?? {});
        toast.error(r.message);
      }
    });
  }

  return (
    <form
      data-parametrage-caisse-form
      onSubmit={(e) => {
        e.preventDefault();
        soumettre();
      }}
      className="space-y-4"
    >
      <p className="text-xs text-muted-foreground">
        {actuel ? `Seuils en vigueur : ${libelleSeuil(actuel)}.` : "Aucun seuil validé : le solde s'affiche, sans alerte."}
      </p>
      {enAttente ? <p className="text-xs font-semibold text-warning">Un paramétrage de caisse attend déjà la décision du DG : attendez sa décision avant d&apos;en soumettre un autre.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="dateDebut" label="Date d'effet (début)" type="date" required min={aujourdhui} value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} disabled={enAttente} hint="Jamais dans le passé : les nouveaux seuils remplacent les anciens à cette date." error={erreurs.dateDebut} />
        <Input name="dateFin" label="Date de fin (facultative)" type="date" min={dateDebut} value={dateFin} onChange={(e) => setDateFin(e.target.value)} disabled={enAttente} hint="Vide : sans date de fin." error={erreurs.dateFin} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="caisse-orange">Seuil orange (FCFA) — solde de caisse ≤</label>
          <InputMontant id="caisse-orange" aria-label="Seuil orange (FCFA) — solde de caisse" name="orange-caisse" disabled={enAttente} value={orange} onValueChange={setOrange} />
          {erreurs.seuilOrange ? <p className="mt-1 text-xs text-danger">{erreurs.seuilOrange}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="caisse-rouge">Seuil rouge (FCFA) — solde de caisse ≤</label>
          <InputMontant id="caisse-rouge" aria-label="Seuil rouge (FCFA) — solde de caisse" name="rouge-caisse" disabled={enAttente} value={rouge} onValueChange={setRouge} />
          {erreurs.seuilRouge ? <p className="mt-1 text-xs text-danger">{erreurs.seuilRouge}</p> : null}
        </div>
      </div>
      {erreurs.seuilMode ? <p className="text-xs text-danger">{erreurs.seuilMode}</p> : null}
      <p className="text-xs text-muted-foreground">
        Le budget de caisse n&apos;est pas un montant saisi : c&apos;est le solde de caisse réel. Seuls ses seuils se règlent, en FCFA (orange puis rouge strictement plus bas).
      </p>
      <ChampMotifEchange name="motifSoumission" label="Motif de l'envoi au DG" hint="Transmis au DG avec les seuils." value={motif} onChange={setMotif} disabled={enAttente} />
      <Button signe type="submit" loading={isPending} disabled={enAttente || isPending || !motifEchangeValide(motif)} data-soumettre-caisse>
        Soumettre les seuils au DG
      </Button>
    </form>
  );
}
