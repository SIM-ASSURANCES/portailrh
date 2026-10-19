import { redirect } from "next/navigation";

import { CategoriesList } from "@/app/(dashboard)/admin/categories/CategoriesList";
import { CategorieCreateForm } from "@/app/(dashboard)/admin/categories/CategorieCreateForm";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { chargerRegleCategorisation, ENTITE_PARAMETRE_TRESORERIE, getBudgetsCategoriesEnVigueur, prisma } from "backend";

import { CategorisationObligatoireDate } from "./CategorisationObligatoireDate";

/**
 * Gestion des Catégories/Objets ouverte à Finance (voir CLAUDE.md "Gestion
 * des Catégories/Objets ouverte à Finance") — second point d'entrée vers le
 * même écran que `/admin/categories`, réutilisant EXACTEMENT les mêmes
 * composants (`CategoriesList`/`CategorieCreateForm`, import direct depuis
 * `admin/categories/`, même précédent que `RevoquerDelegationButton.tsx`
 * important une Server Action de `delegations/`) — aucune duplication de
 * logique d'affichage.
 *
 * Réservée à `isAdmin()` OU `treso.gerer_categories` (Finance dans le seed ;
 * tout rôle combiné qui cumulerait le module Finance en hérite dès qu'il
 * porte cette permission, jamais un accès en dur sur "Finance"). Gardée ici
 * ET revérifiée dans chaque Server Action (`createCategorieAction`,
 * `supprimerCategorieAction`...) — jamais uniquement le masquage du lien de
 * navigation.
 *
 * `isAdmin` transmis à `CategoriesList` reflète la VRAIE session ici
 * (contrairement à `/admin/categories`, toujours `true`) : un utilisateur
 * Finance ordinaire ne voit donc jamais les contrôles Activer/Désactiver
 * (réservés à l'Admin) — seulement créer et supprimer.
 *
 * **Budget alloué — ouvert au Responsable Finance** (voir CLAUDE.md
 * "Finance peut définir le budget d'une catégorie") : `canModifierBudget`
 * (prop DISTINCTE de `isAdmin`) est calculé ici avec exactement la même
 * garde que `modifierBudgetCategorieAction` elle-même
 * (`treso.valider_demande` ET PAS `treso.approuver_validation_complete`,
 * pour exclure le DG qui possède aussi `valider_demande` — même schéma déjà
 * établi ailleurs dans le module) — jamais recalculée différemment entre
 * l'affichage et la Server Action. L'Assistant Finance n'atteint de toute
 * façon jamais cette page (`treso.gerer_categories` absente de son rôle).
 */
export default async function FinanceCategoriesPage() {
  const session = await getSession();
  const eligible = !!session && (isAdmin(session) || hasPermission(session, "treso.gerer_categories"));

  if (!eligible) {
    redirect("/?error=acces_refuse_gerer_categories");
  }

  const admin = isAdmin(session);
  const canModifierBudget = admin || hasPermission(session, "treso.modifier_budget_categorie");

  const budgets = await getBudgetsCategoriesEnVigueur();
  const categories = await prisma.categorie.findMany({
    include: { objets: { orderBy: { label: "asc" } } },
    orderBy: { label: "asc" },
  });

  // Lot I : règle « catégorisation obligatoire à partir d'une date », modifiable par la Finance, changements historisés.
  const [regle, historiqueRegle] = await Promise.all([
    chargerRegleCategorisation(),
    prisma.historiqueEntry.findMany({
      where: { entity: ENTITE_PARAMETRE_TRESORERIE },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { fullName: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Catégories"
        description="Catégories et objets disponibles pour la catégorisation des demandes."
      />

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
          lienBudgets={canModifierBudget || hasPermission(session, "treso.voir_dashboard_finance") || hasPermission(session, "treso.valider_budget")}
          categories={categories.map((c) => ({
            id: c.id,
            label: c.label,
            isActive: c.isActive,
            budget: budgets[c.id] ? { montant: budgets[c.id].budget, dateDebut: budgets[c.id].dateDebut, dateFin: budgets[c.id].dateFin, seuil: budgets[c.id].seuil } : null,
            objets: c.objets.map((o) => ({ id: o.id, label: o.label, isActive: o.isActive })),
          }))}
        />
      </section>
    </div>
  );
}
