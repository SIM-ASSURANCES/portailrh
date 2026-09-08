import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { encode as defaultJwtEncode } from "next-auth/jwt";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { cache } from "react";

// "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") — deux durées,
// jamais une troisième valeur ailleurs dans le code.
const SESSION_MAX_AGE_REMEMBERED = 30 * 24 * 60 * 60; // 30 jours (coché)
const SESSION_MAX_AGE_DEFAULT = 24 * 60 * 60; // 1 jour (décoché, par défaut)

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    // Obligatoire avec le Credentials provider : Auth.js ne supporte pas les
    // sessions persistées en base (adapter) avec ce provider, uniquement le JWT.
    strategy: "jwt",
    // Plafond du cookie envoyé au navigateur (Max-Age/Expires) — TOUJOURS la
    // durée longue, quelle que soit la case "Se souvenir de moi". Limitation
    // documentée d'Auth.js v5 : cette valeur est résolue une seule fois pour
    // toute l'app (`@auth/core`, `lib/actions/callback/index.js`), jamais
    // par requête — impossible d'en faire un vrai cookie de session (sans
    // Max-Age, supprimé à la fermeture du navigateur) uniquement pour le cas
    // décoché sans réimplémenter `signIn()` à la main. La durée RÉELLE de la
    // session est en réalité imposée par `jwt.encode` ci-dessous (le
    // `exp` chiffré à l'intérieur du JWT, vérifié par Auth.js à chaque
    // lecture) : un cookie non "mémorisé" reste physiquement dans le
    // navigateur jusqu'à 30 jours, mais son JWT devient cryptographiquement
    // invalide au bout de `SESSION_MAX_AGE_DEFAULT` — `getSession()` renvoie
    // alors `null` comme n'importe quelle session expirée, l'utilisateur est
    // redirigé vers `/login` à la prochaine page. Choix documenté et
    // délibéré (voir CLAUDE.md) plutôt qu'une vraie expiration à la
    // fermeture du navigateur, jugée moins fiable en pratique (restauration
    // de session par le navigateur, onglets laissés ouverts des jours).
    maxAge: SESSION_MAX_AGE_REMEMBERED,
  },
  jwt: {
    // Surcharge du `encode` par défaut d'Auth.js : seul point du cycle de vie
    // où la durée RÉELLE (le `exp` chiffré dans le JWT) peut varier par
    // utilisateur — `session.maxAge` ci-dessus reste, lui, une valeur unique
    // pour toute l'app. Lu sur `token.rememberMe`, posé par le callback
    // `jwt` ci-dessous à partir de `authorize()` (jamais recalculé après le
    // login initial : `token.rememberMe` persiste tel quel d'un appel à
    // l'autre du callback `jwt`, jamais réécrit à `undefined`).
    async encode(params) {
      const maxAge = params.token?.rememberMe
        ? SESSION_MAX_AGE_REMEMBERED
        : SESSION_MAX_AGE_DEFAULT;
      return defaultJwtEncode({ ...params, maxAge });
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
        // Déclaré ici uniquement pour que TypeScript connaisse la clé sur
        // `credentials` dans `authorize()` ci-dessous — jamais rendu par un
        // formulaire NextAuth par défaut (le portail a son propre /login,
        // voir `pages.signIn`).
        rememberMe: { label: "Se souvenir de moi", type: "text" },
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
          // Champ brut transmis par le formulaire de connexion (voir
          // `login/page.tsx`), jamais validé par zod ici : une valeur
          // absente ou invalide retombe simplement sur `false` (session
          // courte), jamais sur la durée longue par erreur.
          rememberMe: credentials?.rememberMe === "true",
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
        token.rememberMe = user.rememberMe;
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
