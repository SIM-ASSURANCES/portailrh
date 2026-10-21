import Link from "next/link";
import { redirect } from "next/navigation";

import { CategorieCreateForm } from "@/app/(dashboard)/admin/categories/CategorieCreateForm";
import { CategoriesList } from "@/app/(dashboard)/admin/categories/CategoriesList";
import { chargerDesactivations } from "@/app/(dashboard)/admin/categories/desactivations";
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
import { ParametrageCaisseForm } from "./ParametrageCaisseForm";
import { ParametrageCategoriesForm } from "./ParametrageCategoriesForm";
import { ParametragesEnAttente } from "./ParametragesEnAttente";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const VARIANTE_STATUT: Record<StatutParametrageBudget, BadgeVariant> = { EN_ATTENTE: "warning", VALIDE: "success", REFUSE: "danger" };

/**
 * Budgets (lot J, 2026-10-19 ; lot J ter, 2026-10-20 ; lot J quater) — deux onglets :
 *
 * **Budgets** — DEUX sections séparées, sans mélange (lot J quater), chacune avec son tableau, son formulaire, ses actions
 * (soumettre, valider, refuser — seul ou en lot), sa notification et son historique :
 *   - « Budget de caisse » : le solde de caisse réel (jamais un montant saisi) et ses SEUILS (FCFA, orange puis rouge, date d'effet) ;
 *   - « Budgets par catégorie » : une ligne par catégorie (budget en vigueur, consommé, réservé, reste, seuils, statut, alerte).
 * La Finance (`treso.modifier_budget_categorie`) paramètre, le DG (`treso.valider_budget`) valide ou refuse (motif au refus) — un
 * paramétrage n'est utilisable qu'une fois validé et ne modifie jamais l'ancien. Le DG (`treso.decider_dg`) confirme aussi ici les
 * dépassements du seuil rouge que la Finance lui demande (bloc commun aux deux sections, en tête de page). Tout autre compte de
 * l'espace Finance (`treso.voir_dashboard_finance`) consulte.
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
        description="Budget de caisse (solde réel et seuils d'alerte) et budgets par catégorie : deux sections distinctes, paramétrées par la Finance, validées par le DG, avec date d'effet. La gestion des catégories se trouve dans l'onglet « Catégories »."
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

  const desactivations = await chargerDesactivations(categories.flatMap((c) => [c.id, ...c.objets.map((o) => o.id)]));
  // Lot J bis : la Finance (`treso.gerer_categories`) désactive / réactive elle-même ; l'Admin garde ce droit.
  const canToggleActive = admin || hasPermission(session, "treso.gerer_categories");

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
          canToggleActive={canToggleActive}
          lienBudgets={false}
          categories={categories.map((c) => ({
            id: c.id,
            label: c.label,
            isActive: c.isActive,
            budget: budgets[c.id] ? { montant: budgets[c.id].budget, dateDebut: budgets[c.id].dateDebut, dateFin: budgets[c.id].dateFin, seuil: budgets[c.id].seuil } : null,
            desactivation: desactivations.get(c.id) ?? null,
            objets: c.objets.map((o) => ({ id: o.id, label: o.label, isActive: o.isActive, desactivation: desactivations.get(o.id) ?? null })),
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

type ParametrageListe = Awaited<ReturnType<typeof chargerParametragesSection>>[number];

/** Paramétrages d'UNE section, du plus récent au plus ancien (le tableau, la liste « en attente » et l'historique n'y mélangent jamais l'autre). */
function chargerParametragesSection(portee: "GLOBAL" | "CATEGORIE") {
  return prisma.budgetParametrage.findMany({
    where: { portee },
    orderBy: [{ soumisAt: "desc" }],
    take: 100,
    include: { categorie: { select: { label: true } }, soumisPar: { select: { fullName: true } }, decidePar: { select: { fullName: true } } },
  });
}

