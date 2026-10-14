import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { COLORS } from "./colors";
import { formatDate, formatMontant } from "./format";
import type { HistoriqueImprime } from "./historiqueDocument";
import "./registerFonts";

/** Styles partagés avec le reçu de retour de caisse (`RetourReceiptDocument.tsx`) : même gabarit, mêmes mentions. */
export const styles = StyleSheet.create({
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

/** Article payé par le règlement (lot D) — imprimé sur les trois documents (reçu, bon de caisse, reçu de retour). */
export interface ArticleImprime {
  libelle: string;
  beneficiaireNom: string;
  montantValide: number;
  /** Date de livraison de l'article (lot G), déjà formatée (« 12/10/2026 » ou « — »). */
  dateLivraison?: string;
  regleADate?: number;
  resteARegler?: number;
}

/**
 * Bloc « Article concerné » : libellé, bénéficiaire et montant de l'article, puis — si fournis — réglé à ce jour et
 * reste. Rappel de la demande (numéro, demandeur, service) dans `RappelDemande`.
 */
export function ArticleSection({ article, titre = "Article concerné" }: { article: ArticleImprime; titre?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{titre}</Text>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Article</Text>
        <Text style={styles.detailValue}>{article.libelle}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Bénéficiaire</Text>
        <Text style={styles.detailValue}>{article.beneficiaireNom}</Text>
      </View>
      {article.dateLivraison != null ? (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Date de livraison</Text>
          <Text style={styles.detailValue}>{article.dateLivraison}</Text>
        </View>
      ) : null}
      <View style={article.regleADate == null ? [styles.detailRow, { marginBottom: 0 }] : styles.detailRow}>
        <Text style={styles.detailLabel}>Montant de l&apos;article</Text>
        <Text style={styles.detailValue}>{formatMontant(article.montantValide)}</Text>
      </View>
      {article.regleADate != null ? (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Réglé à ce jour sur l&apos;article</Text>
          <Text style={styles.detailValue}>{formatMontant(article.regleADate)}</Text>
        </View>
      ) : null}
      {article.resteARegler != null ? (
        <View style={[styles.detailRow, { marginBottom: 0 }]}>
          <Text style={styles.detailLabel}>Reste à régler sur l&apos;article</Text>
          <Text style={styles.detailValue}>{formatMontant(article.resteARegler)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const libelleMode = (m: "CAISSE" | "BANQUE") => (m === "CAISSE" ? "Caisse" : "Banque");

/**
 * Historique détaillé de l'article (ou de la demande) — lot G : chaque règlement (Caisse et Banque), chaque retour de
 * caisse, chaque dépense déclarée, puis le solde final. Données : `chargerHistoriqueDocument`.
 */
export function HistoriqueSection({ historique: h }: { historique: HistoriqueImprime }) {
  const portee = h.portee === "ARTICLE" ? "de l'article" : "de la demande";
  const ligne = (cle: string, libelle: string, valeur: string, dernier = false) => (
    <View key={cle} style={dernier ? [styles.detailRow, { marginBottom: 0 }] : styles.detailRow}>
      <Text style={styles.detailLabel}>{libelle}</Text>
      <Text style={styles.detailValue}>{valeur}</Text>
    </View>
  );
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Règlements {portee}</Text>
        {h.reglements.map((r, i) =>
          ligne(
            `r${i}`,
            `${r.reference} — ${libelleMode(r.mode)}${r.date ? ` — ${formatDate(r.date)}` : ""} — par ${r.auteur}${r.courant ? " (ce reçu)" : ""}`,
            formatMontant(r.montant)
          )
        )}
        {ligne("rt", "Total réglé", formatMontant(h.totalRegle), true)}
      </View>

      {h.retours.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Retours de caisse</Text>
          {h.retours.map((t, i) =>
            ligne(
              `t${i}`,
              `${formatDate(t.date)} — ${t.nul ? "Retour nul" : t.etat}${t.receptionnePar ? ` par ${t.receptionnePar}` : ` (déclaré par ${t.declarant})`} — sur ${t.reglementReference}`,
              formatMontant(t.montant),
              i === h.retours.length - 1
            )
          )}
        </View>
      ) : null}

      {h.depenses.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dépenses déclarées</Text>
          {h.depenses.map((d, i) =>
            ligne(`d${i}`, `${d.libelle} — ${d.etat}`, formatMontant(d.montant), i === h.depenses.length - 1)
          )}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Solde final {portee}</Text>
        {ligne("f1", "Fonds remis (Caisse + Banque)", formatMontant(h.fondsRemis))}
        {ligne("f2", "− Dépenses déclarées", formatMontant(h.totalDepenses))}
        {ligne("f3", "− Retours reçus", formatMontant(h.retoursRecus))}
        {ligne("f4", "= Solde à régulariser", formatMontant(h.solde), true)}
      </View>
    </>
  );
}

/** Rappel de la demande : numéro, demandeur et service. */
export function RappelDemande({ reference, demandeurNom, serviceNom }: { reference: string; demandeurNom: string; serviceNom: string | null }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Demande</Text>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Numéro</Text>
        <Text style={styles.detailValue}>{reference}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Demandeur</Text>
        <Text style={styles.detailValue}>{demandeurNom}</Text>
      </View>
      <View style={[styles.detailRow, { marginBottom: 0 }]}>
        <Text style={styles.detailLabel}>Service</Text>
        <Text style={styles.detailValue}>{serviceNom ?? "—"}</Text>
      </View>
    </View>
  );
}

export interface ReceiptData {
  /** Historique détaillé (lot G) : règlements, retours, dépenses, solde final. */
  historique: HistoriqueImprime;
  recuReference: string;
  demandeReference: string;
  demandeurNom: string;
  /** Service du demandeur (rappel de la demande, lot D). */
  serviceNom: string | null;
  /** Article payé par ce règlement (lot D) ; `null` pour une demande sans article. */
  article: ArticleImprime | null;
  /** Distinct du demandeur (Phase A) — voir `getBeneficiaireNom`. */
  beneficiaireNom: string;
  categorieLabel: string | null;
  objetLabel: string | null;
  /**
   * Répartition explicite par Catégorie de CE règlement (voir CLAUDE.md
   * "Allocation budgétaire explicite par règlement") — renseignée
   * UNIQUEMENT quand le règlement a plusieurs allocations (plusieurs
   * catégories concernées sur la demande) ; dans ce cas `categorieLabel`/
   * `objetLabel` ci-dessus valent `null` (un seul champ "Catégorie" n'aurait
   * plus de sens). Pour un règlement à une seule catégorie (le cas le plus
   * fréquent, DEPENSE_DIRECTE incluse), reste `null` — le rendu existant
   * (`categorieLabel`/`objetLabel`) est inchangé.
   */
  repartitionCategories: { label: string; montant: number }[] | null;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  confirmeLe: Date;
  auteurNom: string;
  /** Section 12.2 : nom(s) du/des validateur(s) — voir `getValidateursNoms` (route.tsx). */
  validateursNoms: string;
  genereLe: Date;
  /** Montant total de la Demande (pas seulement ce règlement). */
  montantDemande: number;
  /** Section 12.2 : `Demande.montantValide`, distinct du montant demandé. */
  montantValide: number;
  /** getTotalRegle(demandeId) au moment de la génération — état le plus à jour, pas figé à la date du règlement. */
  totalRegleADate: number;
  /** getResteARegler(demandeId) — "solde validé restant à régler" (section 12.2), même logique de fraîcheur. */
  resteARegler: number;
}

/**
 * Gabarit du reçu de règlement (Ticket 9), un règlement par reçu.
 *
 * Pas de logo image : à l'origine `logo-sim-blanc.webp` posait un problème
 * de format (WebP non fiablement supporté par le moteur de rendu image de
 * @react-pdf/renderer). Depuis le rehaussement logo/marque (voir CLAUDE.md),
 * `public/logo-sim-blanc.svg` existe, mais @react-pdf/renderer ne rend pas
 * nativement un SVG arbitraire (`<Image>` attend un bitmap ou un composant
 * `react-pdf` dédié, pas un chemin `.svg` — une conversion via une librairie
 * comme `svg-to-pdfkit` serait nécessaire). Choix inchangé pour ce ticket :
 * le nom "SIM ASSURANCES" en texte stylé (graisse 700, lettres espacées),
 * pas de conversion ad hoc. À reprendre si un vrai logo vectoriel dans les
 * PDF devient une priorité.
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

          {data.article ? <ArticleSection article={data.article} /> : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Situation de la demande</Text>
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Montant demandé</Text>
                <Text style={styles.statValueMedium}>{formatMontant(data.montantDemande)}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Montant validé</Text>
                <Text style={styles.statValueMedium}>{formatMontant(data.montantValide)}</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Total réglé à ce jour</Text>
                <Text style={styles.statValueMedium}>{formatMontant(data.totalRegleADate)}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>Solde validé restant à régler</Text>
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

          <HistoriqueSection historique={data.historique} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Détails de la demande</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Demandeur</Text>
              <Text style={styles.detailValue}>{data.demandeurNom}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Service</Text>
              <Text style={styles.detailValue}>{data.serviceNom ?? "—"}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Bénéficiaire</Text>
              <Text style={styles.detailValue}>{data.beneficiaireNom}</Text>
            </View>
            {data.repartitionCategories && data.repartitionCategories.length > 0 ? (
              data.repartitionCategories.map((r, index) => (
                <View
                  key={r.label}
                  style={index === data.repartitionCategories!.length - 1 ? [styles.detailRow, { marginBottom: 0 }] : styles.detailRow}
                >
                  <Text style={styles.detailLabel}>Catégorie ({r.label})</Text>
                  <Text style={styles.detailValue}>{formatMontant(r.montant)}</Text>
                </View>
              ))
            ) : (
              <>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Catégorie</Text>
                  <Text style={styles.detailValue}>{data.categorieLabel ?? "Non renseignée"}</Text>
                </View>
                <View style={[styles.detailRow, { marginBottom: 0 }]}>
                  <Text style={styles.detailLabel}>Objet</Text>
                  <Text style={styles.detailValue}>{data.objetLabel ?? "Non renseigné"}</Text>
                </View>
              </>
            )}
          </View>

          <Text style={styles.auteurLine}>
            Validé par <Text style={styles.auteurNom}>{data.validateursNoms}</Text> — Règlement effectué par{" "}
            <Text style={styles.auteurNom}>{data.auteurNom}</Text>.
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
