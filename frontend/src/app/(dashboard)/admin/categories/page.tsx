import { PageHeader } from "@/components/ui";
import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "backend";

import { CategorieCreateForm } from "./CategorieCreateForm";
import { CategoriesList } from "./CategoriesList";

/**
 * Gestion des Catégories/Objets (dette technique du Ticket 2 : le cahier
 * des charges exige une liste paramétrable, jusqu'ici uniquement peuplée
 * par le seed). Garde de la console admin déjà assurée par
 * `admin/layout.tsx` (isAdmin()) — cette page reste donc TOUJOURS visitée
 * par un Admin, `isAdmin` transmis à `CategoriesList` y vaut donc toujours
 * `true` (Activer/Désactiver et le budget restent visibles ici, inchangé).
 *
 * **Création et suppression désormais aussi accessibles à Finance** depuis
 * un second point d'entrée, `/treso/finance/categories` (voir CLAUDE.md
 * "Gestion des Catégories/Objets ouverte à Finance") — cette page-ci
 * (`/admin/categories`) reste le CRUD complet réservé à l'Admin,
 * inchangée dans son périmètre (Activer/Désactiver, budget partagé).
 */
export default async function AdminCategoriesPage() {
  const session = await getSession();
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
