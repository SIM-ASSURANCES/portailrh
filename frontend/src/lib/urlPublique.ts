import { networkInterfaces } from "os";
import { urlPubliqueSite } from "backend";

/**
 * URL publique du portail pour les liens absolus hors application (e-mails). Règle unique dans
 * `backend/src/urlPublique.ts` : `AUTH_URL` en production ; en développement, l'adresse réseau local quand
 * `AUTH_URL` est absente ou vaut localhost (ouvrable depuis un téléphone du même réseau).
 */
export function urlPublique(): string {
  return urlPubliqueSite({ env: process.env, interfaces: networkInterfaces() });
}
