/**
 * geo-utils.ts
 * Utilitaires de géolocalisation pour le module de pointage.
 * Formule de Haversine pour le calcul de distance GPS.
 */

const RAYON_TERRE_METRES = 6_371_000;

/**
 * Convertit des degrés en radians.
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calcule la distance en mètres entre deux points GPS
 * via la formule de Haversine (précision < 0.3%).
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(RAYON_TERRE_METRES * c); // en mètres, arrondi à l'entier
}

/**
 * Résultat de la vérification de proximité.
 */
export interface GeoCheckResult {
  /** Le collaborateur est dans le rayon autorisé */
  allowed: boolean;
  /** Distance calculée en mètres entre l'utilisateur et le bureau */
  distanceMetres: number;
  /** Message lisible pour affichage / alerte */
  message: string;
}

/**
 * Vérifie si l'utilisateur se trouve dans le rayon autorisé
 * par rapport aux coordonnées du bureau.
 *
 * @param userLat - Latitude de l'utilisateur
 * @param userLon - Longitude de l'utilisateur
 * @param officeLat - Latitude du bureau
 * @param officeLon - Longitude du bureau
 * @param rayonMetres - Rayon autorisé en mètres (défaut : 50)
 */
export function isWithinRadius(
  userLat: number,
  userLon: number,
  officeLat: number,
  officeLon: number,
  rayonMetres: number = 50
): GeoCheckResult {
  const distanceMetres = haversineDistance(userLat, userLon, officeLat, officeLon);
  const allowed = distanceMetres <= rayonMetres;

  return {
    allowed,
    distanceMetres,
    message: allowed
      ? `Pointage géolocalisé validé. Distance au bureau : ${distanceMetres}m (rayon : ${rayonMetres}m).`
      : `Pointage refusé. Vous êtes à ${distanceMetres}m du bureau. Le rayon autorisé est de ${rayonMetres}m.`,
  };
}

/**
 * Vérifie que la précision GPS du navigateur est suffisante.
 * Une précision > 150m est trop incertaine pour le pointage.
 *
 * @param precisionMetres - Précision fournie par navigator.geolocation (en mètres)
 */
export function isGeoPrecisionAcceptable(precisionMetres: number): boolean {
  return precisionMetres <= 150;
}

/**
 * Coordonnées GPS par défaut du bureau SIM Assurances (Abidjan).
 * Utilisées comme valeur de fallback si le ParametrageHoraire
 * ne définit pas encore de coordonnées.
 */
export const BUREAU_DEFAULT_COORDS = {
  latitude: 5.3628189,
  longitude: -3.9374753,
} as const;
