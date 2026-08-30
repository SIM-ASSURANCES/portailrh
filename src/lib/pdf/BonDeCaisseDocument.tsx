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
    paddingTop: 32,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 9,
    color: COLORS.mutedForeground,
  },
  detailValue: {
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.foreground,
  },
  amountBox: {
    marginTop: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 28,
    alignItems: "center",
  },
  amountLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  amountValue: {
    fontSize: 32,
    fontWeight: 700,
    color: COLORS.primary,
  },
  auteurLine: {
    fontSize: 9,
    color: COLORS.mutedForeground,
    textAlign: "center",
    marginTop: 4,
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

export interface BonDeCaisseData {
  demandeReference: string;
  beneficiaireNom: string;
  confirmeLe: Date;
  montant: number;
  auteurNom: string;
  genereLe: Date;
}

/**
 * Bon de caisse (Phase E, cahier des charges section 12.1) — document
 * DISTINCT du reçu de règlement complet (Ticket 9, `ReceiptDocument.tsx`) :
 * n'existe que pour les règlements en mode CAISSE, et se limite
 * volontairement au montant réglé lors de CETTE opération précise. Ne
 * comporte NI le montant demandé, NI le total réglé à ce jour, NI le reste
 * à régler — ces informations de contexte restent réservées au reçu
 * complet (voir CLAUDE.md "Refonte V1 en cours" / Phase E pour la
 * justification). Exemple du cahier des charges : montant validé
 * 250 000 FCFA, ce règlement précis 200 000 FCFA -> le bon de caisse
 * n'affiche que "200 000 FCFA".
 *
 * Même identité visuelle que le reçu (bandeau bleu, wordmark texte
 * "SIM ASSURANCES" — pas d'image, voir `ReceiptDocument.tsx` pour le détail
 * du choix), polices et couleurs partagées via `registerFonts`/`colors.ts`.
 */
export function BonDeCaisseDocument({ data }: { data: BonDeCaisseData }) {
  return (
    <Document title={`Bon de caisse ${data.demandeReference}`} author="Portail SIM Assurances">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logoWordmark}>SIM ASSURANCES</Text>
            <Text style={styles.logoTagline}>Société Ivoirienne de Micro-Assurances</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>BON DE CAISSE</Text>
            <Text style={styles.docRef}>{data.demandeReference}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Bénéficiaire</Text>
            <Text style={styles.detailValue}>{data.beneficiaireNom}</Text>
          </View>
          <View style={[styles.detailRow, { marginBottom: 0 }]}>
            <Text style={styles.detailLabel}>Date du règlement</Text>
            <Text style={styles.detailValue}>{formatDate(data.confirmeLe)}</Text>
          </View>

          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Montant réglé (Caisse)</Text>
            <Text style={styles.amountValue}>{formatMontant(data.montant)}</Text>
          </View>

          <Text style={styles.auteurLine}>
            Réglé par <Text style={styles.auteurNom}>{data.auteurNom}</Text>.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Document généré automatiquement par le Portail SIM Assurances le {formatDate(data.genereLe)} — référence
            de la demande : {data.demandeReference}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
