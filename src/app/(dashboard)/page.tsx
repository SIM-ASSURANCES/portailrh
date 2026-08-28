import Link from "next/link";

import { PageHeader, ToastOnMount } from "@/components/ui";
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
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      {error === "acces_refuse_admin" ? (
        <ToastOnMount variant="error" message="Accès réservé aux administrateurs." />
      ) : null}

      <PageHeader
        title="Tableau de bord"
        description={session ? `Bonjour, ${session.user.fullName} — ${session.role}` : undefined}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Vos modules</h2>
        {modules.length === 0 ? (
          <p className="rounded-md border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun module ne vous est accessible pour le moment. Contactez un
            administrateur si vous pensez qu&apos;il s&apos;agit d&apos;une erreur.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module_) => (
              <Link
                key={module_.id}
                href={`/${module_.key}`}
                className="rounded-lg border border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <h3 className="font-semibold text-foreground">{module_.label}</h3>
                <p className="mt-1 text-sm text-muted-foreground">Accéder au module</p>
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
          <div className="rounded-md border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune notification pour le moment.
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Actions à effectuer</h2>
          {/* Zone préparée pour le Module Trésorerie (ex: demandes à
              catégoriser, règlements à effectuer). Vide pour l'instant. */}
          <div className="rounded-md border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune action en attente pour le moment.
          </div>
        </section>
      </div>
    </div>
  );
}
