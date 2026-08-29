import { readFileSync } from "node:fs";
import path from "node:path";

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Montserrat n'est disponible côté serveur que via `next/font/google` (qui
 * ne produit qu'une classe CSS pour le navigateur, inutilisable par
 * @react-pdf/renderer). Le rendu PDF tourne dans un Route Handler Node.
 *
 * **Fichiers bundlés localement (`./fonts/*.ttf`), pas d'URL distante,
 * pas de `__dirname`.** Deux incidents constatés en vérification manuelle
 * avant ce choix : (1) les URLs `fonts.gstatic.com` (documentées comme
 * stables au Ticket 9) ont provoqué un `ConnectTimeoutError` reproductible
 * lors de la génération d'un reçu, y compris après redémarrage du serveur
 * — un souci réseau ponctuel au premier rendu suffit à rendre
 * `Font.register` en échec pour toute la durée de vie du process (react-pdf
 * ne retente jamais un chargement de police en échec) ; (2) une première
 * correction via `path.join(__dirname, ...)` a échoué à son tour :
 * Turbopack réécrit `__dirname` vers un chemin racine virtuel
 * (`C:\ROOT\...`) qui n'existe pas sur le disque réel (`ENOENT`). Solution
 * robuste retenue : lire chaque fichier en `Buffer` une seule fois au
 * chargement du module via `process.cwd()` (toujours la racine du projet
 * pour `next dev`/`next start`, jamais virtualisé par le bundler), puis
 * l'encoder en data URL base64 passée à `src` (`@react-pdf/font` accepte
 * nativement ce format) — les données de police vivent alors entièrement
 * en mémoire, sans plus jamais retoucher le disque ni le réseau au moment
 * du rendu.
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

/**
 * Mêmes valeurs hexadécimales exactes que les tokens sémantiques de
 * `globals.css` (bg-primary, text-info, border-neutral...) — @react-pdf/renderer
 * ne peut pas lire les classes Tailwind du projet, donc dupliquées ici
 * littéralement plutôt que réinventées, pour un rendu cohérent avec le reste
 * du portail.
 */
const COLORS = {
  primary: "#004b9c",
  primaryForeground: "#ffffff",
  info: "#1d78ab",
  infoBg: "#f1f9fd",
  infoBorder: "#cbe7f6",
  neutral: "#475569",
  neutralBg: "#f1f5f9",
  neutralBorder: "#e2e8f0",
  border: "#e2e8f0",
  mutedForeground: "#64748b",
  foreground: "#0f172a",
  warning: "#bf470c",
  success: "#16a34a",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Montserrat",
    fontSize: 10,
    color: COLORS.foreground,
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 40,
    paddingVertical: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logoWordmark: {
    fontSize: 20,
    fontWeight: 700,
    color: COLORS.primaryForeground,
    letterSpacing: 0.5,
  },
  logoTagline: {
    fontSize: 8,
    color: "#cfe0f5",
    marginTop: 2,
  },
  docTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: COLORS.primaryForeground,
    textAlign: "right",
    letterSpacing: 1,
  },
  docRef: {
    fontSize: 9,
    color: "#cfe0f5",
    textAlign: "right",
    marginTop: 3,
  },
  body: {
    paddingHorizontal: 40,
    paddingTop: 28,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },
  statCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 12,
  },
  statLabel: {
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 700,
    color: COLORS.foreground,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: 700,
    color: COLORS.primary,
  },
  statValueMedium: {
    fontSize: 13,
    fontWeight: 700,
    color: COLORS.foreground,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: 600,
  },
  section: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: COLORS.foreground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 9,
    color: COLORS.mutedForeground,
  },
  detailValue: {
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.foreground,
  },
  auteurLine: {
    fontSize: 9,
    color: COLORS.mutedForeground,
  },
  auteurNom: {
    fontWeight: 600,
    color: COLORS.foreground,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  footerText: {
    fontSize: 7,
    color: COLORS.mutedForeground,
  },
});

