"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { Calendar } from "lucide-react";
import { enregistrerPointageAction, enregistrerAbsenceAutomatiqueAction } from "./actions";
import { useGeolocation } from "@/hooks/useGeolocation";

export type PointageMode = "AUTO_ARRIVEE" | "RETARD_ARRIVEE" | "AUTO_DEPART" | "ANTICIPE_DEPART" | "EN_POSTE" | "TERMINE" | "ABSENCE_AUTO" | "NON_OUVRABLE";

interface Props {
  mode: PointageMode;
  messageAuto: string;
  type: "ARRIVEE" | "DEPART";
  source: "QR_CODE" | "ORDINATEUR";
  /** Lot 3 bis : arrivée de moins de 30 min, départ possible à partir de cette heure (« HH:MM » et instant exact). */
  departPossibleA?: { heure: string; iso: string };
  /** Jour non ouvré : départ toujours par le bouton, jamais anticipé (lot 3 bis). */
  jourNonOuvre?: boolean;
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

        <details className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <summary className="font-medium text-foreground cursor-pointer select-none">
            📱 Comment autoriser la position sur smartphone ?
          </summary>
          <div className="mt-2.5 space-y-2 text-left">
            <div>
              <strong className="text-foreground">Sur Chrome (Android) :</strong>
              <p className="mt-0.5">1. Touchez l&apos;icône à gauche de la barre d&apos;adresse (icône réglages ou cadenas).</p>
              <p>2. Touchez <em>Autorisations</em> ou <em>Paramètres du site</em> puis <em>Position</em>.</p>
              <p>3. Sélectionnez <em>Autoriser</em> puis revenez sur cette page.</p>
            </div>
            <div className="pt-1 border-t border-border/50">
              <strong className="text-foreground">Sur Safari (iPhone) :</strong>
              <p className="mt-0.5">1. Touchez l&apos;icône <em>aA</em> à gauche de la barre d&apos;adresse.</p>
              <p>2. Touchez <em>Réglages du site web</em> ➔ <em>Emplacement</em> ➔ <em>Autoriser</em>.</p>
            </div>
            <p className="pt-1 text-[11px] italic text-muted-foreground/80">
              Note : En production avec un nom de domaine sécurisé (HTTPS), cette autorisation est demandée automatiquement en un seul clic.
            </p>
          </div>
        </details>

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
export function SmartPointage({ mode, messageAuto, type, source, departPossibleA, jourNonOuvre = false }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isDone, setIsDone] = useState(false);
  // Départ anticipé : jamais automatique, le collaborateur confirme explicitement (lot 3).
  const [confirmDepart, setConfirmDepart] = useState(false);
  // Déclenchement du mode géolocalisation (IP rejetée)
  const [needsGeo, setNeedsGeo] = useState(false);
  // Indicateur visuel : pointage effectué via géoloc
  const [geoDistance, setGeoDistance] = useState<number | null>(null);
  // Possibilité de forcer le pointage lors d'un jour non ouvré (présence exceptionnelle)
  const [forcePointage, setForcePointage] = useState(false);

  const router = useRouter();
  const submittedRef = useRef<{ mode: string; type: string } | null>(null);

