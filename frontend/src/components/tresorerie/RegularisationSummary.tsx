import {
  getEcartLigne,
  getRegularisationParArticle,
  LIBELLE_ETAT_REGULARISATION,
  prisma,
  resumeArticlesTermines,
  type AgregatsRegularisation,
  type ArticleRegularisation,
} from "backend";

import { Badge } from "@/components/ui";

import { DetailDepensesRetour } from "./DetailDepensesRetour";

/**
 * Chiffres de régularisation d'une demande ("Fonds remis (Caisse + Banque)",
 * "Dépenses justifiées"/"Dépense sans pièce formelle" (renommé depuis
 * "Dépenses non justifiées" — Tâche "Refonte de la zone 'Régularisation'",
 * voir CLAUDE.md, jamais l'enum `TypeJustification.SANS_PIECE` en base,
 * inchangée), "Retours reçus", "Solde
 * à régulariser" — libellés renommés, voir CLAUDE.md "Renommage de
 * libellés Régularisation/Retour de caisse" puis "Distinction Fonds remis
 * (Caisse + Banque) vs Fonds remis (Caisse seule)" ; variables internes
 * `decaisse`/`ecart` volontairement inchangées) — `decaisse` =
 * `getTotalRegle`, tous modes de règlement confondus, d'où le libellé
 * précisant "(Caisse + Banque)" plutôt que le "Fonds remis" simple utilisé
 * dans le reporting/l'export Excel (ceux-là strictement Caisse, voir la
 * section CLAUDE.md ci-dessus). Server Component autonome, purement
 * informatif par défaut (aucune action) — partagé entre l'écran Finance
 * (section "Régularisation", actionnable via `ClotureActions` à côté, ou
 * en lecture seule une fois clôturée) et l'écran Collaborateur (section
 * "Situation finale"/"Mon tableau de bord", Ticket 7), pour ne jamais
 * dupliquer le calcul de l'écart ni sa mise en couleur.
 *
 * **"Dépenses effectuées" éclaté en "Dépenses justifiées"/"Dépenses non
 * justifiées"** (voir CLAUDE.md "Détail des dépenses sur l'écran de
 * Régularisation") : la somme des deux vaut toujours l'ancien montant
 * unique (`getDepensesDeclareesParJustification`, deux `aggregate` sur le
 * même périmètre que `getDepensesDeclarees`, jamais un second calcul
 * divergent de `ecart`, qui continue d'utiliser la somme des deux).
 *
 * **`canGererJustification`** (défaut `false`) — active l'action "Marquer
 * non justifiée" sur chaque ligne (réservé à l'écran Finance,
 * `treso/finance/demandes/[id]/page.tsx`, permission
 * `treso.receptionner_retour` déjà revérifiée par
 * `marquerDepenseNonJustifieeAction` elle-même côté serveur) — jamais
 * transmis depuis l'écran Collaborateur (`treso/demandes/[id]/page.tsx`),
 * qui reste volontairement en lecture seule sur ses propres dépenses.
 * Implique toujours `showDetail` (voir ci-dessous).
 *
 * **`showDetail`** (défaut = `canGererJustification`, voir Tâche
 * "Traçabilité d'une demande après règlement/clôture") — affiche, EN PLUS
 * de l'éclatement ci-dessus, le détail ligne par ligne des `DepenseLigne`
 * de la demande (pièce jointe consultable) SANS forcément l'action de
 * marquage : permet à l'écran Finance de garder ce détail visible en
 * LECTURE SEULE une fois la demande `CLOTUREE` (plus aucune action
 * possible, mais l'information — quelles dépenses, quelle pièce jointe —
 * ne doit jamais disparaître) en passant `showDetail` seul, sans
 * `canGererJustification`.
 *
 * **Lot E (2026-10-17) — régularisation PAR ARTICLE** : pour une demande à articles, un bloc par article validé
 * (« Article : <libellé> » + bénéficiaire + montant validé) avec ses propres chiffres — Fonds remis, Retours reçus,
 * Dépenses justifiées, Dépenses sans pièce formelle, Reste non détaillé, Solde à régulariser (`getEcartLigne`) — puis le
 * détail de SES retours et dépenses (les actions « Détailler », « Modifier » se font donc dans le contexte de l'article).
 * Un article validé sans règlement apparaît « en attente de règlement » ; une part « non rattachée » (anciens règlements
 * ou retours exceptionnels sans article) est montrée à part, jamais attribuée. Le bloc final donne le total de la demande
 * (somme exacte, égale à `getEcart`). Une demande sans article (dépense directe) garde un seul bloc, comme avant.
 * `audience="DEMANDEUR"` : le demandeur voit la version d'origine du libellé.
 *
 * Même convention que le "Reste à régler" de `ReglementsSection.tsx`
 * (Ticket 4) : `text-success` quand tout est justifié (solde nul),
 * `text-warning` sinon — une alerte informative, pas une erreur bloquante.
 */
