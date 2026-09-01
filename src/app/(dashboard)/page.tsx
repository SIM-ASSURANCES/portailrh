import Link from "next/link";

import { Icon } from "@/components/icons";
import { Badge, EmptyState, PageHeader, ToastOnMount } from "@/components/ui";
import { getAccessibleModules, getSession, hasPermission, isAdmin } from "@/lib/auth";

/**
 * Point d'entrée le plus pertinent du module Trésorerie selon les
 * permissions de la session — jamais un `/${module.key}` générique (le
 * module a pour clé "tresorerie" en base, mais aucune route n'existe à cet
 * endroit : les vraies routes vivent sous `/treso/*`). Finance/DG atterrit
 * directement sur le tableau de bord Finance (Phase G, `treso.voir_dashboard_finance`,
 * exactement la permission qui garde `treso/finance/page.tsx` — jamais de
 * redirection en boucle une fois ici) ; Collaborateur (`treso.creer_demande`
 * ou `treso.declarer_retour`) atterrit sur `/treso/tableau-de-bord` (son
 * propre tableau de bord, cahier des charges section 14 — voir CLAUDE.md
 * "Mon tableau de bord"), pas directement sur la liste "Mes demandes". Une
 * session
 * sans aucune de ces permissions (Admin, qui n'a délibérément aucune
 * permission `treso.*` — voir CLAUDE.md "Administration") n'a **aucun**
 * point d'entrée fonctionnel réel : `null`, distinct du cas "module sans
 * écran" (Pointage RH) — l'audit habilitations a montré que renvoyer
 * `/treso/demandes` par défaut y redirigeait aussitôt avec un refus d'accès
 * (la page revérifie désormais cette même permission côté serveur), un
 * lien tout aussi trompeur qu'un 404.
 */
function getTresorerieHref(session: { permissions: string[] } | null): string | null {
  if (hasPermission(session, "treso.voir_dashboard_finance")) return "/treso/finance";
  if (hasPermission(session, "treso.creer_demande") || hasPermission(session, "treso.declarer_retour")) {
    // Mon tableau de bord (cahier des charges section 14) est désormais le
    // point d'entrée du Collaborateur — même symétrie que Finance/DG
    // (tableau de bord, pas directement la liste "Mes demandes").
    return "/treso/tableau-de-bord";
  }
  return null;
}

interface ModuleCardState {
  href: string | null;
  /** Distingue le message affiché quand `href` est `null`. */
  reason: "no_access" | "coming_soon";
}

/**
 * État de carte par module : `href` non nul si un point d'entrée
 * fonctionnel existe pour cette session ; sinon `reason` distingue "aucun
 * écran construit" (Pointage RH — même badge "Bientôt disponible" pour
 * tous) de "le module existe mais ce rôle n'y a structurellement aucun
 * accès opérationnel" (Trésorerie pour l'Admin) — deux causes différentes,
 * jamais le même message : la première annonce une fonctionnalité à venir,
 * la seconde ne doit rien promettre.
 */
function getModuleCardState(moduleKey: string, session: { permissions: string[] } | null): ModuleCardState {
  if (moduleKey === "tresorerie") {
    const href = getTresorerieHref(session);
    return href ? { href, reason: "no_access" } : { href: null, reason: "no_access" };
  }
  if (moduleKey === "pointage") {
    if (hasPermission(session, "pointage.voir_dashboard_rh")) {
      return { href: "/pointage/rh", reason: "no_access" };
    }
    return { href: null, reason: "no_access" };
  }
  return { href: null, reason: "coming_soon" };
}

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();
  const modules = await getAccessibleModules(session);
  const moduleCards = modules.map((module_) => ({
    ...module_,
    ...getModuleCardState(module_.key, session),
  }));

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
      {error === "acces_refuse_demandes" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas accès à l'espace Demandes."
        />
      ) : null}

      <PageHeader
        title="Tableau de bord"
        description={session ? `Bonjour, ${session.user.fullName} — ${session.role}` : undefined}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Vos accès</h2>
        {moduleCards.length === 0 && !isAdmin(session) ? (
          <EmptyState
            icon="folder-tree"
            message="Aucun module ne vous est accessible pour le moment. Contactez un administrateur si vous pensez qu'il s'agit d'une erreur."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {moduleCards.map((module_) =>
              module_.href ? (
                <Link
                  key={module_.id}
                  href={module_.href}
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
              ) : (
                <div key={module_.id} className="rounded-lg border border-border bg-surface p-5 opacity-70">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-foreground">{module_.label}</h3>
                    <Badge variant="neutral">
                      {module_.reason === "coming_soon" ? "Bientôt disponible" : "Aucun accès"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {module_.reason === "coming_soon"
                      ? "Les écrans de ce module sont en cours de construction."
                      : "Votre rôle n'a aucune permission opérationnelle sur ce module."}
                  </p>
                </div>
              )
            )}
            {isAdmin(session) ? (
              <Link
                href="/admin"
                className="group rounded-lg border border-border bg-surface p-5 shadow-sm transition-[box-shadow,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:shadow-md"
              >
                <h3 className="font-semibold text-foreground">Administration</h3>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  Utilisateurs, rôles et modules du portail
                  <Icon
                    name="arrow-up-right"
                    className="size-3 transition-transform duration-200 ease-out-strong motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                  />
                </p>
              </Link>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Notifications et alertes</h2>
        {/* Zone réservée aux notifications transverses du Socle (annonces,
            maintenance, expiration de mot de passe...), pas aux indicateurs
            "à traiter" d'un module métier précis — ceux-ci vivent sur le
            tableau de bord de leur module (ex: /treso/finance, Phase G).
            Vide aujourd'hui faute de producteur de notifications transverses,
            pas parce que quelque chose manque ici. */}
        <EmptyState icon="bell" message="Aucune notification pour le moment." compact />
      </section>
    </div>
  );
}
