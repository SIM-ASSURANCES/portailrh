"use client";

import { useActionState, useState, useTransition } from "react";
import { updateGeolocalisationAction, saveAdminPositionAction } from "./actions";
import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";
import type { ParametrageHoraire } from "backend";
import { toast } from "sonner";

interface Props {
  config: ParametrageHoraire | null;
}

// ── Icône GPS inline ──────────────────────────────────────────────────────────
function GpsIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" strokeOpacity={0.25} />
    </svg>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Toggle({
  name,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-4 cursor-pointer group">
      <div className="relative flex-shrink-0 mt-0.5">
        <input
          type="checkbox"
          name={name}
          value="on"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div
          className={`
            w-11 h-6 rounded-full transition-colors duration-200
            ${checked ? "bg-primary" : "bg-muted border border-border"}
            peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30
          `}
        />
        <div
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
            ${checked ? "translate-x-5" : "translate-x-0"}
          `}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  );
}

// ── Slider de rayon ──────────────────────────────────────────────────────────
function RayonSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - 30) / (200 - 30)) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Rayon autorisé autour du bureau
        </label>
        <span className="text-sm font-bold text-primary tabular-nums w-16 text-right">
          {value} m
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          name="rayonAutorise"
          min={30}
          max={200}
          step={5}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
          }}
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-muted-foreground">30m</span>
          <span className="text-[10px] text-muted-foreground">50m (défaut)</span>
          <span className="text-[10px] text-muted-foreground">200m</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Tout pointage hors réseau Wi-Fi sera refusé si le collaborateur se trouve à plus de{" "}
        <strong>{value}m</strong> du bureau.
      </p>
    </div>
  );
}

// ── Visualisation des zones ──────────────────────────────────────────────────
function ZoneVisual({ rayon }: { rayon: number }) {
  const outerR = 72;
  const innerR = Math.max(10, (rayon / 200) * outerR);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-40 h-40 flex items-center justify-center">
        {/* Zone permissive externe */}
        <div
          className="absolute rounded-full bg-primary/8 border border-primary/20 transition-all duration-300"
          style={{ width: outerR * 2, height: outerR * 2 }}
        />
        {/* Zone active (rayon configuré) */}
        <div
          className="absolute rounded-full bg-primary/20 border-2 border-primary/40 transition-all duration-300"
          style={{ width: innerR * 2, height: innerR * 2 }}
        />
        {/* Point bureau */}
        <div className="absolute w-3 h-3 rounded-full bg-primary shadow-lg ring-2 ring-primary/30 z-10" />
      </div>
      <p className="text-xs text-center text-muted-foreground leading-relaxed">
        Zone autorisée : <strong className="text-foreground">{rayon}m</strong>
        <br />
        Zone de référence : 200m
      </p>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export function GeolocalisationForm({ config }: Props) {
  const [state, formAction, isPending] = useActionState(
    updateGeolocalisationAction,
    IDLE_ACTION_STATE
  );
  useActionFeedback(state);
  const [, startTransition] = useTransition();

  const [geoActive, setGeoActive] = useState(config?.geolocalisationActive ?? false);
  const [lat, setLat] = useState<string>(
    config?.bureauLatitude?.toFixed(7) ?? "5.3628189"
  );
  const [lon, setLon] = useState<string>(
    config?.bureauLongitude?.toFixed(7) ?? "-3.9374753"
  );
  const [rayon, setRayon] = useState(config?.rayonAutorise ?? 50);
  const [captureLoading, setCaptureLoading] = useState(false);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  // Capturer la position actuelle de l'admin (pour définir le point de référence bureau)
  const handleCapturePosition = () => {
    if (!navigator.geolocation) {
      toast.error("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }
    setCaptureLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLat = pos.coords.latitude.toFixed(7);
        const newLon = pos.coords.longitude.toFixed(7);
        setLat(newLat);
        setLon(newLon);
        setCaptureLoading(false);

        // Enregistrement immédiat en base
        startTransition(async () => {
          const result = await saveAdminPositionAction(
            pos.coords.latitude,
            pos.coords.longitude
          );
          if (result.status === "success") {
            toast.success(`📍 Position bureau mise à jour : ${newLat}, ${newLon}`);
          } else if (result.status === "error") {
            toast.error(result.message || "Erreur lors de l'enregistrement.");
          }
        });
      },
      (err) => {
        setCaptureLoading(false);
        let msg = "Impossible d'obtenir votre position.";
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          msg = "Accès à la localisation refusé. Autorisez-la dans votre navigateur.";
        }
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  };

  return (
    <form action={formAction} className="space-y-8 max-w-3xl">
      {/* ── Section activation ─────────────────────────────────────────── */}
      <div className="bg-card p-6 rounded-xl border shadow-sm space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b">
          <div className="p-2 bg-primary/10 rounded-lg">
            <GpsIcon className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Pointage hors réseau</h3>
            <p className="text-xs text-muted-foreground">
              Autorise les collaborateurs à pointer via GPS quand le Wi-Fi de l&apos;entreprise n&apos;est pas disponible.
            </p>
          </div>
        </div>

        <Toggle
          name="geolocalisationActive"
          checked={geoActive}
          onChange={setGeoActive}
          label="Activer la géolocalisation comme fallback réseau"
          description="Si désactivé, tout pointage hors réseau Wi-Fi sera rejeté et une alerte sera envoyée aux RH."
        />

        {geoActive && (
          <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-4 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
            <span className="text-base leading-none mt-0.5">ℹ️</span>
            <span>
              En mode géolocalisation, le collaborateur doit se trouver dans le rayon défini ci-dessous.
              Chaque pointage GPS déclenche une notification d&apos;information aux RH avec la distance exacte.
            </span>
          </div>
        )}
      </div>

      {/* ── Section coordonnées du bureau ──────────────────────────────── */}
      <div className="bg-card p-6 rounded-xl border shadow-sm space-y-6">
        <h3 className="font-semibold text-foreground border-b pb-3">
          Coordonnées GPS du bureau
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Latitude"
            name="bureauLatitude"
            type="number"
            step="0.0000001"
            min="-90"
            max="90"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            required
            placeholder="ex: 5.3628189"
            error={fieldErrors?.bureauLatitude}
          />
          <Input
            label="Longitude"
            name="bureauLongitude"
            type="number"
            step="0.0000001"
            min="-180"
            max="180"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            required
            placeholder="ex: -3.9374753"
            error={fieldErrors?.bureauLongitude}
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          loading={captureLoading}
          onClick={handleCapturePosition}
          className="flex items-center gap-2"
        >
          <GpsIcon className="size-4" />
          Utiliser ma position actuelle comme point bureau
        </Button>
        <p className="text-xs text-muted-foreground -mt-2">
          Cliquez sur ce bouton depuis le bureau de l&apos;entreprise pour enregistrer automatiquement les coordonnées exactes.
        </p>
      </div>

      {/* ── Section rayon + visualisation ──────────────────────────────── */}
      <div className="bg-card p-6 rounded-xl border shadow-sm">
        <h3 className="font-semibold text-foreground border-b pb-3 mb-6">
          Rayon de proximité autorisé
        </h3>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
          <div className="flex-1">
            <RayonSlider value={rayon} onChange={setRayon} />
            {fieldErrors?.rayonAutorise && (
              <p className="text-xs text-destructive mt-1">{fieldErrors.rayonAutorise}</p>
            )}
          </div>
          <ZoneVisual rayon={rayon} />
        </div>
      </div>

      {/* ── Section résumé des garde-fous ──────────────────────────────── */}
      <div className="bg-card p-6 rounded-xl border shadow-sm space-y-3">
        <h3 className="font-semibold text-foreground border-b pb-3">
          Résumé des garde-fous actifs
        </h3>
        <div className="space-y-2 text-sm">
          {[
            {
              icon: "🟢",
              label: "Sur le réseau Wi-Fi",
              result: "Pointage autorisé normalement",
            },
            {
              icon: geoActive ? "📍" : "🔴",
              label: "Hors réseau, dans le périmètre GPS",
              result: geoActive
                ? `Autorisé via GPS (dans ${rayon}m) + notification RH`
                : "Bloqué + alerte RH",
            },
            {
              icon: "🚨",
              label: `Hors réseau, hors périmètre (> ${rayon}m)`,
              result: "Pointage refusé + alerte RH avec distance exacte",
            },
            {
              icon: "❌",
              label: "GPS refusé / indisponible",
              result: "Pointage impossible, message d'aide affiché",
            },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
              <span className="text-base leading-none mt-0.5 flex-shrink-0">{item.icon}</span>
              <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="text-xs font-medium text-foreground sm:text-right">{item.result}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bouton enregistrer ─────────────────────────────────────────── */}
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={isPending} className="px-8">
          Enregistrer le paramétrage
        </Button>
      </div>
    </form>
  );
}
