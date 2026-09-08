import { prisma } from "./prisma";

/**
 * Vérifie qu'une session (retournée par `getSession()`, côté frontend)
 * possède une permission donnée.
 *
 * Usage typique dans une page/route/action protégée :
 *   const session = await getSession();
 *   if (!session || !hasPermission(session, "treso.valider_demande")) {
 *     // refuser l'accès
 *   }
 *
 * `session` peut être `null` (utilisateur non connecté) : la fonction
 * retourne alors `false` sans lever d'erreur.
 *
 * Extrait de `frontend/src/lib/auth.ts` lors de la restructuration en
 * monorepo (voir CLAUDE.md "Monorepo backend/frontend") : ces trois
 * fonctions sont des règles de permissions pures, sans aucune dépendance à
 * Next.js/NextAuth (contrairement au reste de `auth.ts`, qui doit rester
 * côté frontend — instance NextAuth, `next/headers`, Route Handler). Le
 * frontend continue de les importer via `@/lib/auth` exactement comme
 * avant : ce fichier ré-exporte les trois fonctions depuis `backend`
 * (voir `frontend/src/lib/auth.ts`), aucun appelant n'a eu besoin de
 * changer son import.
 */
export function hasPermission(
  session: { permissions: string[] } | null,
  permissionKey: string
): boolean {
  return session?.permissions.includes(permissionKey) ?? false;
}

/**
 * Accès administrateur du Socle Portail (console /admin : utilisateurs,
 * rôles, modules).
 *
 * Choix volontaire : c'est un bypass basé sur `role.name === "Admin"`, PAS
 * une permission stockée dans RolePermission. Deux raisons :
 *  1. Le rôle Admin doit garder un accès total à l'administration même si
 *     personne n'a (ou plus) pensé à lui attribuer les bonnes permissions —
 *     pas de risque de se retrouver bloqué hors de la console d'admin.
 *  2. La console d'admin est une fonctionnalité du Socle, orthogonale au
 *     système de permissions par module (`treso.*`, etc.) qui sert aux
 *     modules métier. Être Admin ne donne PAS automatiquement les
 *     permissions métier des autres modules : `hasPermission()` reste la
 *     seule source de vérité pour celles-ci.
 *
 * Usage : gate de route (`if (!isAdmin(session)) redirect(...)`) et dans
 * chaque Server Action de la console admin (ne jamais se fier au seul
 * masquage de l'UI).
 */
export function isAdmin(session: { role: string } | null): boolean {
  return session?.role === "Admin";
}

/**
 * Modules actifs auxquels la session a accès : un module n'apparaît que si
 * l'utilisateur possède au moins une permission qui lui est rattachée.
 * Un module désactivé (`isActive: false`) n'apparaît jamais, même avec les
 * permissions correspondantes — c'est le mécanisme utilisé par la console
 * admin (`/admin/modules`) pour retirer un module du dashboard de tous les
 * utilisateurs.
 *
 * Cas Admin : `isAdmin(session)` retourne TOUS les modules actifs, sans
 * filtrer par permissions. Le rôle Admin n'a délibérément aucune ligne
 * `RolePermission` (son accès à `/admin` est un bypass, voir `isAdmin()`) —
 * sans ce cas particulier, `getAccessibleModules()` ne renverrait jamais
 * rien pour lui, alors qu'un administrateur doit garder une vue d'ensemble
 * de tous les modules métier du portail.
 *
 * Générique : fonctionne pour n'importe quel module présent en base, sans
 * modification de code à l'ajout d'un nouveau module.
 */
export async function getAccessibleModules(
  session: { role: string; permissions: string[] } | null
): Promise<{ id: string; key: string; label: string }[]> {
  if (!session) {
    return [];
  }

  const modules = await prisma.module.findMany({
    where: { isActive: true },
    include: { permissions: { select: { key: true } } },
    orderBy: { label: "asc" },
  });

  const visibleModules = isAdmin(session)
    ? modules
    : modules.filter((module_) =>
        module_.permissions.some((p) => session.permissions.includes(p.key))
      );

  return visibleModules.map((module_) => ({
    id: module_.id,
    key: module_.key,
    label: module_.label,
  }));
}
