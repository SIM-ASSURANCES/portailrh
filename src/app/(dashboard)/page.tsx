import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { Badge, EmptyState, PageHeader, ToastOnMount } from "@/components/ui";
import { getAccessibleModules, getSession, hasPermission, isAdmin } from "@/lib/auth";

/** Icône propre à chaque module (même symbole que sa branche de sidebar,
 * voir nav.ts) plutôt qu'une flèche générique répétée sur toutes les
 * cartes — la carte se reconnaît au premier coup d'œil, pas seulement au
 * texte de son titre. */
const MODULE_ICON: Record<string, IconName> = {
  tresorerie: "wallet",
  pointage: "clock",
};

/**
 * Point d'entrée le plus pertinent du module Trésorerie selon les
 * permissions de la session — jamais un `/${module.key}` générique (le
 * module a pour clé "tresorerie" en base, mais aucune route n'existe à cet
 * endroit : les vraies routes vivent sous `/treso/*`). Finance/DG atterrit
 * directement sur le tableau de bord Finance (Phase G, `treso.voir_dashboard_finance`,
 * exactement la permission qui garde `treso/finance/page.tsx` — jamais de
 * redirection en boucle une fois ici) ; un Collaborateur avec
 * `treso.creer_demande` atterrit sur `/treso/tableau-de-bord` (son propre
 * tableau de bord, cahier des charges section 14 — voir CLAUDE.md
 * "Mon tableau de bord"), pas directement sur la liste "Mes demandes".
 *
 * **`treso.declarer_retour` seule (sans `creer_demande`)** — ex: un rôle
 * combiné Finance/RH qui ne crée jamais ses propres demandes — atterrit
 * directement sur `/treso/demandes` : `/treso/tableau-de-bord` est
 * désormais gardée par `creer_demande` seule (voir CLAUDE.md "Sidebar
 * Trésorerie — un seul tableau de bord par profil"), l'y envoyer
 * provoquerait le même refus d'accès en boucle que l'ancien défaut
 * `/treso/demandes` documenté ci-dessous pour un tout autre cas.
 *
 * Une session sans aucune de ces permissions (Admin, qui n'a délibérément
 * aucune permission `treso.*` — voir CLAUDE.md "Administration") n'a
 * **aucun** point d'entrée fonctionnel réel : `null`, distinct du cas
 * "module sans écran" (Pointage RH) — l'audit habilitations a montré que
 * renvoyer `/treso/demandes` par défaut à une session qui n'a RIEN y
 * redirigeait aussitôt avec un refus d'accès (la page revérifie désormais
 * cette même permission côté serveur), un lien tout aussi trompeur qu'un
 * 404.
 */
function getTresorerieHref(session: { permissions: string[] } | null): string | null {
  if (hasPermission(session, "treso.voir_dashboard_finance")) return "/treso/finance";
  if (hasPermission(session, "treso.creer_demande")) {
    // Mon tableau de bord (cahier des charges section 14) est le point
    // d'entrée d'un Collaborateur créant ses propres demandes — même
    // symétrie que Finance/DG (tableau de bord, pas directement la liste
    // "Mes demandes").
    return "/treso/tableau-de-bord";
  }
  if (hasPermission(session, "treso.declarer_retour")) {
    return "/treso/demandes";
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
 * écran construit" de "le module existe mais ce rôle n'y a structurellement
 * aucun accès opérationnel" (Trésorerie pour l'Admin) — deux causes
 * différentes, jamais le même message : la première annonce une
 * fonctionnalité à venir, la seconde ne doit rien promettre.
 *
 * Pointage RH : depuis la fusion du module (2026-09-01, voir CLAUDE.md),
 * "Pointer" (`/pointage/pointer`) est un écran réel — la carte y renvoie
 * directement, comme pour Trésorerie. Le reste du module (dashboard RH,
 * pointages/retards/reporting/corrections/horaires) reste "à venir" et vit
 * uniquement dans la sidebar (`comingSoon`, voir nav.ts), jamais sur cette
 * carte générale qui n'a qu'un seul point d'entrée par module.
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
    return { href: "/pointage/pointer", reason: "no_access" };
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

      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          Vos accès
        </h2>
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
                  className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-elevated transition-[box-shadow,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:shadow-elevated-lg"
                >
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" aria-hidden="true" />
                  <span className="inline-grid size-11 place-items-center rounded-xl bg-primary text-white shadow-[0_4px_10px_-2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out-strong motion-safe:group-hover:scale-110">
                    <Icon name={MODULE_ICON[module_.key] ?? "folder-tree"} className="size-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-bold text-foreground">{module_.label}</h3>
                  <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors duration-200 group-hover:text-primary">
                    Accéder au module
                    <Icon
                      name="arrow-up-right"
                      className="size-3 transition-transform duration-200 ease-out-strong motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                    />
                  </p>
                </Link>
              ) : (
                <div
                  key={module_.id}
                  className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 opacity-75"
                >
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-border" aria-hidden="true" />
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-grid size-11 place-items-center rounded-xl bg-neutral-bg text-neutral">
                      <Icon name={MODULE_ICON[module_.key] ?? "folder-tree"} className="size-5" />
                    </span>
                    <Badge variant="neutral">
                      {module_.reason === "coming_soon" ? "Bientôt disponible" : "Aucun accès"}
                    </Badge>
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-foreground">{module_.label}</h3>
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
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-elevated transition-[box-shadow,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:shadow-elevated-lg"
              >
                <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" aria-hidden="true" />
                <span className="inline-grid size-11 place-items-center rounded-xl bg-primary text-white shadow-[0_4px_10px_-2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out-strong motion-safe:group-hover:scale-110">
                  <Icon name="shield-check" className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-foreground">Administration</h3>
                <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors duration-200 group-hover:text-primary">
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

      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-border" aria-hidden="true" />
          Notifications et alertes
        </h2>
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