  // Lot 3 bis : bouton de départ désactivé jusqu'à l'heure possible (arrivée + 30 min), puis réactivé sur place, sans
  // rechargement (un rechargement pourrait déclencher un départ automatique pendant que la page reste simplement ouverte).
  const [departDebloque, setDepartDebloque] = useState<string | null>(null);
  useEffect(() => {
    if (!departPossibleA) return;
    const delai = Math.max(0, new Date(departPossibleA.iso).getTime() - Date.now());
    const minuteur = setTimeout(() => setDepartDebloque(departPossibleA.iso), delai);
    return () => clearTimeout(minuteur);
  }, [departPossibleA]);
  const departEnAttente = !!departPossibleA && departDebloque !== departPossibleA.iso;

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
        // Retard, départ anticipé ou présence exceptionnelle : le message du serveur (heure, minutes de retard,
        // lien de justification à venir) ; sinon le message automatique de la page.
        const messageDuServeur = mode === "RETARD_ARRIVEE" || mode === "EN_POSTE" || forcePointage;
        toast.success(
          messageDuServeur
            ? result.message || "Pointage enregistré."
            : geoPayload
              ? "Pointage géolocalisé enregistré ✅"
              : messageAuto
        );
        setConfirmDepart(false);
        setIsDone(true);
        setNeedsGeo(false);
        router.refresh();
      } else if (result.status === "error" && result.message === "GEOLOCATION_REQUIRED") {
        // Le serveur demande des coords GPS → afficher le panneau géoloc
        setNeedsGeo(true);
      } else if (result.status === "error") {
        toast.error(result.message || "Erreur de traitement");
        submittedRef.current = null;
        setConfirmDepart(false);
      }
    });
  };

  // ── Déclenchement automatique sans friction ────────────────────────────────
  // Lot 3 : l'arrivée en retard est enregistrée automatiquement elle aussi, sans motif (justification après coup).
  useEffect(() => {
    if (mode === "AUTO_ARRIVEE" || mode === "RETARD_ARRIVEE" || mode === "AUTO_DEPART" || mode === "ABSENCE_AUTO") {
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
    setConfirmDepart(false);
  }

  const isEnPoste = mode === "EN_POSTE" || (isDone && type === "ARRIVEE");

  // ── Écrans terminaux ───────────────────────────────────────────────────────
  if (mode === "NON_OUVRABLE" && !forcePointage) {
    return (
      <Card className="p-8 text-center animate-fade-in-up space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Calendar className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-primary mb-2">Jour non ouvré</h2>
          <p className="text-muted-foreground">{messageAuto || "Aucun pointage n'est requis aujourd'hui."}</p>
        </div>
        <div className="pt-2">
          <Button variant="secondary" onClick={() => setForcePointage(true)}>
            Pointer une présence exceptionnelle
          </Button>
        </div>
      </Card>
    );
  }

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

  // ── Panneau géolocalisation (fallback hors réseau) — avant « En poste » pour le départ confirmé ──
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

  // ── En poste ───────────────────────────────────────────────────────────────
  if (isEnPoste) {
    // Le bouton n'agit qu'en mode EN_POSTE (prop `type` = DEPART) : juste après une arrivée, la page se rafraîchit.
    const departPossible = mode === "EN_POSTE";
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
          {departPossibleA || jourNonOuvre
            ? "Votre arrivée a été enregistrée."
            : "Votre arrivée a été enregistrée. L'heure de fin de journée n'est pas encore atteinte."}
        </p>
        {departEnAttente ? (
          <p
            role="status"
            data-depart-possible
            className="mb-4 rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info"
          >
            Départ possible à partir de {departPossibleA?.heure}
          </p>
        ) : null}
        {confirmDepart ? (
          <div className="space-y-3">
            <p className="font-bold">Confirmer mon départ maintenant ?</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                className="w-full"
                loading={isPending}
                onClick={() => submitPointage()}
              >
                Confirmer mon départ
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={isPending}
                onClick={() => setConfirmDepart(false)}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={!departPossible || departEnAttente}
            onClick={() => setConfirmDepart(true)}
          >
            {departPossibleA || jourNonOuvre ? "Pointer mon départ" : "Pointer mon départ anticipé"}
          </Button>
        )}
      </Card>
    );
  }

  // ── Analyse en cours (avant la réponse du serveur) ─────────────────────────
  if (mode === "AUTO_ARRIVEE" || mode === "RETARD_ARRIVEE" || mode === "AUTO_DEPART" || mode === "ABSENCE_AUTO") {
    return (
      <Card className="p-8 text-center animate-fade-in-up">
        <h2 className="text-xl font-bold mb-4">Analyse en cours…</h2>
        <Spinner />
      </Card>
    );
  }

  // ── Présence exceptionnelle (jour non ouvré) : arrivée pointée sur demande, sans motif ──
  return (
    <Card className="p-6 text-center animate-fade-in-up">
      <h2 className="text-xl font-bold mb-2">Présence exceptionnelle</h2>
      <p className="text-muted-foreground mb-6">Enregistrer votre arrivée pour aujourd&apos;hui ?</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" className="w-full" loading={isPending} onClick={() => submitPointage()}>
          Pointer mon arrivée
        </Button>
        <Button variant="secondary" className="w-full" disabled={isPending} onClick={() => setForcePointage(false)}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}
