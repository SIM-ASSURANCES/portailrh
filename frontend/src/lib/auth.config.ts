import type { NextAuthConfig } from "next-auth";
import { encode as defaultJwtEncode } from "next-auth/jwt";

// "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") — deux durées,
// jamais une troisième valeur ailleurs dans le code. Posées ICI (pas dans
// `auth.ts`) car ce fichier est partagé par l'instance NextAuth de
// l'application ET par celle du middleware (`src/proxy.ts`) : le middleware
// s'exécute sur (quasiment) toutes les requêtes et RÉ-ENCODE le cookie de
// session à chaque passage (voir `next-auth/lib/index.js`, `handleAuth` ->
// `getSession` -> l'action `session` de `@auth/core`, qui rappelle toujours
// `jwt.encode`). Si cette logique n'existait que dans `auth.ts`, le
// middleware aurait ré-émis un token avec la durée PAR DÉFAUT d'Auth.js
// (30 jours, aucune notion de `rememberMe`) dès la première navigation
// après connexion — neutralisant silencieusement la case décochée.
//
// Conséquence vérifiée du merge avec le middleware (`src/proxy.ts`,
// apporté par ailleurs) : ce ré-encodage à chaque requête fait de la durée
// COURTE (décochée) une fenêtre GLISSANTE, pas une expiration fixe depuis
// la connexion — chaque navigation repousse l'échéance de
// `SESSION_MAX_AGE_DEFAULT`. Avant l'introduction du middleware, rien ne
// rafraîchissait jamais le cookie après la connexion initiale (aucun
// `SessionProvider`/`middleware.ts` dans le projet), donc la session
// expirait strictement à `login + SESSION_MAX_AGE_DEFAULT`. Concrètement,
// "1 jour" décoché signifie maintenant "1 jour depuis la DERNIÈRE page
// visitée", pas "1 jour depuis la connexion" — comportement plus proche de
// ce qu'attend un utilisateur actif, vérifié explicitement (voir CLAUDE.md).
const SESSION_MAX_AGE_REMEMBERED = 30 * 24 * 60 * 60; // 30 jours (coché)
const SESSION_MAX_AGE_DEFAULT = 24 * 60 * 60; // 1 jour (décoché, par défaut)

export const authConfig = {
  session: {
    strategy: "jwt",
    // Plafond du cookie envoyé au navigateur (Max-Age/Expires) — TOUJOURS la
    // durée longue, quelle que soit la case "Se souvenir de moi". Limitation
    // documentée d'Auth.js v5 : cette valeur est résolue une seule fois pour
    // toute l'app (`@auth/core`, `lib/actions/callback/index.js`), jamais
    // par requête — impossible d'en faire un vrai cookie de session (sans
    // Max-Age, supprimé à la fermeture du navigateur) uniquement pour le cas
    // décoché sans réimplémenter `signIn()` à la main. La durée RÉELLE de la
    // session est en réalité imposée par `jwt.encode` ci-dessous (le `exp`
    // chiffré à l'intérieur du JWT, vérifié par Auth.js à chaque lecture) :
    // un cookie non "mémorisé" reste physiquement dans le navigateur jusqu'à
    // 30 jours, mais son JWT devient cryptographiquement invalide au bout de
    // `SESSION_MAX_AGE_DEFAULT` — `getSession()` renvoie alors `null` comme
    // n'importe quelle session expirée, l'utilisateur est redirigé vers
    // `/login` à la prochaine page (ou par le middleware lui-même, via le
    // callback `authorized` ci-dessous). Choix documenté et délibéré (voir
    // CLAUDE.md) plutôt qu'une vraie expiration à la fermeture du
    // navigateur, jugée moins fiable en pratique.
    maxAge: SESSION_MAX_AGE_REMEMBERED,
  },
  jwt: {
    // Surcharge du `encode` par défaut d'Auth.js : seul point du cycle de vie
    // où la durée RÉELLE (le `exp` chiffré dans le JWT) peut varier par
    // utilisateur — `session.maxAge` ci-dessus reste, lui, une valeur unique
    // pour toute l'app. Lu sur `token.rememberMe`, posé par le callback
    // `jwt` ci-dessous à partir de `authorize()` (`src/lib/auth.ts`) —
    // jamais recalculé après le login initial : `token.rememberMe` persiste
    // tel quel d'un appel à l'autre du callback `jwt`, jamais réécrit à
    // `undefined`. `encode` de `next-auth/jwt` est basé sur `jose`, sans
    // dépendance Node (contrairement à bcrypt) : sûr à utiliser ici, dans le
    // fichier partagé avec le middleware Edge (`src/proxy.ts`).
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
  providers: [], // Added in auth.ts because of bcrypt
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.fullName = user.fullName;
        token.role = user.role;
        token.photoUrl = user.photoUrl;
        token.tokenVersion = user.tokenVersion;
        // Voir `SESSION_MAX_AGE_*`/`jwt.encode` ci-dessus.
        token.rememberMe = user.rememberMe;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.fullName = token.fullName as string;
      session.user.photoUrl = token.photoUrl as string | null;
      session.user.tokenVersion = token.tokenVersion as number;
      session.role = token.role as string;
      // `rememberMe` n'est JAMAIS reprojeté sur `session.user` : usage
      // interne serveur uniquement (piloter `jwt.encode`), jamais exposé au
      // client.
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isApiRoute = nextUrl.pathname.startsWith('/api');
      const isAuthRoute = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/invitation');

      if (isApiRoute) {
        return true; // API routes handle their own auth
      }

      if (isAuthRoute) {
        return true;
      }

      if (!isLoggedIn) {
        return false; // Redirects to login
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
