import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { CategorieCreateForm } from "./CategorieCreateForm";
import { CategoriesList } from "./CategoriesList";

/**
 * Gestion des Catégories/Objets (dette technique du Ticket 2 : le cahier
 * des charges exige une liste paramétrable, jusqu'ici uniquement peuplée
 * par le seed). Garde de la console admin déjà assurée par
 * `admin/layout.tsx` (isAdmin()).
 *
 * Même principe que `admin/modules` : jamais de suppression définitive,
 * uniquement Activer/Désactiver (`isActive`) — Categorie/Objet sont
 * potentiellement référencés par des Demande existantes, une vraie
 * suppression casserait l'intégrité de l'historique.
 */
export default async function AdminCategoriesPage() {
  const categories = await prisma.categorie.findMany({
    include: { objets: { orderBy: { label: "asc" } } },
    orderBy: { label: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Catégories"
        description="Catégories et objets disponibles pour la catégorisation des demandes. Aucune suppression définitive, seulement l'activation/désactivation."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouvelle catégorie</h2>
        <CategorieCreateForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Catégories existantes</h2>
        <CategoriesList
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
