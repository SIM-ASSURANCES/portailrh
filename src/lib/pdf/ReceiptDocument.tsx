import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { COLORS } from "./colors";
import { formatDate, formatMontant } from "./format";
import "./registerFonts";

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