const TITRE_ATTENTE: Record<string, string> = { GLOBAL: "Seuils du solde de caisse" };

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
  const [contexte, enVigueur, parametragesCaisse, parametragesCategories, dernierParCategorie, depassements] = await Promise.all([
    chargerContexteBudget(),
    getBudgetsCategoriesEnVigueur(),
    chargerParametragesSection("GLOBAL"),
    chargerParametragesSection("CATEGORIE"),
    prisma.budgetParametrage.findMany({
      where: { portee: "CATEGORIE" },
      orderBy: [{ categorieId: "asc" }, { soumisAt: "desc" }],
      distinct: ["categorieId"],
      select: { categorieId: true, statut: true },
    }),
    peutConfirmer
      ? prisma.budgetDepassement.findMany({
          where: { statut: "DEMANDE" },
          orderBy: { demandeAt: "asc" },
          include: { demande: { select: { reference: true } }, demandePar: { select: { fullName: true } } },
        })
      : Promise.resolve([]),
  ]);
  // Toutes les catégories actives (une ligne chacune, même sans budget) et celles, désactivées, qui ont encore un budget en vigueur.
  const categories = await prisma.categorie.findMany({
    where: { OR: [{ isActive: true }, { id: { in: Object.keys(contexte.categories) } }] },
    select: { id: true, label: true, isActive: true },
    orderBy: { label: "asc" },
  });

  const global = contexte.global;
  const resteGlobal = global ? global.budget - global.reserve : 0;
  const caisseEnAttente = parametragesCaisse.filter((p) => p.statut === "EN_ATTENTE");
  const categoriesEnAttenteListe = parametragesCategories.filter((p) => p.statut === "EN_ATTENTE");
  const categoriesEnAttente = new Set(categoriesEnAttenteListe.map((p) => p.categorieId as string));
  const statutCategorie = new Map(dernierParCategorie.map((d) => [d.categorieId as string, d.statut]));
  const statutCaisse = parametragesCaisse[0]?.statut ?? null;

  return (
    <div className="space-y-10">
      {peutConfirmer ? (
        <section data-depassements-a-confirmer className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          <h2 className="text-lg font-semibold text-foreground">Dépassements à confirmer ({depassements.length})</h2>
          <p className="text-xs text-muted-foreground">Validations bloquées par un seuil rouge (budget de caisse ou d&apos;une catégorie) : la Finance attend votre confirmation, avec motif.</p>
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

      {/* ───────────── Section 1 : budget de caisse ───────────── */}
      <section data-section-caisse aria-labelledby="titre-section-caisse" className="space-y-5">
        <header className="border-b-2 border-primary pb-2">
          <h2 id="titre-section-caisse" className="text-xl font-black text-foreground">Budget de caisse</h2>
          <p className="text-sm text-muted-foreground">
            Le budget de caisse est le solde de caisse réel (journal de caisse) : aucun montant n&apos;est saisi. La Finance en règle les seuils d&apos;alerte, le DG les valide.
          </p>
        </header>

        <div data-budgets-caisse className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          {global ? (
            <div data-budget-ligne="global" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">Solde de caisse et seuils en vigueur</p>
                  <p className="text-xs text-muted-foreground">Les règlements banque n&apos;y touchent pas.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {statutCaisse ? (
                    <span data-statut-caisse={statutCaisse} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      Dernier paramétrage : <Badge variant={VARIANTE_STATUT[statutCaisse]}>{libelleStatutParametrage(statutCaisse)}</Badge>
                    </span>
                  ) : null}
                  <BadgeNiveauBudget niveau={niveauAlerte(resteGlobal, global.budget, global.seuil)} />
                </div>
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
                  <dt className="text-xs uppercase text-muted-foreground">Seuils d&apos;alerte (FCFA)</dt>
                  <dd className="text-xs text-foreground">{libelleSeuil(global.seuil)}</dd>
                  {global.dateDebut ? <dd className="text-xs text-muted-foreground">{libellePeriodeBudget(global.dateDebut, global.dateFin ?? null)}</dd> : <dd className="text-xs text-muted-foreground">Aucun seuil validé : pas d&apos;alerte.</dd>}
                </div>
              </dl>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Le solde prévisionnel retranche l&apos;argent déjà validé qui n&apos;est pas encore sorti de la caisse. À la validation, le mode de règlement (caisse ou banque) n&apos;est pas encore connu :
            on suppose la caisse. Des seuils en attente du DG ou refusés ne sont jamais pris en compte.
          </p>
        </div>

        {peutValider || caisseEnAttente.length > 0 ? (
          <div data-parametrages-a-valider data-parametrages-caisse className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
            <h3 className="text-base font-semibold text-foreground">Seuils de caisse en attente du DG ({caisseEnAttente.length})</h3>
            <ListeEnAttente parametrages={caisseEnAttente} portee="GLOBAL" peutValider={peutValider} userId={session.user.id} />
          </div>
        ) : null}

        {peutParametrer ? (
          <div data-nouveau-parametrage data-nouveau-parametrage-caisse className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
            <h3 className="text-base font-semibold text-foreground">Nouveaux seuils de caisse</h3>
            <p className="text-sm text-muted-foreground">
              Soumis au DG, ils ne remplacent les seuils en vigueur qu&apos;une fois validés, à leur date d&apos;effet. Les anciens ne sont jamais modifiés.
            </p>
            <ParametrageCaisseForm aujourdhui={jourCourantBudget()} actuel={global?.seuil ?? null} enAttente={caisseEnAttente.length > 0} />
          </div>
        ) : null}

        <HistoriqueSection portee="GLOBAL" parametrages={parametragesCaisse} />
      </section>

      {/* ───────────── Section 2 : budgets par catégorie ───────────── */}
      <section data-section-categories aria-labelledby="titre-section-categories" className="space-y-5">
        <header className="border-b-2 border-primary pb-2">
          <h2 id="titre-section-categories" className="text-xl font-black text-foreground">Budgets par catégorie</h2>
          <p className="text-sm text-muted-foreground">
            Chaque catégorie a son propre budget : un montant, une période et des seuils d&apos;alerte, consommé au règlement. La Finance les paramètre, le DG les valide.
          </p>
        </header>

        <div data-budgets-categories className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune catégorie. Créez-en dans l&apos;onglet « Catégories ».</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Catégorie</th>
                    <th className="py-2 pr-3 text-right">Budget en vigueur</th>
                    <th className="py-2 pr-3 text-right">Consommé</th>
                    <th className="py-2 pr-3 text-right">Réservé</th>
                    <th className="py-2 pr-3 text-right">Reste</th>
                    <th className="py-2 pr-3">Période</th>
                    <th className="py-2 pr-3">Seuils</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2">Alerte</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => {
                    const p = contexte.categories[c.id];
                    const b = enVigueur[c.id];
                    const reste = p ? p.budget - p.reserve : null;
                    const statut = statutCategorie.get(c.id) ?? null;
                    return (
                      <tr key={c.id} data-budget-ligne={c.label} className="border-t border-border">
                        <td className="py-2 pr-3 font-semibold">{c.label}{c.isActive ? "" : " (désactivée)"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p ? fcfa(p.budget) : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums" title="Consommé au règlement depuis le début d'effet">{p ? fcfa(p.consomme ?? 0) : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums" title="Le plus grand du consommé au règlement et du montant validé (engagé)">{p ? fcfa(p.reserve) : "—"}</td>
                        <td className="py-2 pr-3 text-right font-black tabular-nums" data-reste-budget>{reste != null ? fcfa(reste) : "—"}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{b ? libellePeriodeBudget(b.dateDebut, b.dateFin) : "—"}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{p ? libelleSeuil(p.seuil) : "—"}</td>
                        <td className="py-2 pr-3" data-statut-categorie={statut ?? "AUCUN"}>
                          {categoriesEnAttente.has(c.id) ? (
                            <Badge variant="warning">{libelleStatutParametrage("EN_ATTENTE")}</Badge>
                          ) : statut === "REFUSE" ? (
                            // Lot J bis : un refus ne retire jamais le budget déjà en vigueur — la ligne le dit en toutes lettres.
                            <div data-dernier-parametrage-refuse className="space-y-1">
                              <Badge variant={VARIANTE_STATUT.REFUSE}>Dernier paramétrage refusé</Badge>
                              <p className="text-xs text-muted-foreground" data-budget-conserve>
                                {p && b ? `Budget en vigueur conservé : ${fcfa(p.budget)} (${libellePeriodeBudget(b.dateDebut, b.dateFin)}).` : "Aucun budget en vigueur."}
                              </p>
                            </div>
                          ) : statut ? (
                            <Badge variant={VARIANTE_STATUT[statut]}>{libelleStatutParametrage(statut)}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Aucun paramétrage</span>
                          )}
                        </td>
                        <td className="py-2">{p && reste != null ? <BadgeNiveauBudget niveau={niveauAlerte(reste, p.budget, p.seuil)} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Un budget de catégorie se consomme au règlement ; « Réservé » compte aussi ce qui est déjà validé et pas encore réglé, pour que le reste baisse dès la validation. Un budget en
            attente du DG ou refusé n&apos;est jamais pris en compte.
          </p>
        </div>

        {peutValider || categoriesEnAttenteListe.length > 0 ? (
          <div data-parametrages-a-valider data-parametrages-categories className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
            <h3 className="text-base font-semibold text-foreground">Budgets de catégorie en attente du DG ({categoriesEnAttenteListe.length})</h3>
            <ListeEnAttente parametrages={categoriesEnAttenteListe} portee="CATEGORIE" peutValider={peutValider} userId={session.user.id} />
          </div>
        ) : null}

        {peutParametrer ? (
          <div data-nouveau-parametrage data-nouveau-parametrage-categories className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
            <h3 className="text-base font-semibold text-foreground">Nouveau paramétrage de catégorie</h3>
            <p className="text-sm text-muted-foreground">
              Cochez un ou plusieurs budgets : ils sont soumis au DG en une fois et ne remplacent le budget en vigueur qu&apos;une fois validés, à leur date d&apos;effet.
              L&apos;ancien paramétrage n&apos;est jamais modifié.
            </p>
            <ParametrageCategoriesForm
              aujourdhui={jourCourantBudget()}
              categories={categories
                .filter((c) => c.isActive)
                .map((c) => ({
                  id: c.id,
                  label: c.label,
                  actuel: enVigueur[c.id] ? { montant: enVigueur[c.id].budget, seuil: enVigueur[c.id].seuil } : null,
                  enAttente: categoriesEnAttente.has(c.id),
                }))}
            />
          </div>
        ) : null}

        <HistoriqueSection portee="CATEGORIE" parametrages={parametragesCategories} />
      </section>
    </div>
  );
}

/** Paramétrages d'une section en attente du DG : le DG décide (seul ou en lot), les autres comptes consultent. */
function ListeEnAttente({ parametrages, portee, peutValider, userId }: { parametrages: ParametrageListe[]; portee: "GLOBAL" | "CATEGORIE"; peutValider: boolean; userId: string }) {
  if (parametrages.length === 0) return <p className="text-sm text-muted-foreground">Aucun paramétrage en attente.</p>;
  const titre = (p: ParametrageListe) => (p.categorie ? `Catégorie « ${p.categorie.label} »` : TITRE_ATTENTE.GLOBAL);
  const detail = (p: ParametrageListe) => {
    const v = versParametrage(p);
    return `${v.montant != null ? `${fcfa(v.montant)}, ` : ""}${libellePeriodeBudget(v.dateDebut, v.dateFin)}. ${libelleSeuil(v.seuil)}.`;
  };
  if (peutValider) {
    return (
      <ParametragesEnAttente
        portee={portee}
        items={parametrages.map((p) => ({
          id: p.id,
          titre: titre(p),
          detail: detail(p),
          soumisPar: `Soumis par ${p.soumisPar?.fullName ?? "—"} le ${fr(p.soumisAt)}`,
          soiMeme: p.soumisParId === userId,
        }))}
      />
    );
  }
  return (
    <ul className="space-y-3">
      {parametrages.map((p) => (
        <li key={p.id} data-parametrage-attente={p.id} className="space-y-1 rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{titre(p)}</span> — {detail(p)}
          </p>
          <p className="text-xs text-muted-foreground">Soumis par {p.soumisPar?.fullName ?? "—"} le {fr(p.soumisAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/** Historique d'UNE section (jamais mélangé avec l'autre) : chaque paramétrage, son statut et son suivi. */
function HistoriqueSection({ portee, parametrages }: { portee: "GLOBAL" | "CATEGORIE"; parametrages: ParametrageListe[] }) {
  const caisse = portee === "GLOBAL";
  return (
    <div {...(caisse ? { "data-historique-caisse": "" } : { "data-historique-categories": "" })} data-historique-budgets className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
      <h3 className="text-base font-semibold text-foreground">{caisse ? "Historique des seuils de caisse" : "Historique des budgets de catégorie"}</h3>
      {parametrages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun paramétrage.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                {caisse ? null : <th className="py-2 pr-3">Catégorie</th>}
                {caisse ? null : <th className="py-2 pr-3 text-right">Montant</th>}
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
                    {caisse ? null : <td className="py-2 pr-3 font-semibold">{p.categorie?.label ?? "—"}</td>}
                    {caisse ? null : <td className="py-2 pr-3 text-right tabular-nums">{v.montant != null ? fcfa(v.montant) : "—"}</td>}
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
    </div>
  );
}
