import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Montserrat n'est disponible côté serveur que via `next/font/google` (qui
 * ne produit qu'une classe CSS pour le navigateur, inutilisable par
 * @react-pdf/renderer). Le rendu PDF tourne dans un Route Handler Node, donc
 * on enregistre directement les fichiers statiques Google Fonts (URLs
 * versionnées, stables tant que Google ne publie pas une nouvelle version
 * de la police — vérifié accessible directement via ces URLs `fonts.gstatic.com`).
 */
Font.register({
  family: "Montserrat",
  fonts: [
    { src: "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtZ6Ew-.ttf", fontWeight: 500 },
    { src: "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCu170w-.ttf", fontWeight: 600 },
    { src: "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf", fontWeight: 700 },
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
