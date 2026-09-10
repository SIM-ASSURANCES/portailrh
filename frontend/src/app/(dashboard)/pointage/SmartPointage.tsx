"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { PointageForm } from "./PointageForm";
import { enregistrerPointageAction, enregistrerAbsenceAutomatiqueAction } from "./actions";
import { useGeolocation } from "@/hooks/useGeolocation";

export type PointageMode = "AUTO_ARRIVEE" | "RETARD_ARRIVEE" | "AUTO_DEPART" | "ANTICIPE_DEPART" | "EN_POSTE" | "TERMINE" | "ABSENCE_AUTO";

interface Props {
  mode: PointageMode;
  messageAuto: string;
  type: "ARRIVEE" | "DEPART";
  source: "QR_CODE" | "ORDINATEUR";
}

// ─── Icône GPS ───────────────────────────────────────────────────────────────
function GeoIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" strokeOpacity={0.3} />
    </svg>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-4 h-4 border-2" : "w-8 h-8 border-4";
  return (
    <div className={`${cls} border-primary border-t-transparent rounded-full animate-spin mx-auto`} />
  );
}

// ─── Panneau Géolocalisation ─────────────────────────────────────────────────
function GeoFallbackPanel({
  onPositionValidated,
}: {
  onPositionValidated: (lat: number, lon: number, accuracy: number) => void;
}) {
  const { position, error, loading, requestPosition } = useGeolocation();

  // Dès qu'une position est obtenue, on transmet au parent
  useEffect(() => {
    if (position) {
      onPositionValidated(position.latitude, position.longitude, position.accuracy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <Spinner />
        <p className="text-sm text-muted-foreground text-center">
          Localisation en cours… Restez immobile pour améliorer la précision.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button variant="secondary" className="w-full" onClick={requestPosition}>
          Réessayer la localisation
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Vous n&apos;êtes pas connecté au réseau Wi-Fi de l&apos;entreprise. Pour pointer, nous devons
        vérifier que vous êtes bien sur site via votre GPS.
      </p>
      <Button variant="primary" className="w-full flex items-center gap-2 justify-center" onClick={requestPosition}>
        <GeoIcon className="size-4" />
        Autoriser la localisation et pointer
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Votre position ne sera utilisée que pour valider votre présence sur site.
      </p>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export function SmartPointage({ mode, messageAuto, type, source }: Props) {
  const [, startTransition] = useTransition();
  const [isDone, setIsDone] = useState(false);
  const [showEarlyForm, setShowEarlyForm] = useState(false);
  // Déclenchement du mode géolocalisation (IP rejetée)
  const [needsGeo, setNeedsGeo] = useState(false);
  // Indicateur visuel : pointage effectué via géoloc
  const [geoDistance, setGeoDistance] = useState<number | null>(null);

  const router = useRouter();
  const submittedRef = useRef<{ mode: string; type: string } | null>(null);

  // ── Fonction de pointage, appelée avec ou sans coords GPS ──────────────────
  const submitPointage = (geoPayload?: { latitude: number; longitude: number; accuracy: number }) => {
    startTransition(async () => {
      const result = await enregistrerPointageAction({
        source,
        type,
        geoLatitude: geoPayload?.latitude,
        geoLongitude: geoPayload?.longitude,
        geoPrecision: geoPayload?.accuracy,
      });

      if (result.status === "success") {
        toast.success(geoPayload ? "Pointage géolocalisé enregistré ✅" : messageAuto);
        setIsDone(true);
        setNeedsGeo(false);
        router.refresh();
      } else if (result.status === "error" && result.message === "GEOLOCATION_REQUIRED") {
        // Le serveur demande des coords GPS → afficher le panneau géoloc
        setNeedsGeo(true);
      } else if (result.status === "error") {
        toast.error(result.message || "Erreur de traitement");
        submittedRef.current = null;
      }
    });
  };

  // ── Déclenchement automatique sans friction ────────────────────────────────
  useEffect(() => {
    if (mode === "AUTO_ARRIVEE" || mode === "AUTO_DEPART" || mode === "ABSENCE_AUTO") {
      const alreadySubmitted =
        submittedRef.current?.mode === mode &&
        submittedRef.current?.type === type;

      if (!alreadySubmitted) {
        submittedRef.current = { mode, type };
        if (mode === "ABSENCE_AUTO") {
          startTransition(async () => {
            const result = await enregistrerAbsenceAutomatiqueAction();
            if (result.status === "success") {
              toast.success(messageAuto);
              setIsDone(true);
              router.refresh();
            } else if (result.status === "error") {
              toast.error(result.message || "Erreur de traitement");
              submittedRef.current = null;
            }
          });
        } else {
          submitPointage();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, messageAuto, source, type, router]);

  const [prevMode, setPrevMode] = useState(mode);
  const [prevType, setPrevType] = useState(type);

  if (mode !== prevMode || type !== prevType) {
    setPrevMode(mode);
    setPrevType(type);
    setIsDone(false);
    setNeedsGeo(false);
    setGeoDistance(null);
  }

  const isEnPoste = mode === "EN_POSTE" || (isDone && type === "ARRIVEE");

  // ── Écrans terminaux ───────────────────────────────────────────────────────
  if (mode === "TERMINE" || (isDone && type === "DEPART")) {
    return (
      <Card className="p-8 text-center animate-fade-in-up">
        <h2 className="text-xl font-bold text-primary mb-2">Pointages terminés</h2>
        <p className="text-muted-foreground">Vous avez enregistré toutes vos présences pour aujourd&apos;hui.</p>
      </Card>
    );
  }

  if (mode === "ABSENCE_AUTO" && isDone) {
    return (
      <Card className="p-8 text-center animate-fade-in-up border-destructive">
        <h2 className="text-xl font-bold text-destructive mb-2">Journée terminée</h2>
        <p className="text-muted-foreground">Vous n&apos;avez pas pointé votre arrivée à temps. Une absence a été enregistrée.</p>
      </Card>
    );
  }

  // ── En poste ───────────────────────────────────────────────────────────────
  if (isEnPoste && !showEarlyForm) {
    return (
      <Card className="p-6 text-center animate-fade-in-up">
        {geoDistance !== null && (
          <div className="flex items-center justify-center gap-1.5 mb-4 text-xs text-muted-foreground">
            <GeoIcon className="size-3.5 text-primary" />
            <span>Pointé par géolocalisation — {geoDistance}m du bureau</span>
          </div>
        )}
        <h2 className="text-xl font-bold mb-2">Vous êtes en poste</h2>
        <p className="text-muted-foreground mb-6">
          Votre arrivée a été enregistrée. L&apos;heure de fin de journée n&apos;est pas encore atteinte.
        </p>
        <Button variant="primary" className="w-full" onClick={() => setShowEarlyForm(true)}>
          Pointer mon départ anticipé
        </Button>
      </Card>
    );
  }

  // ── Analyse en cours (avant la réponse du serveur) ─────────────────────────
  if ((mode === "AUTO_ARRIVEE" || mode === "AUTO_DEPART" || mode === "ABSENCE_AUTO") && !needsGeo) {
    return (
      <Card className="p-8 text-center animate-fade-in-up">
        <h2 className="text-xl font-bold mb-4">Analyse en cours…</h2>
        <Spinner />
      </Card>
    );
  }

  // ── Panneau géolocalisation (fallback hors réseau) ─────────────────────────
  if (needsGeo) {
    return (
      <Card className="p-6 animate-fade-in-up space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <GeoIcon className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-bold">Réseau Wi-Fi non détecté</h2>
            <p className="text-xs text-muted-foreground">Pointage par géolocalisation activé</p>
          </div>
        </div>

        <GeoFallbackPanel
          onPositionValidated={(lat, lon, accuracy) => {
            setGeoDistance(null); // reset pendant l'envoi
            submitPointage({ latitude: lat, longitude: lon, accuracy });
          }}
        />
      </Card>
    );
  }

  // ── Retard / Départ anticipé (formulaire motif) ───────────────────────────
  return (
    <Card className="p-6 animate-fade-in-up">
      <h2 className="text-xl font-bold mb-2">
        {mode === "RETARD_ARRIVEE" ? "Vous êtes en retard" : "Départ anticipé"}
      </h2>
      <p className="text-muted-foreground mb-6">
        L&apos;heure réglementaire n&apos;a pas été respectée. Un motif est obligatoire pour valider votre pointage.
      </p>
      <PointageForm type={type} source={source} />
      {mode === "EN_POSTE" && showEarlyForm && (
        <Button variant="secondary" className="w-full mt-2" onClick={() => setShowEarlyForm(false)}>
          Annuler
        </Button>
      )}
    </Card>
  );
}