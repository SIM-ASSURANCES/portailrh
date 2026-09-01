"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { PointageForm } from "./PointageForm";
import { enregistrerPointageAction } from "./actions";

export type PointageMode = "AUTO_ARRIVEE" | "RETARD_ARRIVEE" | "AUTO_DEPART" | "ANTICIPE_DEPART" | "TERMINE";

interface Props {
  mode: PointageMode;
  messageAuto: string;
  type: "ARRIVEE" | "DEPART";
  source: "QR_CODE" | "ORDINATEUR";
}

export function SmartPointage({ mode, messageAuto, type, source }: Props) {
  const [, startTransition] = useTransition();
  const [isDone, setIsDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Déclenchement automatique sans friction pour les employés en règle
    if (mode === "AUTO_ARRIVEE" || mode === "AUTO_DEPART") {
      startTransition(async () => {
        const result = await enregistrerPointageAction({ source, type });
        if (result.status === "success") {
          toast.success(messageAuto);
          setIsDone(true);
          router.refresh();
        } else if (result.status === "error") {
          toast.error(result.message || "Erreur de pointage");
        }
      });
    }
  }, [mode, messageAuto, source, type, router]);

  if (mode === "TERMINE" || isDone) {
    return (
      <Card className="p-8 text-center animate-fade-in-up">
        <h2 className="text-xl font-bold text-success mb-2">Pointages terminés</h2>
        <p className="text-muted-foreground">Vous avez enregistré toutes vos présences pour aujourd&apos;hui.</p>
      </Card>
    );
  }

  if (mode === "AUTO_ARRIVEE" || mode === "AUTO_DEPART") {
    return (
      <Card className="p-8 text-center animate-fade-in-up">
        <h2 className="text-xl font-bold mb-4">Analyse en cours...</h2>
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
      </Card>
    );
  }

  // Si on arrive ici, l'utilisateur est en retard ou part trop tôt
  return (
    <Card className="p-6 animate-fade-in-up">
      <h2 className="text-xl font-bold mb-2">
        {mode === "RETARD_ARRIVEE" ? "Vous êtes en retard" : "Départ anticipé"}
      </h2>
      <p className="text-muted-foreground mb-6">
        L&apos;heure réglementaire n&apos;a pas été respectée. Un motif est obligatoire pour valider votre pointage.
      </p>
      <PointageForm type={type} source={source} />
    </Card>
  );
}