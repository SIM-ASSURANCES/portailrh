import { getRecapRetourCaisse, resteNonDetailleTotal, type RecapArticle, type RecapRetourCaisse as Recap } from "backend";

import { Badge } from "@/components/ui";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

const VARIANTE: Record<string, "success" | "neutral" | "danger" | "warning"> = {
  REGULARISE: "success",
  ATTENTE_REGLEMENT: "neutral",
  ANOMALIE: "danger",
  A_REGULARISER: "warning",
  REJETE_OU_EN_ATTENTE: "neutral",
};

/**
 * Récapitulatif général du retour de caisse, vu du demandeur (lot G.4) : par article puis pour toute la demande — fonds
 * reçus (Caisse + Banque), retours de caisse (déclarés, reçus, en attente), dépenses justifiées, dépenses sans pièce
 * formelle, reste non détaillé, solde et état. Mêmes chiffres que la régularisation (un seul calcul, `getRecapRetourCaisse`).
 * Aucune information de gestion interne : libellés d'origine du demandeur, ni motif Finance ni catégorie.
 */
export async function RecapRetourCaisse({ demandeId }: { demandeId: string }) {
  const recap = await getRecapRetourCaisse(demandeId);
  if (recap.aucunFonds) return null;
  return (
    <section data-recap-retour-caisse className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
        Récapitulatif de mes fonds et retours de caisse
      </h2>
      {recap.articles.length > 1 || recap.articles.length === 0 ? (
        <>
          {recap.articles.map((a) => (
            <Bloc key={a.ligneId ?? "demande"} titre={`Article : ${a.libelle}`} sousTitre={a.beneficiaire ? `Bénéficiaire : ${a.beneficiaire}` : null} bloc={a} />
          ))}
          <Bloc titre="Total de la demande" sousTitre={null} bloc={recap.total} total />
        </>
      ) : (
        <Bloc titre={`Article : ${recap.articles[0].libelle}`} sousTitre={recap.articles[0].beneficiaire ? `Bénéficiaire : ${recap.articles[0].beneficiaire}` : null} bloc={recap.articles[0]} />
      )}
    </section>
  );
}

type BlocData = Pick<RecapArticle, "fonds" | "retours" | "agregats" | "solde" | "etat" | "libelleEtat"> | Recap["total"];

function Bloc({ titre, sousTitre, bloc, total = false }: { titre: string; sousTitre: string | null; bloc: BlocData; total?: boolean }) {
  const { fonds, retours, agregats, solde } = bloc;
  return (
    <div data-recap-bloc={total ? "total" : "article"} className={`space-y-3 ${total ? "border-t border-border pt-4" : "rounded-xl border border-border p-4"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">{titre}</h3>
          {sousTitre ? <p className="text-xs text-muted-foreground">{sousTitre}</p> : null}
        </div>
        <Badge variant={VARIANTE[bloc.etat]}>{bloc.libelleEtat}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Ligne
          libelle="Fonds reçus (Caisse + Banque)"
          valeur={fcfa(agregats.fondsRemis)}
          detail={`dont Caisse ${fcfa(fonds.caisse)} · Banque ${fcfa(fonds.banque)}`}
        />
        <Ligne
          libelle="Retours de caisse"
          valeur={`${fcfa(retours.recus)} reçus`}
          detail={`${retours.declares} déclaré${retours.declares > 1 ? "s" : ""}${retours.enAttente > 0 ? ` · ${fcfa(retours.enAttente)} en attente de réception` : ""}${retours.parLaFinance > 0 ? ` · dont ${fcfa(retours.parLaFinance)} enregistrés par la Finance (fonds versé par banque)` : ""}`}
        />
        <Ligne libelle="Dépenses justifiées" valeur={fcfa(agregats.depensesJustifiees)} />
        <Ligne libelle="Dépenses sans pièce formelle" valeur={fcfa(agregats.depensesSansPieceFormelle)} attention={agregats.depensesSansPieceFormelle > 0} />
        <Ligne libelle="Reste non détaillé" valeur={fcfa(resteNonDetailleTotal(agregats))} attention={resteNonDetailleTotal(agregats) > 0} />
        <Ligne libelle="Solde à régulariser" valeur={fcfa(solde)} ton={solde === 0 ? "success" : "warning"} />
      </dl>
    </div>
  );
}

function Ligne({ libelle, valeur, detail, attention = false, ton }: { libelle: string; valeur: string; detail?: string; attention?: boolean; ton?: "success" | "warning" }) {
  const couleur = ton === "success" ? "text-success" : ton === "warning" || attention ? "text-warning" : "text-foreground";
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{libelle}</dt>
      <dd className={`mt-1 text-lg font-black tracking-tight tabular-nums ${couleur}`}>{valeur}</dd>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
