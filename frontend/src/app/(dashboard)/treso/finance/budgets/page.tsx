import Link from "next/link";
import { redirect } from "next/navigation";

import { CategorieCreateForm } from "@/app/(dashboard)/admin/categories/CategorieCreateForm";
import { CategoriesList } from "@/app/(dashboard)/admin/categories/CategoriesList";
import { BadgeNiveauBudget } from "@/components/tresorerie/BudgetPrevision";
import { Badge, PageHeader, type BadgeVariant } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import {
  chargerContexteBudget,
  chargerRegleCategorisation,
  ENTITE_PARAMETRE_TRESORERIE,
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

import { CategorisationObligatoireDate } from "./CategorisationObligatoireDate";
import { ConfirmerDepassement } from "./ConfirmerDepassement";
import { ParametrageBudgetForm } from "./ParametrageBudgetForm";
import { ParametragesEnAttente } from "./ParametragesEnAttente";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const VARIANTE_STATUT: Record<StatutParametrageBudget, BadgeVariant> = { EN_ATTENTE: "warning", VALIDE: "success", REFUSE: "danger" };

/**
 * Budgets (lot J, 2026-10-19 ; lot J ter, 2026-10-20) — deux onglets :
 *
 * **Budgets** — la Finance (`treso.modifier_budget_categorie`) paramètre les budgets de catégorie (montant, date d'effet, seuils) et
 * les SEUILS du solde de caisse (le budget global n'est plus un montant saisi : c'est le solde de caisse réel), seul ou en lot ; le
 * DG (`treso.valider_budget`) valide ou refuse seul ou en lot (motif au refus) — un paramétrage n'est utilisable qu'une fois validé et
 * ne modifie jamais l'ancien. Le DG (`treso.decider_dg`) confirme aussi ici les dépassements du seuil rouge que la Finance lui demande.
 * Tout autre compte de l'espace Finance (`treso.voir_dashboard_finance`) consulte.
 *
 * **Catégories** — ancienne page `/treso/finance/categories` (Admin ou `treso.gerer_categories`), fusionnée ici sans perdre aucune
 * fonction : règle « catégorisation obligatoire à partir d'une date » (lot I), création de catégorie, liste avec création d'objet,
 * suppression de catégorie ou d'objet, activation/désactivation (Admin seul, inchangé), budget en vigueur en lecture seule.
 * Chaque Server Action revérifie sa permission, jamais seulement le masquage de l'onglet.
 */
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const peutParametrer = !!session && hasPermission(session, "treso.modifier_budget_categorie");
  const peutValider = !!session && hasPermission(session, "treso.valider_budget");
  const peutConfirmer = !!session && hasPermission(session, "treso.decider_dg");
  const peutVoirBudgets = !!session && (peutParametrer || peutValider || peutConfirmer || hasPermission(session, "treso.voir_dashboard_finance"));
  const peutGererCategories = !!session && (isAdmin(session) || hasPermission(session, "treso.gerer_categories"));
  if (!session || !(peutVoirBudgets || peutGererCategories)) {
    redirect("/?error=acces_refuse_budgets");
  }

  const params = await searchParams;
  const demande = Array.isArray(params.onglet) ? params.onglet[0] : params.onglet;
  const onglet: "budgets" | "categories" = demande === "categories" && peutGererCategories ? "categories" : peutVoirBudgets ? "budgets" : "categories";

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Budgets"
        description="Budget global (solde de caisse) et budgets par catégorie : seuils et montants paramétrés par la Finance, validés par le DG, avec date d'effet. La gestion des catégories se trouve dans l'onglet « Catégories »."
      />

      {peutVoirBudgets && peutGererCategories ? (
        <nav data-onglets-budgets className="flex gap-2 border-b border-border" aria-label="Sections">
          <Link
            href="/treso/finance/budgets"
            data-onglet="budgets"
            aria-current={onglet === "budgets" ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${onglet === "budgets" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Budgets
          </Link>
          <Link
            href="/treso/finance/budgets?onglet=categories"
            data-onglet="categories"
            aria-current={onglet === "categories" ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${onglet === "categories" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Catégories
          </Link>
        </nav>
      ) : null}

      {onglet === "budgets" ? (
        <OngletBudgets session={session} peutParametrer={peutParametrer} peutValider={peutValider} peutConfirmer={peutConfirmer} />
      ) : (
        <OngletCategories session={session} />
      )}
    </div>
  );
}

type SessionBudget = NonNullable<Awaited<ReturnType<typeof getSession>>>;

async function OngletCategories({ session }: { session: SessionBudget }) {
  const admin = isAdmin(session);
  const canModifierBudget = admin || hasPermission(session, "treso.modifier_budget_categorie");

  const [budgets, categories, regle, historiqueRegle] = await Promise.all([
    getBudgetsCategoriesEnVigueur(),
    prisma.categorie.findMany({ include: { objets: { orderBy: { label: "asc" } } }, orderBy: { label: "asc" } }),
    chargerRegleCategorisation(),
    prisma.historiqueEntry.findMany({
      where: { entity: ENTITE_PARAMETRE_TRESORERIE },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { fullName: true } } },
    }),
  ]);

  return (
    <div data-onglet-categories className="space-y-8">
      <section className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
        <h2 className="text-lg font-semibold text-foreground">Catégorisation obligatoire pour valider</h2>
        <CategorisationObligatoireDate dateActuelle={regle.dateDebut} phrase={regle.libelle} />
        {historiqueRegle.length > 0 ? (
          <ul data-historique-parametre className="space-y-1 text-xs text-muted-foreground">
            {historiqueRegle.map((h) => (
              <li key={h.id}>
                {h.createdAt.toLocaleString("fr-FR")} — {h.user.fullName} : {h.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouvelle catégorie</h2>
        <CategorieCreateForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Catégories existantes</h2>
        <CategoriesList
          isAdmin={admin}
          canModifierBudget={canModifierBudget}
          lienBudgets={false}
          categories={categories.map((c) => ({
            id: c.id,
            label: c.label,
            isActive: c.isActive,
            budget: budgets[c.id] ? { montant: budgets[c.id].budget, dateDebut: budgets[c.id].dateDebut, dateFin: budgets[c.id].dateFin, seuil: budgets[c.id].seuil } : null,
            objets: c.objets.map((o) => ({ id: o.id, label: o.label, isActive: o.isActive })),
          }))}
        />
        {canModifierBudget ? (
          <p className="text-xs text-muted-foreground">
            Les budgets de catégorie se paramètrent dans l&apos;onglet{" "}
            <Link href="/treso/finance/budgets" className="font-semibold text-primary hover:underline">
              Budgets
            </Link>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}

async function OngletBudgets({
  session,
  peutParametrer,
  peutValider,
  peutConfirmer,
}: {
  session: SessionBudget;
  peutParametrer: boolean;
  peutValider: boolean;
  peutConfirmer: boolean;
}) {
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

  const categoriesAvecBudget = Object.values(contexte.categories).sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  const enAttente = parametrages.filter((p) => p.statut === "EN_ATTENTE");
  const global = contexte.global;
  const resteGlobal = global ? global.budget - global.reserve : 0;
  const categoriesEnAttente = new Set(enAttente.filter((p) => p.categorieId).map((p) => p.categorieId as string));
  const globalEnAttente = enAttente.some((p) => p.portee === "GLOBAL");

  return (
    <div className="space-y-8">
      <section data-budgets-en-vigueur className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
        <h2 className="text-lg font-semibold text-foreground">Budgets en vigueur</h2>

        {global ? (
          <div data-budget-ligne="global" className="space-y-2 rounded-xl border border-border bg-info-bg/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">Budget global = solde de caisse</p>
                <p className="text-xs text-muted-foreground">
                  Le solde de caisse réel (journal de caisse), jamais un montant saisi. Les règlements banque n&apos;y touchent pas.
                </p>
              </div>
              <BadgeNiveauBudget niveau={niveauAlerte(resteGlobal, global.budget, global.seuil)} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Solde de caisse actuel</dt>
                <dd data-solde-caisse className="font-black tabular-nums">{fcfa(global.budget)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground" title="Règlements en caisse à confirmer, plus l'argent validé qui n'a pas encore de règlement (mode non encore connu, supposé en caisse)">
                  Déjà validé, pas encore sorti
                </dt>
                <dd className="font-black tabular-nums" data-engage-caisse>{fcfa(global.reserve)}</dd>
                {global.caisse ? (
                  <p className="text-xs text-muted-foreground">
                    dont règlements Caisse à confirmer {fcfa(global.caisse.engageCaisseConnu)} ; validé sans règlement {fcfa(global.caisse.engageModeInconnu)}
                  </p>
                ) : null}
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Solde prévisionnel</dt>
                <dd data-reste-budget className={`font-black tabular-nums ${resteGlobal < 0 ? "text-danger" : ""}`}>{fcfa(resteGlobal)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Seuils d&apos;alerte</dt>
                <dd className="text-xs text-foreground">{libelleSeuil(global.seuil)}</dd>
                {global.dateDebut ? <dd className="text-xs text-muted-foreground">{libellePeriodeBudget(global.dateDebut, global.dateFin ?? null)}</dd> : <dd className="text-xs text-muted-foreground">Aucun seuil validé : pas d&apos;alerte.</dd>}
              </div>
            </dl>
          </div>
        ) : null}

        {categoriesAvecBudget.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun budget de catégorie en vigueur : aucune alerte de catégorie ne s&apos;applique.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Catégorie</th>
                  <th className="py-2 pr-3 text-right">Montant</th>
                  <th className="py-2 pr-3 text-right">Réservé</th>
                  <th className="py-2 pr-3 text-right">Reste</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Seuils</th>
                  <th className="py-2">Niveau</th>
                </tr>
              </thead>
              <tbody>
                {categoriesAvecBudget.map((p) => {
                  const reste = p.budget - p.reserve;
                  const b = p.categorieId ? enVigueur[p.categorieId] : null;
                  return (
                    <tr key={p.parametrageId ?? p.libelle} data-budget-ligne={p.libelle} className="border-t border-border">
                      <td className="py-2 pr-3 font-semibold">{p.libelle}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fcfa(p.budget)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" title="Le plus grand du consommé au règlement et du montant validé (engagé)">
                        {fcfa(p.reserve)}
                      </td>
                      <td className="py-2 pr-3 text-right font-black tabular-nums" data-reste-budget>
                        {fcfa(reste)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{b ? libellePeriodeBudget(b.dateDebut, b.dateFin) : ""}</td>
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
          Un budget de catégorie se consomme au règlement ; « Réservé » compte aussi ce qui est déjà validé et pas encore réglé, pour que le reste
          baisse dès la validation. Le budget global est le solde de caisse : la validation en cours s&apos;y retranche, sans savoir si le règlement
          se fera en caisse ou par banque (le mode n&apos;est choisi qu&apos;au règlement) — on suppose la caisse. Un budget en attente du DG ou refusé n&apos;est jamais pris en compte.
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
          ) : peutValider ? (
            <ParametragesEnAttente
              items={enAttente.map((p) => {
                const v = versParametrage(p);
                return {
                  id: p.id,
                  titre: p.categorie ? `Catégorie « ${p.categorie.label} »` : "Solde de caisse (budget global)",
                  detail: `${v.montant != null ? `${fcfa(v.montant)}, ` : ""}${libellePeriodeBudget(v.dateDebut, v.dateFin)}. ${libelleSeuil(v.seuil)}.`,
                  soumisPar: `Soumis par ${p.soumisPar?.fullName ?? "—"} le ${fr(p.soumisAt)}`,
                  soiMeme: p.soumisParId === session.user.id,
                };
              })}
            />
          ) : (
            <ul className="space-y-3">
              {enAttente.map((p) => {
                const v = versParametrage(p);
                return (
                  <li key={p.id} data-parametrage-attente={p.id} className="space-y-1 rounded-lg border border-border p-3">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{p.categorie ? `Catégorie « ${p.categorie.label} »` : "Solde de caisse (budget global)"}</span> — {v.montant != null ? `${fcfa(v.montant)}, ` : ""}
                      {libellePeriodeBudget(v.dateDebut, v.dateFin)}. {libelleSeuil(v.seuil)}.
                    </p>
                    <p className="text-xs text-muted-foreground">Soumis par {p.soumisPar?.fullName ?? "—"} le {fr(p.soumisAt)}</p>
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
            Cochez un ou plusieurs budgets : ils sont soumis au DG en une fois et ne remplacent le budget en vigueur qu&apos;une fois validés, à leur date d&apos;effet.
            L&apos;ancien paramétrage n&apos;est jamais modifié.
          </p>
          <ParametrageBudgetForm
            aujourdhui={jourCourantBudget()}
            global={{ actuel: global?.seuil ?? null, enAttente: globalEnAttente }}
            categories={categories.map((c) => ({
              id: c.id,
              label: c.label,
              actuel: enVigueur[c.id] ? { montant: enVigueur[c.id].budget, seuil: enVigueur[c.id].seuil } : null,
              enAttente: categoriesEnAttente.has(c.id),
            }))}
          />
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
                      <td className="py-2 pr-3 font-semibold">{p.categorie ? p.categorie.label : "Solde de caisse (global)"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.montant != null ? fcfa(v.montant) : "Solde réel"}</td>
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
