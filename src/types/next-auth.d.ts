import type { DefaultSession } from "next-auth";

// Étend les types par défaut d'Auth.js pour transporter les champs
// spécifiques au portail (fullName, rôle) à travers le JWT et la session.
declare module "next-auth" {
  interface User {
    id: string;
    fullName: string;
    email: string;
    role: string;
    photoUrl: string | null;
    tokenVersion: number;
    /** "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") — porté
     * depuis `authorize()` jusqu'au callback `jwt` pour piloter la durée de
     * vie réelle du JWT (`src/lib/auth.config.ts`, `jwt.encode` personnalisé,
     * partagé avec le middleware `src/proxy.ts`). Jamais exposé côté
     * `Session` : usage interne serveur uniquement. */
    rememberMe?: boolean;
  }

  interface Session {
    user: {
      id: string;
      fullName: string;
      email: string;
      photoUrl: string | null;
      tokenVersion: number;
    } & DefaultSession["user"];
    role: string;
  }
}

// "next-auth/jwt" ne fait que ré-exporter le type JWT de "@auth/core/jwt"
// (`export * from "@auth/core/jwt"`) : pour que le "declaration merging"
// TypeScript s'applique, l'augmentation doit cibler le module d'origine.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    fullName: string;
    role: string;
    photoUrl: string | null;
    tokenVersion: number;
    /** Voir `User.rememberMe` ci-dessus. */
    rememberMe?: boolean;
  }
}
