import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { COLORS } from "@/lib/pdf/colors";
import { formatDate, formatMontant } from "@/lib/pdf/format";
import "@/lib/pdf/registerFonts";

/**
 * Relevé client imprimable (lot GC-7c) — gabarit PROPRE à Gestion Compta. Réutilisé comme INFRASTRUCTURE GÉNÉRIQUE du portail (aucune
 * règle métier d'un autre module) : la palette (`colors.ts`, mêmes valeurs que les tokens de `globals.css`), l'enregistrement de la police
 * Montserrat (`registerFonts.ts`, la lecture des .ttf bundlés) et le formatage d'un montant en FCFA (`format.ts`, qui évite l'espace fine
 * insécable absente de la police). Tout le reste (mise en page, contenu, calculs) est écrit ici et vient de la fiche client (`cptFicheClientDb.ts`).
 */
const styles = StyleSheet.create({
  page: { fontFamily: "Montserrat", fontSize: 9, color: COLORS.foreground, paddingBottom: 40 },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: 36, paddingVertical: 20, flexDirection: "row", justifyContent: "space-between" },
  marque: { fontSize: 18, fontWeight: 700, color: COLORS.primaryForeground },
  sousMarque: { fontSize: 8, color: "#cfe0f5", marginTop: 2 },
  titre: { fontSize: 11, fontWeight: 700, color: COLORS.primaryForeground, textAlign: "right" },
  date: { fontSize: 8, color: "#cfe0f5", textAlign: "right", marginTop: 3 },
  corps: { paddingHorizontal: 36, paddingTop: 18 },
  identite: { marginBottom: 12 },
  nom: { fontSize: 13, fontWeight: 700 },
  discret: { color: COLORS.mutedForeground, fontSize: 8, marginTop: 2 },
  resume: { flexDirection: "row", marginBottom: 14 },
  carte: { flexGrow: 1, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.infoBg, padding: 8, marginRight: 6 },
  carteLibelle: { fontSize: 7, color: COLORS.mutedForeground },
  carteValeur: { fontSize: 11, fontWeight: 700, marginTop: 3 },
  section: { fontSize: 10, fontWeight: 700, color: COLORS.primary, marginTop: 12, marginBottom: 5 },
  contrat: { fontSize: 9, fontWeight: 600, marginTop: 8 },
  ligne: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 3 },
  ligneEntete: { flexDirection: "row", backgroundColor: COLORS.neutralBg, paddingVertical: 3, fontWeight: 600 },
  c1: { width: "10%", paddingLeft: 3 },
  c2: { width: "24%" },
  c3: { width: "22%", textAlign: "right" },
  c4: { width: "22%", textAlign: "right" },
  c5: { width: "22%", textAlign: "right", paddingRight: 3 },
  p1: { width: "16%", paddingLeft: 3 },
  p2: { width: "24%" },
  p3: { width: "26%" },
  p4: { width: "16%" },
  p5: { width: "18%", textAlign: "right", paddingRight: 3 },
  vide: { color: COLORS.mutedForeground, marginTop: 4 },
  pied: { position: "absolute", bottom: 16, left: 36, right: 36, fontSize: 7, color: COLORS.mutedForeground, textAlign: "center" },
});

export interface EcheanceReleve {
  rang: number;
  datePrevue: Date;
  montantDu: number;
  montantRegle: number;
  resteDu: number;
  libelleEtat: string;
}
export interface ContratReleve {
  numPolice: string;
  produit: string;
  fractionnement: string;
  resteDu: number;
  echeances: EcheanceReleve[];
}
export interface PaiementReleve {
  dateValeur: Date;
  canal: string;
  reference: string;
  numPolice: string;
  rangEcheance: number;
  montant: number;
}
export interface DonneesReleveClient {
  nom: string;
  telephone: string | null;
  partenaire: string | null;
  edite: Date;
  primeEmise: number;
  encaisseProuve: number;
  resteDu: number;
  resteEnRetard: number;
  anciennete: string;
  contrats: ContratReleve[];
  paiements: PaiementReleve[];
}

