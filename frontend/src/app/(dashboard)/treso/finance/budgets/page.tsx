import { redirect } from "next/navigation";

import { BadgeNiveauBudget } from "@/components/tresorerie/BudgetPrevision";
import { Badge, PageHeader, type BadgeVariant } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  chargerContexteBudget,
  getBudgetsCategoriesEnVigueur,
  jourCourantBudget,
  libellePeriodeBudget,
  libelleSeuil,
  libelleStatutParametrage,
  niveauAlerte,
  prisma,
  versParametrage,
  type StatutParametrageBudget,
} from "backend";

import { ConfirmerDepassement } from "./ConfirmerDepassement";
import { DecisionParametrage } from "./DecisionParametrage";
import { ParametrageBudgetForm } from "./ParametrageBudgetForm";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const VARIANTE_STATUT: Record<StatutParametrageBudget, BadgeVariant> = { EN_ATTENTE: "warning", VALIDE: "success", REFUSE: "danger" };

/**
 * Budgets (lot J, 2026-10-19). La Finance (`treso.modifier_budget_categorie`) paramètre le budget global et ceux des catégories
 * (montant, date d'effet, seuils d'alerte) et les SOUMET au DG ; le DG (`treso.valider_budget`) valide ou refuse (motif) — un
 * paramétrage n'est utilisable qu'une fois validé et ne modifie jamais l'ancien (il le remplace à sa date d'effet). Le DG
 * (`treso.decider_dg`) confirme aussi ici les dépassements du seuil rouge que la Finance lui demande. Tout autre compte de
 * l'espace Finance (`treso.voir_dashboard_finance`) consulte.
 */
