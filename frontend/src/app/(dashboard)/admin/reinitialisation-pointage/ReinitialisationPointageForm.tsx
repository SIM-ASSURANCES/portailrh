"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { mettreEnServicePointageAction, reinitialiserPointageAction } from "./actions";

const MOT_PURGE = "REINITIALISER-POINTAGE";
const MOT_MISE_EN_SERVICE = "METTRE-EN-SERVICE-POINTAGE";

export function ReinitialisationPointageForm() {
  const router = useRouter();
  const [empreinte, setEmpreinte] = useState<string | null>(null);
  const [generation, setGeneration] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmationService, setConfirmationService] = useState("");
  const [resultat, setResultat] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function genererSauvegarde() {
    setGeneration(true);
    try {
      const reponse = await fetch("/api/admin/reinitialisation-pointage/sauvegarde", { cache: "no-store" });
      if (!reponse.ok) {
        toast.error(await reponse.text());
        return;
      }
      const hash = reponse.headers.get("X-Backup-Sha256");
      const disposition = reponse.headers.get("Content-Disposition") ?? "";
      const nom = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "sauvegarde-avant-reinitialisation-pointage.json";
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

  function purger() {
    if (!empreinte) return;
    startTransition(async () => {
      const r = await reinitialiserPointageAction(confirmation, empreinte);
      if (r.status === "success") {
        setResultat(r.message);
        setEmpreinte(null);
        setConfirmation("");
        toast.success("Purge du Pointage effectuée.");
        router.refresh();
      } else {
        toast.error(r.message);
        if (r.message.includes("sauvegarde")) setEmpreinte(null);
      }
    });
  }

  function mettreEnService() {
    startTransition(async () => {
      const r = await mettreEnServicePointageAction(confirmationService);
      if (r.status === "success") {
        toast.success(r.message);
        router.refresh();
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-bg p-4 text-sm text-danger">
        <p className="font-semibold">Action irréversible, répétable jusqu&apos;à la mise en service du Pointage.</p>
        <p>
          Supprimés : pointages, justifications, corrections, absences, plages d&apos;absence autorisées, notifications du Pointage et
          de la RH, historique du Pointage, exécutions des tâches planifiées et journal technique. Conservés : comptes, rôles,
          permissions, services et responsables, horaires, jours fériés, jetons de notification, Trésorerie, Encaissements et
          FeedbackApp.
        </p>
        <p>
          <strong>Avant la purge</strong>, réglez <code>SYSTEM_START_DATE</code> sur la date de mise en service et redéployez : sinon le
          planificateur recrée les absences des derniers jours.
        </p>
      </div>

      {resultat ? (
        <p data-resultat="purge" className="rounded-md bg-success-bg px-3 py-3 text-sm text-success">
          {resultat}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-foreground">Étape 1 — Sauvegarde</h2>
        <Button type="button" loading={generation} disabled={generation || isPending} onClick={genererSauvegarde}>
          {empreinte ? "Régénérer la sauvegarde" : "Générer et télécharger la sauvegarde"}
        </Button>
        {empreinte ? (
          <p className="text-xs text-success">
            Sauvegarde téléchargée (empreinte {empreinte.slice(0, 16)}…). La purge vérifiera que les données n&apos;ont pas changé depuis.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Obligatoire avant la purge.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-foreground">Étape 2 — Confirmation</h2>
        <Input
          label={`Tapez ${MOT_PURGE} pour confirmer`}
          name="confirmation-purge"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={empreinte === null}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="danger"
          loading={isPending}
          disabled={empreinte === null || confirmation !== MOT_PURGE || isPending}
          onClick={purger}
        >
          Purger le Pointage
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-foreground">Mettre le Pointage en service</h2>
        <p className="text-xs text-muted-foreground">
          Pose un marqueur <strong>définitif</strong> : toute purge ultérieure est refusée et cet écran n&apos;affichera plus que l&apos;audit.
        </p>
        <Input
          label={`Tapez ${MOT_MISE_EN_SERVICE} pour confirmer`}
          name="confirmation-service"
          value={confirmationService}
          onChange={(e) => setConfirmationService(e.target.value)}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="danger"
          loading={isPending}
          disabled={confirmationService !== MOT_MISE_EN_SERVICE || isPending}
          onClick={mettreEnService}
        >
          Mettre le Pointage en service
        </Button>
      </section>
    </div>
  );
}
