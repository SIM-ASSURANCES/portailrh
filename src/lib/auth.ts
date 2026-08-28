import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

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

        if (!user || !user.isActive) {
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
export async function getSession(): Promise<{
  user: { id: string; fullName: string; email: string };
  role: string;
  permissions: string[];
} | null> {
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
}

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
