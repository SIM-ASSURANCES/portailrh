import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma, hasPermission, isAdmin, getAccessibleModules } from "backend";
import { cache } from "react";

import { authConfig } from "./auth.config";

// `hasPermission`/`isAdmin`/`getAccessibleModules` sont des règles de
// permissions pures (voir `backend/src/permissions.ts`) — extraites de ce
// fichier lors de la restructuration en monorepo (CLAUDE.md "Monorepo
// backend/frontend") car elles n'ont aucune dépendance à Next.js/NextAuth,
// contrairement au reste de ce fichier (instance NextAuth, `authorize()`
// avec bcrypt/Prisma, Route Handler). Ré-exportées ici SOUS LE MÊME NOM
// pour que tous les fichiers du frontend continuent d'importer les trois
// depuis `@/lib/auth`, exactement comme avant — aucun des ~65 fichiers qui
// importent `getSession`/`hasPermission`/`isAdmin` n'a eu besoin de changer.
export { hasPermission, isAdmin, getAccessibleModules };

// "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") et la durée
// réelle du JWT (`jwt.encode` personnalisé) vivent désormais dans
// `auth.config.ts`, pas ici — ce fichier-là est partagé avec le middleware
// Edge (`src/proxy.ts`), qui doit appliquer exactement la même logique de
// durée à chaque ré-encodage du cookie (voir le commentaire détaillé dans
// `auth.config.ts`). `auth.ts` (ce fichier) ajoute uniquement ce qui a
// besoin de Node (bcrypt, Prisma) : le provider Credentials.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
      async authorize(credentials, req) {
        const rawEmail = credentials?.email;
        const password = credentials?.password;

        if (typeof rawEmail !== "string" || typeof password !== "string") {
          return null;
        }

        // Email nettoyé (trim) et recherché SANS tenir compte de la casse :
        // sans cela, une majuscule ajoutée automatiquement par un clavier
        // mobile ("Admin@...") ou un espace final (autocomplétion,
        // copier-coller) rendait le compte "introuvable" — constaté en
        // conditions réelles. Recherche insensible à la casse plutôt qu'un
        // simple toLowerCase() : reste compatible avec d'éventuels comptes
        // déjà enregistrés avec des majuscules. Le mot de passe, lui, n'est
        // jamais normalisé.
        const email = rawEmail.trim();
        const user = await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          include: { role: true },
        });

        let rawIp = req?.headers?.get("x-forwarded-for") || req?.headers?.get("x-real-ip") || "Inconnue";
        if (rawIp.includes(",")) {
          rawIp = rawIp.split(",")[0].trim();
        }
        const ip = rawIp.replace(/^::ffff:/i, "");

        if (!user || !user.isActive || !user.passwordHash) {
          if (user) {
            await prisma.historiqueEntry.create({
              data: {
                entity: "Auth",
                entityId: user.id,
                action: "LOGIN_FAILED",
                detail: `Échec (compte inactif ou non finalisé). IP: ${ip}`,
                ipAddress: ip,
                userId: user.id,
              }
            });
          } else {
            console.warn(`Tentative de connexion échouée (utilisateur inexistant) : ${email} depuis IP ${ip}`);
          }
          return null;
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          await prisma.historiqueEntry.create({
            data: {
              entity: "Auth",
              entityId: user.id,
              action: "LOGIN_FAILED",
              detail: `Mot de passe incorrect. IP: ${ip}`,
              ipAddress: ip,
              userId: user.id,
            }
          });
          return null;
        }

        await prisma.historiqueEntry.create({
          data: {
            entity: "Auth",
            entityId: user.id,
            action: "LOGIN_SUCCESS",
            detail: `Connexion réussie. IP: ${ip}`,
            ipAddress: ip,
            userId: user.id,
          }
        });

        return {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role.name,
          photoUrl: user.photoUrl,
          tokenVersion: user.tokenVersion,
          // Champ brut transmis par le formulaire de connexion (voir
          // `login/page.tsx`), jamais validé par zod ici : une valeur
          // absente ou invalide retombe simplement sur `false` (session
          // courte), jamais sur la durée longue par erreur. Porté jusqu'au
          // JWT par le callback `jwt` de `auth.config.ts` (partagé avec le
          // middleware), qui pilote `jwt.encode` — voir ce fichier.
          rememberMe: credentials?.rememberMe === "true",
        };
      },
    }),
  ],
  // `callbacks.jwt`/`callbacks.session` vivent dans `auth.config.ts`
  // (`...authConfig` ci-dessus) : partagés avec le middleware Edge, jamais
  // dupliqués ici.
});

