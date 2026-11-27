import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { titreMouvementReleveCpt, type ReleveRemunerationCpt } from "backend";

import { COLORS } from "@/lib/pdf/colors";
import { formatDate, formatMontant } from "@/lib/pdf/format";
import "@/lib/pdf/registerFonts";

/**
 * Relevé d'un partenaire pour une nature (lot GC-9g). Même gabarit que le relevé client de GC-7c (`RelevePdfClient.tsx`), avec la
 * même infrastructure générique du portail (palette, police, format d'un montant) et aucun import d'un autre module métier.
 */
const styles = StyleSheet.create({
  page: { fontFamily: "Montserrat", fontSize: 8, color: COLORS.foreground, paddingBottom: 40 },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: 36, paddingVertical: 20, flexDirection: "row", justifyContent: "space-between" },
  marque: { fontSize: 18, fontWeight: 700, color: COLORS.primaryForeground },
  sousMarque: { fontSize: 8, color: "#cfe0f5", marginTop: 2 },
  titre: { fontSize: 11, fontWeight: 700, color: COLORS.primaryForeground, textAlign: "right" },
  date: { fontSize: 8, color: "#cfe0f5", textAlign: "right", marginTop: 3 },
  corps: { paddingHorizontal: 36, paddingTop: 18 },
  nom: { fontSize: 13, fontWeight: 700, marginBottom: 10 },
  resume: { flexDirection: "row", marginBottom: 14 },
  carte: { flexGrow: 1, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.infoBg, padding: 8, marginRight: 6 },
  carteLibelle: { fontSize: 7, color: COLORS.mutedForeground },
  carteValeur: { fontSize: 10, fontWeight: 700, marginTop: 3 },
  section: { fontSize: 10, fontWeight: 700, color: COLORS.primary, marginTop: 12, marginBottom: 5 },
  ligne: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 3 },
  ligneEntete: { flexDirection: "row", backgroundColor: COLORS.neutralBg, paddingVertical: 3, fontWeight: 600 },
  police: { width: "28%", paddingLeft: 3 },
  prevue: { width: "14%" },
  montant: { width: "14.5%", textAlign: "right", paddingRight: 3 },
  mDate: { width: "14%", paddingLeft: 3 },
  mRef: { width: "18%" },
  mDetail: { width: "52%" },
  mMontant: { width: "16%", textAlign: "right", paddingRight: 3 },
  vide: { color: COLORS.mutedForeground, marginTop: 4 },
  pied: { position: "absolute", bottom: 16, left: 36, right: 36, fontSize: 7, color: COLORS.mutedForeground, textAlign: "center" },
});

const fcfa = (centimes: bigint) => formatMontant(Number(centimes) / 100);
const jour = (iso: string) => iso.split("-").reverse().join("/");

export function RelevePdfRemuneration({ partenaire, releve, edite }: { partenaire: string; releve: ReleveRemunerationCpt; edite: Date }) {
  const s = releve.solde;
  const cartes: [string, bigint][] = [
    ["Dû", s.du],
    ["Payé", s.paye],
    ["Net à verser", s.montantReglable],
    ["Reste dû", s.resteDu],
    ["Avance", s.avanceNette],
  ];
  return (
    <Document title={`Relevé ${releve.libelleNature} — ${partenaire}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.marque}>SIM Assurances</Text>
            <Text style={styles.sousMarque}>Gestion Compta</Text>
          </View>
          <View>
            <Text style={styles.titre}>RELEVÉ PARTENAIRE — {releve.libelleNature.toUpperCase()}</Text>
            <Text style={styles.date}>Édité le {formatDate(edite)}</Text>
          </View>
        </View>
        <View style={styles.corps}>
          <Text style={styles.nom}>{partenaire}</Text>
          <View style={styles.resume}>
            {cartes.map(([libelle, v]) => (
              <View key={libelle} style={styles.carte}>
                <Text style={styles.carteLibelle}>{libelle}</Text>
                <Text style={styles.carteValeur}>{fcfa(v)}</Text>
              </View>
            ))}
          </View>
          {releve.honoraires && (
            <Text>
              Exigibles sur primes encaissées : {fcfa(releve.honoraires.surPrimesEncaissees)} · sur primes non encaissées : {fcfa(releve.honoraires.surPrimesNonEncaissees)}
              {s.aRegulariser > BigInt(0) ? ` · à régulariser : ${fcfa(s.aRegulariser)}` : ""}
            </Text>
          )}

          <Text style={styles.section}>Échéances</Text>
          {releve.lignes.length === 0 ? (
            <Text style={styles.vide}>Aucune échéance.</Text>
          ) : (
            <View>
              <View style={styles.ligneEntete}>
                <Text style={styles.police}>Police, échéance</Text>
                <Text style={styles.prevue}>Prévue le</Text>
                <Text style={styles.montant}>Dû</Text>
                <Text style={styles.montant}>Payé</Text>
                <Text style={styles.montant}>Reste payable</Text>
                <Text style={styles.montant}>Reste dû</Text>
              </View>
              {releve.lignes.map((l) => (
                <View key={l.cle} style={styles.ligne} wrap={false}>
                  <Text style={styles.police}>
                    {l.numPolice} n°{l.rang}
                  </Text>
                  <Text style={styles.prevue}>{jour(l.datePrevue)}</Text>
                  <Text style={styles.montant}>{fcfa(l.du)}</Text>
                  <Text style={styles.montant}>{fcfa(l.paye)}</Text>
                  <Text style={styles.montant}>{fcfa(l.restePayable)}</Text>
                  <Text style={styles.montant}>{fcfa(l.resteDu)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.section}>Règlements et compensations</Text>
          {releve.mouvements.length === 0 ? (
            <Text style={styles.vide}>Aucun mouvement.</Text>
          ) : (
            <View>
              <View style={styles.ligneEntete}>
                <Text style={styles.mDate}>Date</Text>
                <Text style={styles.mRef}>Référence</Text>
                <Text style={styles.mDetail}>Détail</Text>
                <Text style={styles.mMontant}>Montant</Text>
              </View>
              {releve.mouvements.map((m, i) => (
                <View key={i} style={styles.ligne} wrap={false}>
                  <Text style={styles.mDate}>{jour(m.date)}</Text>
                  <Text style={styles.mRef}>{titreMouvementReleveCpt(m)}</Text>
                  <Text style={styles.mDetail}>{m.detail}</Text>
                  <Text style={styles.mMontant}>{m.montant < BigInt(0) ? `- ${fcfa(-m.montant)}` : fcfa(m.montant)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.pied} fixed>
          Document d&apos;information édité par SIM Assurances. Montants en FCFA, calculés d&apos;après les paiements validés.
        </Text>
      </Page>
    </Document>
  );
}
