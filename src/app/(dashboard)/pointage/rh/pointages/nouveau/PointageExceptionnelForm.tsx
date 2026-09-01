"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { enregistrerPointageRHAction } from "./actions";

interface UserOption {
  id: string;
  fullName: string;
  service: string | null;
}

interface PointageExceptionnelFormProps {
  users: UserOption[];
}

export function PointageExceptionnelForm({ users }: PointageExceptionnelFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    collaborateurId: "",
    type: "ARRIVEE" as "ARRIVEE" | "DEPART",
    heure: "",
    motif: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!formData.collaborateurId) {
      setError("Veuillez sélectionner un collaborateur.");
      return;
    }
    if (!formData.heure) {
      setError("Veuillez spécifier l'heure du pointage.");
      return;
    }
    if (!formData.motif || formData.motif.length < 3) {
      setError("Un motif d'au moins 3 caractères est obligatoire.");
      return;
    }

    startTransition(async () => {
      const result = await enregistrerPointageRHAction({
        collaborateurId: formData.collaborateurId,
        type: formData.type,
        heure: formData.heure,
        motif: formData.motif,
      });

      if (result.status === "error") {
        setError(result.message || "Une erreur est survenue.");
      } else if (result.status === "success") {
        setSuccess(result.message || "Pointage enregistré avec succès.");
        setTimeout(() => {
          setFormData({
            collaborateurId: "",
            type: "ARRIVEE",
            heure: "",
            motif: "",
          });
          router.push("/pointage/rh/pointages");
        }, 2000);
      }
    });
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900">Saisir un pointage exceptionnel</h2>
        <p className="text-sm text-slate-500 mt-1">
          Enregistrez un pointage à la place d&apos;un collaborateur (oubli, problème technique, etc.).
          Cette action sera tracée et visible dans l&apos;historique du collaborateur.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-red-900 border border-red-200">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-emerald-900 border border-emerald-200">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div className="text-sm font-medium">{success}</div>
          </div>
        )}

        <Select
          label="Collaborateur"
          required
          value={formData.collaborateurId}
          onChange={(e) => setFormData({ ...formData, collaborateurId: e.target.value })}
          placeholder="Sélectionnez un collaborateur"
          options={users.map(u => ({
            value: u.id,
            label: `${u.fullName} ${u.service ? `(${u.service})` : ""}`
          }))}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Type de pointage"
            required
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as "ARRIVEE" | "DEPART" })}
            options={[
              { value: "ARRIVEE", label: "Arrivée" },
              { value: "DEPART", label: "Départ" }
            ]}
          />

          <Input
            label="Date et Heure réelle"
            required
            type="datetime-local"
            value={formData.heure}
            onChange={(e) => setFormData({ ...formData, heure: e.target.value })}
          />
        </div>

        <Textarea
          label="Motif de la saisie manuelle"
          required
          placeholder="Ex: Oubli de pointage à l'arrivée, badge non fonctionnel, etc."
          value={formData.motif}
          onChange={(e) => setFormData({ ...formData, motif: e.target.value })}
          rows={3}
        />

        <div className="flex justify-end gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Enregistrement..." : "Enregistrer le pointage"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
