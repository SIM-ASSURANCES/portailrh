import { readFileSync } from "node:fs";
import path from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * Montserrat n'est disponible côté serveur que via `next/font/google` (qui
 * ne produit qu'une classe CSS pour le navigateur, inutilisable par
 * @react-pdf/renderer). Le rendu PDF tourne dans un Route Handler Node.
 *
 * **Fichiers bundlés localement (`./fonts/*.ttf`), pas d'URL distante,
 * pas de `__dirname`.** Deux incidents constatés en vérification manuelle
 * avant ce choix (Ticket 9) : (1) les URLs `fonts.gstatic.com` ont provoqué
 * un `ConnectTimeoutError` reproductible, y compris après redémarrage du
 * serveur — un souci réseau ponctuel au premier rendu suffit à rendre
 * `Font.register` en échec pour toute la durée de vie du process (react-pdf
 * ne retente jamais un chargement de police en échec) ; (2) une première
 * correction via `path.join(__dirname, ...)` a échoué à son tour :
 * Turbopack réécrit `__dirname` vers un chemin racine virtuel
 * (`C:\ROOT\...`) qui n'existe pas sur le disque réel (`ENOENT`). Solution
 * robuste retenue : lire chaque fichier en `Buffer` une seule fois au
 * chargement du module via `process.cwd()` (toujours la racine du projet
 * pour `next dev`/`next start`, jamais virtualisé par le bundler), puis
 * l'encoder en data URL base64 passée à `src` (`@react-pdf/font` accepte
 * nativement ce format).
 *
 * Factorisé ici (Phase E) : ce module n'exporte rien, son seul rôle est
 * l'effet de bord `Font.register` ci-dessous, exécuté une seule fois grâce
 * au cache de modules Node — `ReceiptDocument.tsx` (Ticket 9) et
 * `BonDeCaisseDocument.tsx` (Phase E) l'importent tous deux (`import
 * "./fonts"`) plutôt que de dupliquer/relire les fichiers de police chacun
 * de leur côté.
 */
const FONTS_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");

function fontDataUrl(fileName: string): string {
  const buffer = readFileSync(path.join(FONTS_DIR, fileName));
  return `data:font/ttf;base64,${buffer.toString("base64")}`;
}

Font.register({
  family: "Montserrat",
  fonts: [
    { src: fontDataUrl("Montserrat-Regular.ttf"), fontWeight: 400 },
    { src: fontDataUrl("Montserrat-Medium.ttf"), fontWeight: 500 },
    { src: fontDataUrl("Montserrat-SemiBold.ttf"), fontWeight: 600 },
    { src: fontDataUrl("Montserrat-Bold.ttf"), fontWeight: 700 },
  ],
});