/**
 * Session enrichie du portail : à utiliser dans les Server Components,
 * Route Handlers et Server Actions pour connaître l'utilisateur connecté
 * ET ses permissions effectives.
 *
 * - Retourne `null` si personne n'est authentifié.
 * - `permissions` est la liste EFFECTIVE des clés (`Permission.key`, ex:
 *   "treso.valider_demande") — celles du rôle **plus** celles obtenues par
 *   une délégation individuelle active (voir CLAUDE.md "Délégation
 *   individuelle de permissions"), recalculée à chaque appel (jamais depuis
 *   le JWT) : une modification des droits d'un rôle, ou une délégation
 *   accordée/révoquée, est donc prise en compte immédiatement, sans
 *   reconnexion. C'est cette liste que `hasPermission()` consulte partout
 *   dans l'application — une permission déléguée se comporte donc, pour
 *   tout contrôle d'accès existant, exactement comme si elle avait été
 *   accordée au rôle lui-même.
 * - `rolePermissions` est la liste BRUTE, issue UNIQUEMENT du rôle
 *   (`RolePermission`), sans les délégations reçues. Réservée à l'éligibilité
 *   à DÉLÉGUER une permission à autrui (voir `accorderDelegationAction`,
 *   `admin/delegations`) : un bénéficiaire ne peut jamais redéléguer une
 *   permission qu'il n'a reçue que par délégation — seul ce qu'un compte
 *   possède via son propre rôle est délégable, ce qui interdit toute chaîne
 *   de délégation en cascade.
 *
 * Exemple :
 *   const session = await getSession();
 *   if (!session) redirect("/login");
 */
export const getSession = cache(async (): Promise<{
  user: { id: string; fullName: string; email: string; photoUrl: string | null };
  role: string;
  permissions: string[];
  rolePermissions: string[];
  estAdmin: boolean;
} | null> => {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  const role = await prisma.role.findUnique({
    where: { name: session.role },
    include: { permissions: { include: { permission: true } } },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user || !user.isActive || user.tokenVersion !== session.user.tokenVersion) {
    return null;
  }

  const rolePermissions = role?.permissions.map((rp) => rp.permission.key) ?? [];

  // Délégations individuelles actives reçues par cet utilisateur — voir
  // CLAUDE.md "Délégation individuelle de permissions". Recalculées à
  // chaque appel, jamais mises en cache au-delà de cette requête : le
  // donneur doit ENCORE posséder cette permission via son propre rôle (et
  // être toujours actif) au moment précis de cette vérification, sinon la
  // délégation n'est pas prise en compte — aucune action manuelle de
  // révocation n'est nécessaire quand le donneur perd le droit sous-jacent.
  const delegations = await prisma.permissionDelegation.findMany({
    where: { beneficiaireId: user.id, estActive: true },
    select: {
      permission: { select: { key: true } },
      donneur: {
        select: {
          isActive: true,
          role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
        },
      },
    },
  });

  const delegatedKeys = delegations
    .filter(
      (d) =>
        d.donneur.isActive &&
        d.donneur.role.permissions.some((rp) => rp.permission.key === d.permission.key)
    )
    .map((d) => d.permission.key);

  const permissions = Array.from(new Set([...rolePermissions, ...delegatedKeys]));

  return {
    user: {
      id: session.user.id,
      fullName: session.user.fullName,
      email: session.user.email,
      photoUrl: session.user.photoUrl || null,
    },
    role: session.role,
    permissions,
    rolePermissions,
    // Voir `isAdmin()` (backend/src/permissions.ts) : recalculé à chaque
    // appel depuis `Role.estAdmin`, jamais depuis le JWT — même principe
    // que `permissions` ci-dessus, pour qu'un changement pris via
    // /admin/roles s'applique immédiatement, sans reconnexion.
    estAdmin: role?.estAdmin ?? false,
  };
});
