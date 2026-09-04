import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { cache } from "react";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    // Obligatoire avec le Credentials provider : Auth.js ne supporte pas les
    // sessions persistées en base (adapter) avec ce provider, uniquement le JWT.
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;

        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { role: true },
        });

        // `!user.passwordHash` couvre un compte "en attente d'activation"
        // (invitation par lien pas encore finalisée, voir CLAUDE.md
        // "Invitation par lien") — `passwordHash` est nullable depuis cette
        // fonctionnalité, jamais comparable avec bcrypt tant qu'il est nul.
        if (!user || !user.isActive || !user.passwordHash) {
          return null;
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role.name,
        };
      },
    }),
  ],
  callbacks: {
    // Appelé à la création/mise à jour du JWT : on y recopie les infos issues
    // de `authorize` (disponibles uniquement lors du login, via `user`).
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.fullName = user.fullName;
        token.role = user.role;
      }
      return token;
    },
    // Appelé à chaque lecture de session côté serveur/client : on reprojette
    // le contenu du JWT vers l'objet `session` exposé à l'application.
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.fullName = token.fullName;
      session.role = token.role;
      return session;
    },
  },
});

/**
 * Session enrichie du portail : à utiliser dans les Server Components,
 * Route Handlers et Server Actions pour connaître l'utilisateur connecté
 * ET ses permissions effectives.
 *
 * - Retourne `null` si personne n'est authentifié.
 * - `permissions` est la liste des clés (`Permission.key`, ex: "treso.valider_demande")
 *   attribuées au rôle de l'utilisateur, recalculée à chaque appel (source de
 *   vérité = table RolePermission, pas le contenu du JWT) : une modification
 *   des droits d'un rôle est donc prise en compte immédiatement, sans
 *   nécessiter une reconnexion.
 *
 * Exemple :
 *   const session = await getSession();
 *   if (!session) redirect("/login");
 */
export const getSession = cache(async (): Promise<{
  user: { id: string; fullName: string; email: string };
  role: string;
  permissions: string[];
} | null> => {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  const role = await prisma.role.findUnique({
    where: { name: session.role },
    include: { permissions: { include: { permission: true } } },
  });

  const permissions = role?.permissions.map((rp) => rp.permission.key) ?? [];

  return {
    user: {
      id: session.user.id,
      fullName: session.user.fullName,
      email: session.user.email,
    },
    role: session.role,
    permissions,
  };
});

/**
 * Vérifie qu'une session (retournée par `getSession()`) possède une
 * permission donnée.
 *
 * Usage typique dans une page/route/action protégée :
 *   const session = await getSession();
 *   if (!session || !hasPermission(session, "treso.valider_demande")) {
 *     // refuser l'accès
 *   }
 *
 * `session` peut être `null` (utilisateur non connecté) : la fonction
 * retourne alors `false` sans lever d'erreur.
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