export interface ReceiptData {
  recuReference: string;
  demandeReference: string;
  demandeurNom: string;
  categorieLabel: string | null;
  objetLabel: string | null;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  confirmeLe: Date;
  auteurNom: string;
  genereLe: Date;
  /** Montant total de la Demande (pas seulement ce règlement). */
  montantDemande: number;
  /** getTotalRegle(demandeId) au moment de la génération — état le plus à jour, pas figé à la date du règlement. */
  totalRegleADate: number;
  /** getResteARegler(demandeId), même logique de fraîcheur. */
  resteARegler: number;
}

function formatMontant(montant: number): string {
  return `${montant.toLocaleString("fr-FR")} FCFA`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * Gabarit du reçu de règlement (Ticket 9), un règlement par reçu.
 *
 * Pas de logo image : `logo-sim-blanc.webp` est (a) au format WebP, non
 * fiablement supporté par le moteur de rendu image de @react-pdf/renderer,
 * et (b) une version blanche pensée pour un fond bleu plein — ici le bandeau
 * d'en-tête EST bleu (`COLORS.primary`), donc le problème de contraste ne se
 * serait pas posé, mais le format reste bloquant. Choix : le nom
 * "SIM ASSURANCES" en texte stylé (graisse 700, lettres espacées),
 * exactement le même compromis que documenté dans la demande — pas d'image
 * invisible ou de conversion de format ad hoc pour ce premier reçu.
 */
export function ReceiptDocument({ data }: { data: ReceiptData }) {
  const modeIsCaisse = data.mode === "CAISSE";

  return (
    <Document title={`Reçu ${data.recuReference}`} author="Portail SIM Assurances">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logoWordmark}>SIM ASSURANCES</Text>
            <Text style={styles.logoTagline}>Société Ivoirienne de Micro-Assurances</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>REÇU DE RÈGLEMENT</Text>
            <Text style={styles.docRef}>{data.recuReference}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Référence de la demande</Text>
              <Text style={styles.statValue}>{data.demandeReference}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Date du règlement</Text>
              <Text style={styles.statValue}>{formatDate(data.confirmeLe)}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Montant réglé</Text>
              <Text style={styles.amountValue}>{formatMontant(data.montant)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Mode de règlement</Text>
              <Text
                style={[
                  styles.badge,
                  {
                    backgroundColor: modeIsCaisse ? COLORS.infoBg : COLORS.neutralBg,
                    color: modeIsCaisse ? COLORS.info : COLORS.neutral,
                    borderColor: modeIsCaisse ? COLORS.infoBorder : COLORS.neutralBorder,
                  },
                ]}
              >
                {modeIsCaisse ? "Caisse" : "Banque"}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Situation de la demande</Text>
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Montant demandé</Text>
                <Text style={styles.statValueMedium}>{formatMontant(data.montantDemande)}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Total réglé à ce jour</Text>
                <Text style={styles.statValueMedium}>{formatMontant(data.totalRegleADate)}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Reste à régler</Text>
                <Text
                  style={[
                    styles.statValueMedium,
                    { color: data.resteARegler > 0 ? COLORS.warning : COLORS.success },
                  ]}
                >
                  {formatMontant(data.resteARegler)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Détails de la demande</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Demandeur</Text>
              <Text style={styles.detailValue}>{data.demandeurNom}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Catégorie</Text>
              <Text style={styles.detailValue}>{data.categorieLabel ?? "Non renseignée"}</Text>
            </View>
            <View style={[styles.detailRow, { marginBottom: 0 }]}>
              <Text style={styles.detailLabel}>Objet</Text>
              <Text style={styles.detailValue}>{data.objetLabel ?? "Non renseigné"}</Text>
            </View>
          </View>

          <Text style={styles.auteurLine}>
            Règlement effectué par <Text style={styles.auteurNom}>{data.auteurNom}</Text>.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Document généré automatiquement par le Portail SIM Assurances le {formatDate(data.genereLe)} — référence
            du reçu : {data.recuReference}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
