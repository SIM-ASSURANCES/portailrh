import { Document, Page, Text, View } from "@react-pdf/renderer";

import { COLORS } from "./colors";
import { formatDate, formatMontant } from "./format";
import { styles } from "./ReceiptDocument";
import "./registerFonts";

export interface RetourReceiptData {
  /** `<référence demande>-RC<rang>` — voir `referenceRecuRetour`. */
  recuReference: string;
  demandeReference: string;
  demandeurNom: string;
  beneficiaireNom: string;
  /** Règlement d'origine : montant remis, mode et date de confirmation. */
  montantRegle: number;
  mode: "CAISSE" | "BANQUE";
  regleLe: Date;
  /** Montant rendu (0 pour un retour nul). */
  montantRetourne: number;
  retourNul: boolean;
  receptionneLe: Date;
  declarantNom: string;
  creeParAssistant: boolean;
  receptionneParNom: string;
  depenses: { libelle: string; montant: number; etat: string }[];
  totalJustifie: number;
  totalNonJustifie: number;
  genereLe: Date;
}

/**
 * Reçu d'un retour de caisse (2026-10-08) — même gabarit, mêmes mentions et même numérotation que le reçu de
 * règlement (`ReceiptDocument`, styles partagés). Disponible dès que le retour est réceptionné (ou, pour un retour
 * nul, constaté) par l'Assistant Finance.
 */
export function RetourReceiptDocument({ data }: { data: RetourReceiptData }) {
  const totalDepenses = data.totalJustifie + data.totalNonJustifie;
  return (
    <Document title={`Reçu ${data.recuReference}`} author="Portail SIM Assurances">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logoWordmark}>SIM ASSURANCES</Text>
            <Text style={styles.logoTagline}>Société Ivoirienne de Micro-Assurances</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>REÇU DE RETOUR DE CAISSE</Text>
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
              <Text style={styles.statLabel}>{data.retourNul ? "Date du constat" : "Date de réception"}</Text>
              <Text style={styles.statValue}>{formatDate(data.receptionneLe)}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Montant rendu</Text>
              <Text style={styles.amountValue}>{formatMontant(data.montantRetourne)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Nature</Text>
              <Text
                style={[
                  styles.badge,
                  {
                    backgroundColor: data.retourNul ? COLORS.neutralBg : COLORS.infoBg,
                    color: data.retourNul ? COLORS.success : COLORS.info,
                    borderColor: data.retourNul ? COLORS.neutralBorder : COLORS.infoBorder,
                  },
                ]}
              >
                {data.retourNul ? "Retour nul — rien à rendre" : data.mode === "CAISSE" ? "Retour en caisse" : "Versement bancaire"}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Règlement d&apos;origine</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Fonds remis ({data.mode === "CAISSE" ? "Caisse" : "Banque"})</Text>
              <Text style={styles.detailValue}>{formatMontant(data.montantRegle)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date du règlement</Text>
              <Text style={styles.detailValue}>{formatDate(data.regleLe)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Dépenses justifiées</Text>
              <Text style={styles.detailValue}>{formatMontant(data.totalJustifie)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Dépenses non justifiées</Text>
              <Text style={styles.detailValue}>{formatMontant(data.totalNonJustifie)}</Text>
            </View>
            <View style={[styles.detailRow, { marginBottom: 0 }]}>
              <Text style={styles.detailLabel}>Total dépensé + rendu</Text>
              <Text style={styles.detailValue}>{formatMontant(totalDepenses + data.montantRetourne)}</Text>
            </View>
          </View>

          {data.depenses.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Détail des dépenses</Text>
              {data.depenses.map((d, index) => (
                <View
                  key={index}
                  style={index === data.depenses.length - 1 ? [styles.detailRow, { marginBottom: 0 }] : styles.detailRow}
                >
                  <Text style={styles.detailLabel}>
                    {d.libelle} — {d.etat}
                  </Text>
                  <Text style={styles.detailValue}>{formatMontant(d.montant)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Détails de la demande</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Demandeur</Text>
              <Text style={styles.detailValue}>{data.demandeurNom}</Text>
            </View>
            <View style={[styles.detailRow, { marginBottom: 0 }]}>
              <Text style={styles.detailLabel}>Bénéficiaire</Text>
              <Text style={styles.detailValue}>{data.beneficiaireNom}</Text>
            </View>
          </View>

          <Text style={styles.auteurLine}>
            Déclaré par <Text style={styles.auteurNom}>{data.declarantNom}</Text>
            {data.creeParAssistant ? " (Assistant Finance)" : ""} — {data.retourNul ? "Constaté" : "Réceptionné"} par{" "}
            <Text style={styles.auteurNom}>{data.receptionneParNom}</Text>.
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
