import Link from "next/link";

import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader, StatCard, ToastOnMount } from "@/components/ui";
import { getAccessibleModules, getSession } from "@/lib/auth";

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();
  const modules = await getAccessibleModules(session);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {error === "acces_refuse_admin" ? (
        <ToastOnMount variant="error" message="Accès réservé aux administrateurs." />
      ) : null}
      {error === "acces_refuse_creer_demande" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas la permission de créer une demande."
        />
      ) : null}
      {error === "acces_refuse_categoriser" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas accès à l'espace Finance des demandes."
        />
      ) : null}

      <PageHeader
        title="Tableau de bord"
        description={session ? `Bonjour, ${session.user.fullName} — ${session.role}` : undefined}
      />

      {/* Filtre par période */}
      <Card>
        <h2 className="text-base font-bold text-foreground">Filtrer par période</h2>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">Du</span>
            <input
              type="date"
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">Au</span>
            <input
              type="date"
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
            />
          </label>
          <button
            type="button"
            className="ml-auto text-sm font-medium text-info transition-colors hover:text-primary"
          >
            Toutes périodes
          </button>
        </div>
      </Card>

      {/* Indicateurs — valeurs indicatives tant que le module Trésorerie n'est pas câblé */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card-enter">
          <StatCard icon="file-text" tone="info" label="Demandes en attente" value="0" />
        </div>
        <div className="stat-card-enter">
          <StatCard icon="wallet" tone="success" label="Montant à régler" value="0 FCFA" />
        </div>
        <div className="stat-card-enter">
          <StatCard icon="book-text" tone="neutral" label="Règlements du mois" value="0" />
        </div>
        <div className="stat-card-enter">
          <StatCard
            icon="rotate-ccw"
            tone="warning"
            label="Retours de caisse en attente"
            value="0"
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Vos modules</h2>
        {modules.length === 0 ? (
          <EmptyState
            icon="folder-tree"
            message="Aucun module ne vous est accessible pour le moment. Contactez un administrateur si vous pensez qu'il s'agit d'une erreur."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module_) => (
              <Link
                key={module_.id}
                href={`/${module_.key}`}
                className="group rounded-lg border border-border bg-surface p-5 shadow-sm transition-[box-shadow,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:shadow-md"
              >
                <h3 className="font-semibold text-foreground">{module_.label}</h3>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  Accéder au module
                  <Icon
                    name="arrow-up-right"
                    className="size-3 transition-transform duration-200 ease-out-strong motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                  />
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Notifications et alertes</h2>
          {/* Zone préparée pour le Module Trésorerie (ex: demandes en attente
              de validation, retours de caisse non réceptionnés). Vide pour
              l'instant. */}
          <EmptyState icon="bell" message="Aucune notification pour le moment." compact />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Actions à effectuer</h2>
          {/* Zone préparée pour le Module Trésorerie (ex: demandes à
              catégoriser, règlements à effectuer). Vide pour l'instant. */}
          <EmptyState icon="shield-check" message="Aucune action en attente pour le moment." compact />
        </section>
      </div>
    </div>
  );
}
