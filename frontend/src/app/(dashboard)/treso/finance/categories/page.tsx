import { redirect } from "next/navigation";

import { CategoriesList } from "@/app/(dashboard)/admin/categories/CategoriesList";
import { CategorieCreateForm } from "@/app/(dashboard)/admin/categories/CategorieCreateForm";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { prisma } from "backend";

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
 * Finance ordinaire ne voit donc jamais les contrôles Activer/Désactiver ni
 * le budget partagé (réservés à l'Admin, hors périmètre de cette tâche) —
 * seulement créer et supprimer.
 */
export default async function FinanceCategoriesPage() {
  const session = await getSession();
  const eligible = !!session && (isAdmin(session) || hasPermission(session, "treso.gerer_categories"));

  if (!eligible) {
    redirect("/?error=acces_refuse_gerer_categories");
  }

  const admin = isAdmin(session);

  const categories = await prisma.categorie.findMany({
    include: { objets: { orderBy: { label: "asc" } } },
    orderBy: { label: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Catégories"
        description="Catégories et objets disponibles pour la catégorisation des demandes."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouvelle catégorie</h2>
        <CategorieCreateForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Catégories existantes</h2>
        <CategoriesList
          isAdmin={admin}
          categories={categories.map((c) => ({
            id: c.id,
            label: c.label,
            isActive: c.isActive,
            budgetAlloue: c.budgetAlloue != null ? Number(c.budgetAlloue) : null,
            objets: c.objets.map((o) => ({ id: o.id, label: o.label, isActive: o.isActive })),
          }))}
        />
      </section>
    </div>
  );
}
