"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { reinitialiserAction } from "./actions";

const MOT_CONFIRMATION = "REINITIALISER";

export function ReinitialisationForm() {
  const router = useRouter();
  const [empreinte, setEmpreinte] = useState<string | null>(null);
  const [generation, setGeneration] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resultat, setResultat] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function genererSauvegarde() {
    setGeneration(true);
    try {
      const reponse = await fetch("/api/systeme/reinitialisation/sauvegarde", { cache: "no-store" });
      if (!reponse.ok) {
        toast.error(await reponse.text());
        return;
      }
      const hash = reponse.headers.get("X-Backup-Sha256");
      const disposition = reponse.headers.get("Content-Disposition") ?? "";
      const nom = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "sauvegarde-avant-reinitialisation.json";
      const blob = await reponse.blob();
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nom;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(url);
      if (!hash) {
        toast.error("Empreinte de sauvegarde manquante : réessayez.");
        return;
      }
      setEmpreinte(hash);
      toast.success("Sauvegarde générée et téléchargée.");
    } finally {
      setGeneration(false);
    }
  }

  const peutReinitialiser = empreinte !== null && confirmation === MOT_CONFIRMATION;

  function reinitialiser() {
    if (!empreinte) return;
    startTransition(async () => {
      const r = await reinitialiserAction(confirmation, empreinte);
      if (r.status === "success") {
        setResultat(r.message);
        toast.success("Réinitialisation effectuée.");
        router.refresh();
      } else {
        toast.error(r.message);
        if (r.message.includes("sauvegarde")) setEmpreinte(null);
      }
    });
  }

  if (resultat) {
    return <p className="rounded-md bg-success-bg px-3 py-3 text-sm text-success">{resultat}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-bg p-4 text-sm text-danger">
        <p className="font-semibold">Action irréversible, utilisable une seule fois.</p>
        <p>
          Supprimés : demandes, règlements, retours (caisse, exceptionnels, externes), remboursements, journaux de caisse
          et de banque, pièces jointes (et leurs fichiers), pointages, corrections, absences, plages d&apos;absence
          autorisées, feedbacks, et les notifications et historiques liés. Conservés : comptes, rôles, permissions,
          catégories, horaires, jours fériés, jetons de notification, audit d&apos;administration.
        </p>
        <p>
          La sauvegarde JSON contient les lignes supprimées mais <strong>pas les fichiers de uploads/</strong> : copiez ce
          dossier à la main si vous voulez pouvoir restaurer les pièces jointes.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-foreground">Étape 1 — Sauvegarde</h2>
        <Button type="button" loading={generation} disabled={generation || isPending} onClick={genererSauvegarde}>
          {empreinte ? "Régénérer la sauvegarde" : "Générer et télécharger la sauvegarde"}
        </Button>
        {empreinte ? (
          <p className="text-xs text-success">
            Sauvegarde téléchargée (empreinte {empreinte.slice(0, 16)}…). La purge vérifiera que les données n&apos;ont pas
            changé depuis.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Obligatoire avant la réinitialisation.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-foreground">Étape 2 — Confirmation</h2>
        <Input
          label={`Tapez ${MOT_CONFIRMATION} pour confirmer`}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={empreinte === null}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="danger"
          loading={isPending}
          disabled={!peutReinitialiser || isPending}
          onClick={reinitialiser}
        >
          Réinitialiser définitivement
        </Button>
      </section>
    </div>
  );
}
