"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { enregistrerPointageAction } from "./actions";
import { useGeolocation } from "@/hooks/useGeolocation";

export function PointageForm({
  type,
  source,
}: {
  type: "ARRIVEE" | "DEPART";
  source: "QR_CODE" | "ORDINATEUR";
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { position, error, loading, requestPosition } = useGeolocation();
  const [needsGeo, setNeedsGeo] = useState(false);
  const [motif, setMotif] = useState("");

  const submitPointage = () => {
    startTransition(async () => {
      const result = await enregistrerPointageAction({
        source,
        type,
        motif,
        // Si une position GPS est disponible, on l'envoie pour le fallback
        geoLatitude: position?.latitude,
        geoLongitude: position?.longitude,
        geoPrecision: position?.accuracy,
      });
      if (result.status === "success") {
        toast.success("Pointage enregistré avec succès");
        router.refresh();
      } else if (result.status === "error" && result.message === "GEOLOCATION_REQUIRED") {
        setNeedsGeo(true);
      } else if (result.status === "error") {
        toast.error(result.message || "Erreur de pointage");
      }
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitPointage();
  };

  // Auto-validation lorsque la position GPS est acquise suite à une demande
  useEffect(() => {
    if (needsGeo && position && !isPending) {
      submitPointage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea
        name="motif"
        label="Motif (obligatoire)"
        required
        rows={4}
        placeholder="Veuillez renseigner votre justification détaillée..."
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        disabled={isPending || (needsGeo && loading)}
      />

      {needsGeo && !position && (
        <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
          <p className="text-sm text-primary/80 font-medium text-center">
            Réseau Wi-Fi non détecté. Géolocalisation requise.
          </p>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button 
            type="button" 
            variant="secondary" 
            className="w-full" 
            onClick={requestPosition} 
            loading={loading}
          >
            {loading ? "Recherche du signal GPS..." : "Autoriser la localisation"}
          </Button>
        </div>
      )}

      {position && needsGeo && (
        <div className="p-3 text-center text-sm font-medium text-green-600 bg-green-50 border border-green-200 rounded-lg">
          Position GPS acquise. Validation en cours...
        </div>
      )}

      {!needsGeo && (
        <Button 
          type="submit" 
          loading={isPending} 
          className="w-full"
        >
          Valider mon {type === "ARRIVEE" ? "arrivée" : "départ"}
        </Button>
      )}
    </form>
  );
}