export function RelevePdfClient({ donnees: d }: { donnees: DonneesReleveClient }) {
  return (
    <Document title={`Relevé client — ${d.nom}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.marque}>SIM Assurances</Text>
            <Text style={styles.sousMarque}>Gestion Compta</Text>
          </View>
          <View>
            <Text style={styles.titre}>RELEVÉ CLIENT</Text>
            <Text style={styles.date}>Édité le {formatDate(d.edite)}</Text>
          </View>
        </View>
        <View style={styles.corps}>
          <View style={styles.identite}>
            <Text style={styles.nom}>{d.nom}</Text>
            <Text style={styles.discret}>{[d.telephone, d.partenaire ? `Partenaire : ${d.partenaire}` : null].filter(Boolean).join(" · ") || "Sans coordonnées enregistrées"}</Text>
          </View>
          <View style={styles.resume}>
            <View style={styles.carte}>
              <Text style={styles.carteLibelle}>Prime émise</Text>
              <Text style={styles.carteValeur}>{formatMontant(d.primeEmise)}</Text>
            </View>
            <View style={styles.carte}>
              <Text style={styles.carteLibelle}>Encaissé prouvé</Text>
              <Text style={styles.carteValeur}>{formatMontant(d.encaisseProuve)}</Text>
            </View>
            <View style={styles.carte}>
              <Text style={styles.carteLibelle}>Reste dû</Text>
              <Text style={styles.carteValeur}>{formatMontant(d.resteDu)}</Text>
            </View>
            <View style={styles.carte}>
              <Text style={styles.carteLibelle}>Ancienneté de la dette</Text>
              <Text style={styles.carteValeur}>{d.anciennete}</Text>
            </View>
          </View>

          <Text style={styles.section}>Échéances</Text>
          {d.contrats.length === 0 && <Text style={styles.vide}>Aucun contrat.</Text>}
          {d.contrats.map((c) => (
            <View key={c.numPolice} wrap={false}>
              <Text style={styles.contrat}>
                {c.numPolice} — {c.produit} ({c.fractionnement}) — reste dû {formatMontant(c.resteDu)}
              </Text>
              <View style={styles.ligneEntete}>
                <Text style={styles.c1}>N°</Text>
                <Text style={styles.c2}>Date prévue</Text>
                <Text style={styles.c3}>Dû</Text>
                <Text style={styles.c4}>Réglé</Text>
                <Text style={styles.c5}>État</Text>
              </View>
              {c.echeances.map((e) => (
                <View key={e.rang} style={styles.ligne}>
                  <Text style={styles.c1}>{e.rang}</Text>
                  <Text style={styles.c2}>{e.datePrevue.toLocaleDateString("fr-FR", { timeZone: "UTC" })}</Text>
                  <Text style={styles.c3}>{formatMontant(e.montantDu)}</Text>
                  <Text style={styles.c4}>{formatMontant(e.montantRegle)}</Text>
                  <Text style={styles.c5}>{e.libelleEtat}</Text>
                </View>
              ))}
            </View>
          ))}

          <Text style={styles.section}>Paiements enregistrés (rattachements validés)</Text>
          {d.paiements.length === 0 ? (
            <Text style={styles.vide}>Aucun paiement validé.</Text>
          ) : (
            <View>
              <View style={styles.ligneEntete}>
                <Text style={styles.p1}>Date</Text>
                <Text style={styles.p2}>Canal</Text>
                <Text style={styles.p3}>Référence</Text>
                <Text style={styles.p4}>Police</Text>
                <Text style={styles.p5}>Montant</Text>
              </View>
              {d.paiements.map((p, i) => (
                <View key={i} style={styles.ligne} wrap={false}>
                  <Text style={styles.p1}>{p.dateValeur.toLocaleDateString("fr-FR", { timeZone: "UTC" })}</Text>
                  <Text style={styles.p2}>{p.canal}</Text>
                  <Text style={styles.p3}>{p.reference}</Text>
                  <Text style={styles.p4}>
                    {p.numPolice} n°{p.rangEcheance}
                  </Text>
                  <Text style={styles.p5}>{formatMontant(p.montant)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.pied} fixed>
          Document d&apos;information édité par SIM Assurances. Les montants sont en FCFA. Seuls les paiements validés sont comptés comme encaissés.
        </Text>
      </Page>
    </Document>
  );
}
