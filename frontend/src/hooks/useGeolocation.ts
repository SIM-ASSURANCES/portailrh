"use client";

import { useState, useCallback, useRef } from "react";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  /** Précision en mètres (fournie par le navigateur) */
  accuracy: number;
}

export interface GeoState {
  position: GeoPosition | null;
  error: string | null;
  loading: boolean;
  permissionState: PermissionState | null;
}

/**
 * Hook React pour accéder à la géolocalisation du navigateur.
 *
 * Usage :
 * ```tsx
 * const { position, error, loading, requestPosition } = useGeolocation();
 * ```
 */
export function useGeolocation(): GeoState & { requestPosition: () => void } {
  const [state, setState] = useState<GeoState>({
    position: null,
    error: null,
    loading: false,
    permissionState: null,
  });

  const watchIdRef = useRef<number | null>(null);

  const requestPosition = useCallback(() => {
    // Vérifier si le navigateur bloque la géolocalisation à cause d'un contexte HTTP non sécurisé (ex: IP locale sur mobile)
    if (typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      setState((s) => ({
        ...s,
        error: "Contexte non sécurisé (HTTP) : Les navigateurs mobiles bloquent le GPS sur une adresse HTTP non sécurisée. Pour tester en local sur téléphone, autorisez cette adresse dans le navigateur ou utilisez HTTPS.",
        loading: false,
        permissionState: "denied",
      }));
      return;
    }

    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        error: "La géolocalisation n'est pas supportée par votre navigateur.",
        loading: false,
      }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    // Vérifier l'état de la permission d'abord (optionnel, pas supporté partout)
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          setState((s) => ({ ...s, permissionState: result.state }));
        })
        .catch(() => {
          // Silencieux — certains navigateurs ne supportent pas cette API
        });
    }

    // Effacer le watch précédent s'il existe
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    const options: PositionOptions = {
      enableHighAccuracy: true, // GPS haute précision (vs réseau/wifi)
      timeout: 15_000,          // 15s max
      maximumAge: 0,            // Toujours une position fraîche
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        navigator.geolocation.clearWatch(watchIdRef.current!);
        watchIdRef.current = null;
        setState({
          position: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          error: null,
          loading: false,
          permissionState: "granted",
        });
      },
      (err) => {
        navigator.geolocation.clearWatch(watchIdRef.current!);
        watchIdRef.current = null;

        let message = "Impossible d'obtenir votre position.";
        switch (err.code) {
          case GeolocationPositionError.PERMISSION_DENIED:
            message =
              "Accès à la localisation refusé. Autorisez la géolocalisation dans les paramètres de votre navigateur, puis réessayez.";
            break;
          case GeolocationPositionError.POSITION_UNAVAILABLE:
            message =
              "Position indisponible. Déplacez-vous en extérieur ou activez le GPS de votre appareil.";
            break;
          case GeolocationPositionError.TIMEOUT:
            message =
              "La localisation a pris trop de temps. Réessayez en extérieur pour un meilleur signal GPS.";
            break;
        }

        setState({
          position: null,
          error: message,
          loading: false,
          permissionState: err.code === GeolocationPositionError.PERMISSION_DENIED ? "denied" : "prompt",
        });
      },
      options
    );
  }, []);

  return { ...state, requestPosition };
}
