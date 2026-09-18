import Link from "next/link";

import { Icon } from "@/components/icons";
import { EmptyState, PageHeader, ToastOnMount } from "@/components/ui";
import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "@/components/ui/brandIcon";
import { getAccessibleModules, getSession, hasPermission, isAdmin } from "@/lib/auth";
import { prisma, getMesRetoursADeclarer } from "backend";
import { getTopbarAlert } from "@/lib/topbarAlerts";
import { DashboardNotificationsSection, type DashboardAlertItem } from "@/components/dashboard/DashboardNotificationsSection";

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
    if (hasPermission(session, "pointage.pointer")) {
      return { href: "/pointage/pointer", reason: "no_access" };
    }
    if (hasPermission(session, "pointage.consulter_historique")) {
      return { href: "/pointage/historique", reason: "no_access" };
    }
    return { href: null, reason: "no_access" };
  }
  if (moduleKey === "feedback") {
    return { href: "/feedback/nouveau", reason: "no_access" };
  }
  return { href: null, reason: "coming_soon" };
}

/**
 * Filigrane logo des cartes "Vos accès" — même technique que
 * `FeedbackHero()` (`app/feedback/page.tsx` : SVG `BRAND_ICON_PATHS`,
 * `fill="currentColor"`, très pâle, débordant en haut à droite d'un
 * conteneur `relative overflow-hidden`), mais volontairement réduit
 * (`size-24 sm:size-32` contre `size-56 sm:size-72` sur le hero) : ces
 * cartes sont de petits panneaux `p-5` en grille, pas un bandeau pleine
 * largeur — la taille du hero y dominerait la carte et nuirait à la
 * lisibilité du titre/texte, jamais reproduite au pixel près.
 */