export default async function BudgetsPage() {
  const session = await getSession();
  const peutParametrer = !!session && hasPermission(session, "treso.modifier_budget_categorie");
  const peutValider = !!session && hasPermission(session, "treso.valider_budget");
  const peutConfirmer = !!session && hasPermission(session, "treso.decider_dg");
  if (!session || !(peutParametrer || peutValider || peutConfirmer || hasPermission(session, "treso.voir_dashboard_finance"))) {
    redirect("/?error=acces_refuse_budgets");
  }

  const [contexte, enVigueur, categories, parametrages, depassements] = await Promise.all([
    chargerContexteBudget(),
    getBudgetsCategoriesEnVigueur(),
    prisma.categorie.findMany({ where: { isActive: true }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    prisma.budgetParametrage.findMany({
      orderBy: [{ soumisAt: "desc" }],
      take: 100,
      include: { categorie: { select: { label: true } }, soumisPar: { select: { fullName: true } }, decidePar: { select: { fullName: true } } },
    }),
    peutConfirmer
      ? prisma.budgetDepassement.findMany({
          where: { statut: "DEMANDE" },
          orderBy: { demandeAt: "asc" },
          include: { demande: { select: { reference: true } }, demandePar: { select: { fullName: true } } },
        })
      : Promise.resolve([]),
  ]);

  const perimetres = [contexte.global, ...Object.values(contexte.categories).sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"))].filter(
    (p): p is NonNullable<typeof p> => !!p
  );
  const enAttente = parametrages.filter((p) => p.statut === "EN_ATTENTE");

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Budgets"
        description="Budget global et budgets par catégorie : paramétrés par la Finance, validés par le DG, avec date d'effet et seuils d'alerte."
      />

      <section data-budgets-en-vigueur className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
        <h2 className="text-lg font-semibold text-foreground">Budgets en vigueur</h2>
        {perimetres.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun budget en vigueur : aucune alerte ne s&apos;applique.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Budget</th>
                  <th className="py-2 pr-3 text-right">Montant</th>
                  <th className="py-2 pr-3 text-right">Réservé</th>
                  <th className="py-2 pr-3 text-right">Reste</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Seuils</th>
                  <th className="py-2">Niveau</th>
                </tr>
              </thead>
              <tbody>
                {perimetres.map((p) => {
                  const reste = p.budget - p.reserve;
                  const parametrage = parametrages.find((x) => x.id === p.parametrageId);
                  const b = p.categorieId ? enVigueur[p.categorieId] : null;
                  return (
                    <tr key={p.parametrageId} data-budget-ligne={p.portee === "GLOBAL" ? "global" : p.libelle} className="border-t border-border">
                      <td className="py-2 pr-3 font-semibold">{p.portee === "GLOBAL" ? "Budget global" : p.libelle}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fcfa(p.budget)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" title="Le plus grand du consommé au règlement et du montant validé (engagé)">
                        {fcfa(p.reserve)}
                      </td>
                      <td className="py-2 pr-3 text-right font-black tabular-nums" data-reste-budget>
                        {fcfa(reste)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {b ? libellePeriodeBudget(b.dateDebut, b.dateFin) : parametrage ? libellePeriodeBudget(parametrage.dateDebut.toISOString().slice(0, 10), parametrage.dateFin ? parametrage.dateFin.toISOString().slice(0, 10) : null) : ""}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{libelleSeuil(p.seuil)}</td>
                      <td className="py-2">
                        <BadgeNiveauBudget niveau={niveauAlerte(reste, p.budget, p.seuil)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Le budget se consomme au règlement. « Réservé » compte aussi ce qui est déjà validé et pas encore réglé, pour que le reste
          baisse dès la validation. Un budget en attente du DG ou refusé n&apos;est jamais pris en compte.
        </p>
      </section>

      {peutConfirmer ? (
        <section data-depassements-a-confirmer className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          <h2 className="text-lg font-semibold text-foreground">Dépassements à confirmer ({depassements.length})</h2>
          {depassements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune confirmation demandée.</p>
          ) : (
            <ul className="space-y-4">
              {depassements.map((d) => (
                <li key={d.id} data-depassement={d.id} className="space-y-2 rounded-lg border border-danger-border bg-danger-bg/30 p-3">
                  <p className="text-sm font-semibold text-foreground">
                    Demande {d.demande.reference} — demandé par {d.demandePar.fullName} le {fr(d.demandeAt)}
                  </p>
                  <p className="text-sm text-foreground">{d.resume}</p>
                  <ConfirmerDepassement id={d.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {peutValider || enAttente.length > 0 ? (
        <section data-parametrages-a-valider className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          <h2 className="text-lg font-semibold text-foreground">Paramétrages en attente du DG ({enAttente.length})</h2>
          {enAttente.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun paramétrage en attente.</p>
          ) : (
            <ul className="space-y-3">
              {enAttente.map((p) => {
                const v = versParametrage(p);
                const soiMeme = p.soumisParId === session.user.id;
                return (
                  <li key={p.id} data-parametrage-attente={p.id} className="space-y-2 rounded-lg border border-border p-3">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{p.categorie ? `Catégorie « ${p.categorie.label} »` : "Budget global"}</span> — {fcfa(v.montant)},{" "}
                      {libellePeriodeBudget(v.dateDebut, v.dateFin)}. {libelleSeuil(v.seuil)}.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Soumis par {p.soumisPar?.fullName ?? "—"} le {fr(p.soumisAt)}
                    </p>
                    {peutValider ? (
                      <DecisionParametrage id={p.id} desactive={soiMeme} raison={soiMeme ? "Vous ne pouvez pas décider un paramétrage que vous avez soumis." : undefined} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {peutParametrer ? (
        <section data-nouveau-parametrage className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          <h2 className="text-lg font-semibold text-foreground">Nouveau paramétrage</h2>
          <p className="text-sm text-muted-foreground">
            Il est soumis au DG et ne remplace le budget en vigueur qu&apos;une fois validé, à sa date d&apos;effet. L&apos;ancien paramétrage n&apos;est jamais modifié.
          </p>
          <ParametrageBudgetForm categories={categories} aujourdhui={jourCourantBudget()} />
        </section>
      ) : null}

      <section data-historique-budgets className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
        <h2 className="text-lg font-semibold text-foreground">Historique des paramétrages</h2>
        {parametrages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun paramétrage.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Budget</th>
                  <th className="py-2 pr-3 text-right">Montant</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Seuils</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2">Suivi</th>
                </tr>
              </thead>
              <tbody>
                {parametrages.map((p) => {
                  const v = versParametrage(p);
                  return (
                    <tr key={p.id} data-parametrage={p.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-semibold">{p.categorie ? p.categorie.label : "Global"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fcfa(v.montant)}</td>
                      <td className="py-2 pr-3 text-xs">{libellePeriodeBudget(v.dateDebut, v.dateFin)}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{libelleSeuil(v.seuil)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={VARIANTE_STATUT[p.statut]}>{libelleStatutParametrage(p.statut)}</Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {p.repris ? "Budget existant repris au déploiement (validé d'office)." : `Soumis par ${p.soumisPar?.fullName ?? "—"} le ${fr(p.soumisAt)}.`}
                        {p.decideAt && !p.repris ? ` ${p.statut === "VALIDE" ? "Validé" : "Refusé"} par ${p.decidePar?.fullName ?? "—"} le ${fr(p.decideAt)}.` : ""}
                        {p.motifRefus ? ` Motif : ${p.motifRefus}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
