"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "backend";
import {
  apercuCongeAction,
  resoumettreCongeAction,
  saisirCongeRHAction,
  soumettreCongeAction,
} from "./actions";

interface ValeursConge {
  nature: "CONGE" | "PERMISSION_EXCEPTIONNELLE";
  motif: string;
  dateDebut: string;
  dateFin: string;
}

interface ApercuConge {
  nbJoursOuvres: number;
  joursFeriesInclus: string[];
}

export function DemandeCongeForm({
  aujourdhui,
  demandeId,
  initial,
  saisieRH = false,
  salaries = [],
}: {
  aujourdhui: string;
  demandeId?: string;
  initial?: ValeursConge;
  saisieRH?: boolean;
  salaries?: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [nature, setNature] = useState<ValeursConge["nature"]>(initial?.nature ?? "CONGE");
  const [motif, setMotif] = useState(initial?.motif ?? "");
  const [dateDebut, setDateDebut] = useState(initial?.dateDebut ?? "");
  const [dateFin, setDateFin] = useState(initial?.dateFin ?? "");
  const [salarieId, setSalarieId] = useState("");
  const [erreurs, setErreurs] = useState<Partial<Record<string, string>>>({});
  const [apercu, setApercu] = useState<{
    cle: string;
    valeur: ApercuConge | null;
    erreur: string | null;
  } | null>(null);

  const cle = `${nature}|${dateDebut}|${dateFin}`;
  const formulairePret = Boolean(
    dateDebut && dateFin && motif.trim().length >= 3 && (!saisieRH || salarieId)
  );
  const apercuCourant = apercu?.cle === cle ? apercu : null;

  useEffect(() => {
    if (!formulairePret || saisieRH) return;

    let annule = false;
    const minuteur = setTimeout(async () => {
      const resultat = await apercuCongeAction({ nature, motif, dateDebut, dateFin }, demandeId);
      if (annule) return;
      if (resultat.status === "success" && resultat.data) {
        setApercu({ cle, valeur: resultat.data, erreur: null });
      } else {
        setApercu({
          cle,
          valeur: null,
          erreur: resultat.status === "error" ? resultat.message : null,
        });
      }
    }, 300);

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [cle, demandeId, dateDebut, dateFin, formulairePret, motif, nature, saisieRH]);

  const envoyer = () => {
    const entree = { nature, motif, dateDebut, dateFin };
    setErreurs({});
    demarrer(async () => {
      const resultat: ActionState<{ id: string; reference: string }> = demandeId
        ? await resoumettreCongeAction(demandeId, entree)
        : saisieRH
          ? await saisirCongeRHAction(salarieId, entree)
          : await soumettreCongeAction(entree);

      if (resultat.status === "success") {
        toast.success(resultat.message ?? "Demande enregistrée.");
        const id = resultat.data?.id;
        if (!id) {
          throw new Error("La demande a été enregistrée, mais aucun identifiant n'a été renvoyé.");
        }
        router.push(`/conges/${id}`);
        router.refresh();
      } else if (resultat.status === "error") {
        setErreurs(resultat.fieldErrors ?? {});
        toast.error(resultat.message);
      }
    });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        envoyer();
      }}
    >
      {saisieRH ? (
        <Select
          label="Salarié"
          required
          value={salarieId}
          onChange={(event) => setSalarieId(event.target.value)}
          options={salaries.map((salarie) => ({ value: salarie.id, label: salarie.fullName }))}
          placeholder="Choisir un salarié"
          error={erreurs.userId}
        />
      ) : null}

      <Select
        label="Nature de la demande"
        required
        value={nature}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "CONGE" || value === "PERMISSION_EXCEPTIONNELLE") setNature(value);
        }}
        options={[
          { value: "CONGE", label: "Congé" },
          { value: "PERMISSION_EXCEPTIONNELLE", label: "Permission exceptionnelle" },
        ]}
        error={erreurs.nature}
      />

      <Textarea
        label="Motif"
        required
        rows={4}
        maxLength={500}
        value={motif}
        onChange={(event) => setMotif(event.target.value)}
        error={erreurs.motif}
        hint="Décrivez brièvement le motif de votre demande (3 à 500 caractères)."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Date de début"
          type="date"
          required
          min={aujourdhui}
          value={dateDebut}
          onChange={(event) => setDateDebut(event.target.value)}
          error={erreurs.dateDebut}
          hint="La date du jour ou une date future."
        />
        <Input
          label="Date de fin"
          type="date"
          required
          min={dateDebut || aujourdhui}
          value={dateFin}
          onChange={(event) => setDateFin(event.target.value)}
          error={erreurs.dateFin}
        />
      </div>

      <div aria-live="polite" className="rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aperçu indicatif</p>
        {saisieRH ? (
          <p className="mt-1 text-sm text-muted-foreground">Le serveur calculera les jours ouvrés à l’enregistrement.</p>
        ) : !formulairePret ? (
          <p className="mt-1 text-sm text-muted-foreground">Renseignez le motif et les deux dates pour calculer les jours ouvrés.</p>
        ) : apercuCourant?.erreur ? (
          <p className="mt-1 text-sm text-danger">{apercuCourant.erreur}</p>
        ) : apercuCourant?.valeur ? (
          <div className="mt-1 space-y-1">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {apercuCourant.valeur.nbJoursOuvres} jour{apercuCourant.valeur.nbJoursOuvres === 1 ? "" : "s"} ouvré{apercuCourant.valeur.nbJoursOuvres === 1 ? "" : "s"}
            </p>
            {apercuCourant.valeur.joursFeriesInclus.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Jours fériés exclus : {apercuCourant.valeur.joursFeriesInclus.join(", ")}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">Décompte du lundi au vendredi, hors jours fériés. Le serveur recalcule à l&apos;envoi.</p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Calcul des jours ouvrés…</p>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        loading={enCours}
        disabled={enCours || !formulairePret}
      >
        {demandeId ? "Renvoyer la demande" : "Envoyer la demande"}
      </Button>
    </form>
  );
}