function ModuleCardWatermark() {
  return (
    <svg
      viewBox={BRAND_ICON_VIEWBOX}
      className="pointer-events-none absolute -right-6 -top-6 size-24 opacity-[0.14] sm:size-32"
      aria-hidden="true"
    >
      {BRAND_ICON_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
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

  // 1. Notifications personnelles récentes de l'utilisateur
  const rawNotifications = session?.user
    ? await prisma.notification.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  const serializedNotifications = rawNotifications.map((n) => ({
    id: n.id,
    titre: n.titre,
    message: n.message,
    lien: n.lien,
    estLue: n.estLue,
    createdAt: n.createdAt.toISOString(),
  }));

  // 2. Alertes contextuelles prioritaires
  const alerts: DashboardAlertItem[] = [];

  if (session?.user) {
    // Alerte pointage départ / jour férié
    const topbarAlert = await getTopbarAlert(
      session.user.id,
      hasPermission(session, "pointage.pointer")
    );
    if (topbarAlert) {
      alerts.push({
        id: "topbar_alert",
        title: topbarAlert.message,
        description:
          topbarAlert.id === "depart_non_pointe"
            ? "Votre pointage de départ n'a pas encore été enregistré pour aujourd'hui. Pensez à pointer avant de partir."
            : undefined,
        href: topbarAlert.href,
        variant: topbarAlert.variant,
        icon: topbarAlert.variant === "danger" ? "clock" : "calendar",
      });
    }

    // Collaborateur : Retours de caisse à déclarer
    if (hasPermission(session, "treso.declarer_retour")) {
      const { nombre: retoursADeclarer } = await getMesRetoursADeclarer(session.user.id);
      if (retoursADeclarer > 0) {
        alerts.push({
          id: "retours_a_declarer",
          title: `${retoursADeclarer} retour(s) de caisse à déclarer`,
          description: "Des avances de fonds reçues nécessitent la justification et le dépôt de vos pièces de dépenses.",
          href: "/treso/demandes/retours-a-declarer",
          variant: "warning",
          icon: "rotate-ccw",
        });
      }
    }

    // Finance : Demandes en attente de validation
    if (hasPermission(session, "treso.valider_demande")) {
      const demandesAValider = await prisma.demande.count({
        where: { statut: "EN_ATTENTE_VALIDATION" },
      });
      if (demandesAValider > 0) {
        alerts.push({
          id: "demandes_a_valider",
          title: `${demandesAValider} demande(s) en attente de validation`,
          description: "Des demandes d'achat sont en attente de traitement et validation par l'équipe Finance.",
          href: "/treso/finance/demandes",
          variant: "warning",
          icon: "wallet",
        });
      }
    }

    // DG : Validations complètes en attente d'approbation finale
    if (hasPermission(session, "treso.approuver_validation_complete")) {
      const validationsDG = await prisma.demande.count({
        where: {
          validationCompleteParDG: false,
          statut: { in: ["REGLEE", "PARTIELLEMENT_REGLEE"] },
        },
      });
      if (validationsDG > 0) {
        alerts.push({
          id: "validations_dg",
          title: `${validationsDG} validation(s) complète(s) en attente DG`,
          description: "Verrou de clôture finale : votre approbation de Direction Générale est requise.",
          href: "/treso/finance/validations-attente",
          variant: "warning",
          icon: "shield-check",
        });
      }
    }

    // RH : Absences à contrôler
    if (hasPermission(session, "pointage.voir_dashboard_rh")) {
      const absencesAControler = await prisma.absence.count({
        where: { statut: "A_CONTROLER" },
      });
      if (absencesAControler > 0) {
        alerts.push({
          id: "absences_a_controler",
          title: `${absencesAControler} absence(s) en attente de contrôle RH`,
          description: "Des absences détectées nécessitent une vérification ou justification.",
          href: "/pointage/rh/absences",
          variant: "info",
          icon: "users",
        });
      }
    }
  }

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
      {error === "acces_refuse_validations_attente" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas la permission d'approuver les validations complètes."
        />
      ) : null}
      {error === "acces_refuse_pointer" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas la permission de pointer."
        />
      ) : null}
      {error === "acces_refuse_historique" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas la permission de consulter l'historique de pointage."
        />
      ) : null}
      {error === "acces_refuse_moderation" ? (
        <ToastOnMount
          variant="error"
          message="Vous n'avez pas la permission de modérer les feedbacks."
        />
      ) : null}
      {error === "acces_refuse_recevoir_feedback" ? (
        <ToastOnMount
          variant="error"
          message="Votre rôle n'est pas configuré pour recevoir des feedbacks."
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
                  className="brand-gradient-bg card-shadow-hover group relative flex flex-col overflow-hidden rounded-2xl p-5 shadow-elevated transition-[box-shadow,transform,filter] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:brightness-110"
                >
                  <ModuleCardWatermark />
                  <h3 className="relative mt-4 text-lg font-bold text-white">{module_.label}</h3>
                  <p className="relative mt-1 flex items-center gap-1 text-sm font-semibold text-white/80 transition-colors duration-200 group-hover:text-white">
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
                  className="brand-gradient-bg relative flex flex-col overflow-hidden rounded-2xl p-5 opacity-60"
                >
                  <ModuleCardWatermark />
                  <div className="relative flex justify-end">
                    <span className="inline-flex items-center rounded-full border border-white/40 bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
                      {module_.reason === "coming_soon" ? "Bientôt disponible" : "Aucun accès"}
                    </span>
                  </div>
                  <h3 className="relative mt-4 text-lg font-bold text-white">{module_.label}</h3>
                  <p className="relative mt-1 text-sm text-white/80">
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
                className="brand-gradient-bg card-shadow-hover group relative flex flex-col overflow-hidden rounded-2xl p-5 shadow-elevated transition-[box-shadow,transform,filter] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] hover:brightness-110"
              >
                <ModuleCardWatermark />
                <h3 className="relative mt-4 text-lg font-bold text-white">Administration</h3>
                <p className="relative mt-1 flex items-center gap-1 text-sm font-semibold text-white/80 transition-colors duration-200 group-hover:text-white">
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

      <DashboardNotificationsSection
        notifications={serializedNotifications}
        alerts={alerts}
      />
    </div>
  );
}