export async function RegularisationSummary({
  demandeId,
  montantValide,
  title = "Régularisation",
  canGererJustification = false,
  showDetail = canGererJustification,
  userId = null,
  audience = "FINANCE",
}: {
  demandeId: string;
  montantValide: number;
  title?: string;
  canGererJustification?: boolean;
  showDetail?: boolean;
  /** Compte connecté : conflit d'intérêts (garde 8) du détail des dépenses. */
  userId?: string | null;
  audience?: "FINANCE" | "DEMANDEUR";
}) {
  const [regul, retours] = await Promise.all([
    getRegularisationParArticle(demandeId),
    // Détail des dépenses : un bloc par retour de caisse, même composant que l'écran du retour (2026-10-10).
    showDetail
      ? prisma.retourCaisse.findMany({
          where: { reglement: { demandeId } },
          select: { id: true, reglement: { select: { montant: true, mode: true, ligneDemandeId: true } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const aDesArticles = regul.articles.length > 0;
  const retoursDe = (ligneId: string | null) => retours.filter((r) => r.reglement.ligneDemandeId === ligneId);
  const articlesValides = regul.articles.filter((a) => a.statut === "VALIDEE");
  const articlesNonValides = regul.articles.length - articlesValides.length;
  const nonRattacheAffiche =
    aDesArticles && (regul.aDuNonRattache || regul.nonRattache.fondsRemis !== 0 || regul.nonRattache.retoursRecus !== 0);

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
        {title}
      </h2>

      {aDesArticles ? (
        <>
          {articlesValides.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article validé : rien à régulariser pour l&apos;instant.</p>
          ) : null}
          {articlesValides.map((a) => (
            <BlocArticle key={a.ligneId} article={a} audience={audience}>
              {showDetail && a.agregats.fondsRemis > 0 ? (
                <DetailRetours
                  retours={retoursDe(a.ligneId)}
                  canGererJustification={canGererJustification}
                  userId={userId}
                />
              ) : null}
            </BlocArticle>
          ))}
          {articlesNonValides > 0 ? (
            <p className="text-xs text-muted-foreground">
              {articlesNonValides} article{articlesNonValides > 1 ? "s" : ""} rejeté{articlesNonValides > 1 ? "s" : ""} ou pas encore décidé
              {articlesNonValides > 1 ? "s" : ""} : non concerné{articlesNonValides > 1 ? "s" : ""} par la régularisation.
            </p>
          ) : null}
          {nonRattacheAffiche ? (
            <section data-regularisation-non-rattachee className="space-y-3 rounded-xl border border-dashed border-warning p-4">
              <h3 className="text-sm font-bold text-foreground">Non rattaché à un article</h3>
              <p className="text-xs text-warning">
                Anciens règlements ou retours exceptionnels sans article : jamais attribués à un article au hasard. À rattacher (script de
                rattachement, équipe technique).
              </p>
              <Chiffres agregats={regul.nonRattache} />
              {showDetail ? (
                <DetailRetours retours={retoursDe(null)} canGererJustification={canGererJustification} userId={userId} />
              ) : null}
            </section>
          ) : null}
          <section data-regularisation-total className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-foreground">Total de la demande</h3>
            <Chiffres agregats={regul.total} />
            <p className="text-xs font-medium text-muted-foreground">
              {resumeArticlesTermines(regul.articles.map((a) => ({ termine: a.termine, rejete: a.statut === "REJETEE" })))}.
            </p>
          </section>
        </>
      ) : (
        <>
          <Chiffres agregats={regul.total} />
          {showDetail ? (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Détail des dépenses déclarées</h3>
              {retours.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune dépense déclarée pour l&apos;instant.</p>
              ) : (
                <DetailRetours retours={retours} canGererJustification={canGererJustification} userId={userId} />
              )}
            </div>
          ) : null}
        </>
      )}
      <p className="border-t border-border pt-3 text-xs font-medium text-muted-foreground">
        Montant validé de la demande :{" "}
        <span className="font-bold text-foreground">{montantValide.toLocaleString("fr-FR")} FCFA</span>.
      </p>
    </div>
  );
}

type RetourLigne = { id: string; reglement: { montant: unknown; mode: string; ligneDemandeId: string | null } };

function DetailRetours({
  retours,
  canGererJustification,
  userId,
}: {
  retours: RetourLigne[];
  canGererJustification: boolean;
  userId: string | null;
}) {
  if (retours.length === 0) return <p className="text-sm text-muted-foreground">Aucune dépense déclarée pour l&apos;instant.</p>;
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Détail des dépenses déclarées</h4>
      {retours.map((retour) => (
        <div key={retour.id} className="space-y-2">
          {retours.length > 1 ? (
            <p className="text-xs font-medium text-muted-foreground">
              Règlement {retour.reglement.mode === "CAISSE" ? "Caisse" : "Banque"} de {Number(retour.reglement.montant).toLocaleString("fr-FR")} FCFA
            </p>
          ) : null}
          <DetailDepensesRetour retourId={retour.id} canReceptionner={canGererJustification} userId={userId} />
        </div>
      ))}
    </div>
  );
}

function BlocArticle({
  article,
  audience,
  children,
}: {
  article: ArticleRegularisation;
  audience: "FINANCE" | "DEMANDEUR";
  children?: React.ReactNode;
}) {
  const libelle = audience === "DEMANDEUR" ? article.libelleDemandeur : article.libelle;
  const regle = article.agregats.fondsRemis > 0;
  const variante = article.etat === "REGULARISE" ? "success" : article.etat === "ATTENTE_REGLEMENT" ? "neutral" : article.etat === "ANOMALIE" ? "danger" : "warning";
  return (
    <section data-regularisation-article={article.ligneId} className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Article : {libelle}</h3>
          <p className="text-xs text-muted-foreground">
            Bénéficiaire : {article.beneficiaire} · Montant validé : {article.montantValide.toLocaleString("fr-FR")} FCFA
          </p>
        </div>
        <Badge variant={variante}>
          {article.etat === "REGULARISE" && article.regulariseAt
            ? `Régularisé le ${article.regulariseAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" })}`
            : LIBELLE_ETAT_REGULARISATION[article.etat]}
        </Badge>
      </div>
      {regle ? <Chiffres agregats={article.agregats} /> : <p className="text-sm text-muted-foreground">En attente de règlement : aucun fonds remis pour cet article.</p>}
      {children}
    </section>
  );
}

function Chiffres({ agregats }: { agregats: AgregatsRegularisation }) {
  const ecart = getEcartLigne(agregats);
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Chiffre libelle="Fonds remis (Caisse + Banque)" valeur={agregats.fondsRemis} />
      <Chiffre libelle="Retours reçus" valeur={agregats.retoursRecus} />
      <Chiffre libelle="Dépenses justifiées" valeur={agregats.depensesJustifiees} />
      <Chiffre libelle="Dépenses sans pièce formelle" valeur={agregats.depensesSansPieceFormelle} attention={agregats.depensesSansPieceFormelle > 0} />
      <Chiffre libelle="Reste non détaillé" valeur={agregats.resteNonDetaille} attention={agregats.resteNonDetaille > 0} />
      <Chiffre libelle="Solde à régulariser" valeur={ecart} ton={ecart === 0 ? "success" : "warning"} />
    </dl>
  );
}

function Chiffre({
  libelle,
  valeur,
  attention = false,
  ton,
}: {
  libelle: string;
  valeur: number;
  attention?: boolean;
  ton?: "success" | "warning";
}) {
  const couleur = ton === "success" ? "text-success" : ton === "warning" || attention ? "text-warning" : "text-foreground";
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{libelle}</dt>
      <dd className={`mt-1 text-xl font-black tracking-tight tabular-nums ${couleur}`}>
        {valeur.toLocaleString("fr-FR")} <span className="text-sm font-bold opacity-70">FCFA</span>
      </dd>
    </div>
  );
}
